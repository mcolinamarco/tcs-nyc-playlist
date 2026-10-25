import fs from 'node:fs';
import { Hono } from 'hono';
import { importPKCS8, SignJWT } from 'jose';
import { parseMusicLink } from '../src/lib/services/links';
import {
  appleArtwork,
  fromItunes,
  parseApplePage,
  parseSpotifyEmbed,
  type ItunesResult,
  type ScrapedPlaylist,
  type ScrapedTrack,
} from './scrape';

export type ServerEnv = Record<string, string | undefined>;

/** What /api/public returns for a pasted link. */
export interface PublicPlaylist extends ScrapedPlaylist {
  service: 'spotify' | 'apple';
  kind: string;
  id: string;
  url: string;
  storefront?: string;
  warnings: string[];
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IMAGE_HOSTS = ['scdn.co', 'spotifycdn.com', 'mzstatic.com', 'dzcdn.net', 'deezer.com'];

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

class TtlCache<V> {
  private map = new Map<string, { at: number; value: V }>();
  constructor(
    private ttlMs: number,
    private max = 200,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }
}

async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `${new URL(url).hostname} answered ${res.status}`);
  return res.text();
}

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `${new URL(url).hostname} answered ${res.status}`);
  return (await res.json()) as T;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export function createApp(env: ServerEnv) {
  const app = new Hono().basePath('/api');
  const publicCache = new TtlCache<PublicPlaylist>(10 * 60 * 1000);
  const oembedCache = new TtlCache<string | null>(24 * 60 * 60 * 1000, 5000);

  // --- Apple developer token -------------------------------------------------------
  let appleToken: { token: string; exp: number } | null = null;
  const appleKey = () => {
    if (env.APPLE_PRIVATE_KEY) return env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    if (env.APPLE_PRIVATE_KEY_PATH) return fs.readFileSync(env.APPLE_PRIVATE_KEY_PATH, 'utf8');
    return null;
  };
  const appleConfigured = () => Boolean(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && (env.APPLE_PRIVATE_KEY || env.APPLE_PRIVATE_KEY_PATH));
  async function appleDeveloperToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (appleToken && appleToken.exp - now > 3600) return appleToken.token;
    const pem = appleKey();
    if (!pem || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID) throw new HttpError(501, 'Apple Music is not configured on this server');
    const key = await importPKCS8(pem.trim(), 'ES256');
    const exp = now + 60 * 60 * 24 * 30;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID })
      .setIssuer(env.APPLE_TEAM_ID)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(key);
    appleToken = { token, exp };
    return token;
  }

  // --- Spotify client-credentials token (optional) ----------------------------------
  let spotifyToken: { token: string; exp: number } | null = null;
  async function spotifyAppToken(): Promise<string | null> {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
    if (spotifyToken && spotifyToken.exp - Date.now() > 60_000) return spotifyToken.token;
    const res = await fetchJson<{ access_token: string; expires_in: number }>('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    spotifyToken = { token: res.access_token, exp: Date.now() + res.expires_in * 1000 };
    return spotifyToken.token;
  }

  async function spotifyThumbnail(trackId: string): Promise<string | undefined> {
    const cached = oembedCache.get(trackId);
    if (cached !== undefined) return cached ?? undefined;
    try {
      const res = await fetchJson<{ thumbnail_url?: string }>(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${trackId}`)}`,
        { headers: { 'user-agent': BROWSER_UA } },
        6000,
      );
      oembedCache.set(trackId, res.thumbnail_url ?? null);
      return res.thumbnail_url;
    } catch {
      return undefined;
    }
  }

  async function spotifyPublic(kind: string, id: string): Promise<ScrapedPlaylist & { warnings: string[] }> {
    const warnings: string[] = [];
    // Albums are readable with an app token; playlists generally aren't for
    // development-mode apps, so those go straight to the embed page.
    const token = kind === 'album' ? await spotifyAppToken().catch(() => null) : null;
    if (token) {
      try {
        type SpTrack = { id: string; uri: string; name: string; duration_ms: number; explicit: boolean; artists: { name: string }[]; preview_url?: string };
        const album = await fetchJson<{
          name: string;
          artists: { name: string }[];
          images: { url: string; width: number }[];
          tracks: { items: SpTrack[]; next: string | null };
        }>(`https://api.spotify.com/v1/albums/${id}`, { headers: { authorization: `Bearer ${token}` } });
        const items = [...album.tracks.items];
        let next = album.tracks.next;
        while (next) {
          const page = await fetchJson<{ items: SpTrack[]; next: string | null }>(next, { headers: { authorization: `Bearer ${token}` } });
          items.push(...page.items);
          next = page.next;
        }
        const cover = [...album.images].sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300))[0]?.url;
        return {
          name: album.name,
          owner: album.artists.map((a) => a.name).join(', '),
          imageUrl: cover,
          warnings,
          tracks: items.map((t) => ({
            id: t.id,
            spotifyUri: t.uri,
            title: t.name,
            artist: t.artists.map((a) => a.name).join(', '),
            album: album.name,
            durationMs: t.duration_ms,
            explicit: t.explicit,
            artworkUrl: cover,
            previewUrl: t.preview_url ?? undefined,
          })),
        };
      } catch {
        /* fall through to the embed page */
      }
    }
    const html = await fetchText(`https://open.spotify.com/embed/${kind}/${id}`);
    const parsed = parseSpotifyEmbed(html);
    if (!parsed) throw new HttpError(422, "Couldn't read that Spotify link. Is the playlist public?");
    if (kind === 'album') {
      for (const t of parsed.tracks) {
        t.artworkUrl = parsed.imageUrl;
        t.album = parsed.name;
      }
    } else {
      const thumbs = await mapLimit(parsed.tracks, 8, (t) => spotifyThumbnail(t.id));
      parsed.tracks.forEach((t, i) => (t.artworkUrl = thumbs[i]));
      const missing = thumbs.filter((x) => !x).length;
      if (missing) warnings.push(`${missing} songs came without artwork`);
    }
    return { ...parsed, warnings };
  }

  async function itunesLookup(ids: string[], storefront: string): Promise<Map<string, ScrapedTrack>> {
    const out = new Map<string, ScrapedTrack>();
    for (let i = 0; i < ids.length; i += 150) {
      const batch = ids.slice(i, i + 150);
      const res = await fetchJson<{ results: ItunesResult[] }>(
        `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${storefront}&entity=song`,
      );
      for (const r of res.results) {
        const t = fromItunes(r);
        if (t) out.set(t.id, t);
      }
    }
    return out;
  }

  type AppleSong = {
    id: string;
    type: string;
    attributes?: {
      name: string;
      artistName: string;
      albumName?: string;
      durationInMillis?: number;
      isrc?: string;
      contentRating?: string;
      previews?: { url: string }[];
      artwork?: { url: string; bgColor?: string; textColor1?: string; textColor2?: string };
    };
  };
  const fromAppleSong = (s: AppleSong): ScrapedTrack | null => {
    const a = s.attributes;
    if (!a) return null;
    return {
      id: s.id,
      appleId: s.id,
      title: a.name,
      artist: a.artistName,
      album: a.albumName,
      durationMs: a.durationInMillis ?? 0,
      isrc: a.isrc,
      explicit: a.contentRating === 'explicit',
      previewUrl: a.previews?.[0]?.url,
      artworkUrl: a.artwork?.url ? appleArtwork(a.artwork.url) : undefined,
      colorHints: [a.artwork?.bgColor, a.artwork?.textColor1].filter((c): c is string => Boolean(c)).map((c) => `#${c}`),
    };
  };

  async function applePublic(kind: string, id: string, storefront: string, url: string): Promise<ScrapedPlaylist & { warnings: string[] }> {
    const warnings: string[] = [];
    if (kind === 'album' || kind === 'song') {
      const res = await fetchJson<{ results: ItunesResult[] }>(
        `https://itunes.apple.com/lookup?id=${id}&country=${storefront}${kind === 'album' ? '&entity=song&limit=200' : ''}`,
      );
      const collection = res.results.find((r) => r.wrapperType === 'collection') as (ItunesResult & { collectionName?: string; artistName?: string }) | undefined;
      const songs = res.results
        .filter((r) => r.wrapperType === 'track')
        .sort((a, b) => (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
      const tracks = songs.map(fromItunes).filter((t): t is ScrapedTrack => Boolean(t));
      if (!tracks.length) throw new HttpError(404, 'Apple Music returned no songs for that link');
      return {
        name: collection?.collectionName ?? tracks[0].title,
        owner: collection?.artistName ?? tracks[0].artist,
        imageUrl: tracks[0].artworkUrl,
        tracks,
        warnings,
      };
    }

    // Playlists: the catalog API when we have a developer token…
    if (appleConfigured()) {
      try {
        const token = await appleDeveloperToken();
        const headers = { authorization: `Bearer ${token}` };
        const base = 'https://api.music.apple.com';
        const res = await fetchJson<{
          data: { attributes: { name: string; curatorName?: string; artwork?: { url: string } }; relationships: { tracks: { data: AppleSong[]; next?: string } } }[];
        }>(`${base}/v1/catalog/${storefront}/playlists/${id}?include=tracks`, { headers });
        const pl = res.data[0];
        const songs = [...pl.relationships.tracks.data];
        let next = pl.relationships.tracks.next;
        while (next) {
          const page = await fetchJson<{ data: AppleSong[]; next?: string }>(`${base}${next}`, { headers });
          songs.push(...page.data);
          next = page.next;
        }
        return {
          name: pl.attributes.name,
          owner: pl.attributes.curatorName,
          imageUrl: pl.attributes.artwork?.url ? appleArtwork(pl.attributes.artwork.url) : undefined,
          tracks: songs.map(fromAppleSong).filter((t): t is ScrapedTrack => Boolean(t)),
          warnings,
        };
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) throw new HttpError(404, 'Apple Music could not find that playlist');
        /* fall back to the public page */
      }
    }

    // …otherwise the public web page plus the iTunes lookup API.
    const html = await fetchText(url.includes('/playlist/') ? url : `https://music.apple.com/${storefront}/playlist/${id}`);
    const page = parseApplePage(html);
    const ids = page.tracks.map((t) => t.appleId).filter((x): x is string => Boolean(x));
    if (!ids.length) throw new HttpError(422, "Couldn't read that Apple Music playlist. Is it shared publicly?");
    const looked = await itunesLookup(ids, storefront).catch(() => new Map<string, ScrapedTrack>());
    const tracks: ScrapedTrack[] = [];
    let missing = 0;
    for (const t of page.tracks) {
      const full = t.appleId ? looked.get(t.appleId) : undefined;
      if (full) tracks.push({ ...full, colorHints: t.colorHints });
      else if (t.appleId && t.title && t.durationMs) {
        tracks.push({ id: t.appleId, appleId: t.appleId, title: t.title, artist: t.artist ?? '', durationMs: t.durationMs, artworkUrl: t.artworkUrl, colorHints: t.colorHints });
      } else missing++;
    }
    if (missing) warnings.push(`${missing} songs aren't available in the ${storefront.toUpperCase()} store and were skipped`);
    return { name: page.name ?? 'Apple Music playlist', imageUrl: page.imageUrl, tracks, warnings };
  }

  // --- Routes ---------------------------------------------------------------------------
  app.onError((err, c) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[api]', err);
    return c.json({ error: err.message || 'Server error' }, status as 400);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/config', (c) =>
    c.json({
      spotifyClientId: env.SPOTIFY_CLIENT_ID || null,
      apple: appleConfigured(),
      publicLinks: true,
    }),
  );

  app.get('/apple/token', async (c) => {
    const token = await appleDeveloperToken();
    c.header('cache-control', 'no-store');
    return c.json({ token });
  });

  app.get('/public', async (c) => {
    const url = c.req.query('url') ?? '';
    const link = parseMusicLink(url);
    if (!link) throw new HttpError(400, "That doesn't look like a Spotify or Apple Music link");
    const key = `${link.service}:${link.kind}:${link.id}:${'storefront' in link ? link.storefront : ''}`;
    const hit = publicCache.get(key);
    if (hit) return c.json(hit);
    let result: ScrapedPlaylist & { warnings: string[] };
    if (link.service === 'spotify') {
      result = await spotifyPublic(link.kind, link.id);
    } else {
      result = await applePublic(link.kind, link.id, link.storefront, link.url);
    }
    const body: PublicPlaylist = {
      ...result,
      service: link.service,
      kind: link.kind,
      id: link.id,
      url: link.url,
      storefront: 'storefront' in link ? link.storefront : undefined,
    };
    publicCache.set(key, body);
    return c.json(body);
  });

  app.get('/image', async (c) => {
    const raw = c.req.query('url') ?? '';
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new HttpError(400, 'bad url');
    }
    if (target.protocol !== 'https:' || !IMAGE_HOSTS.some((h) => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
      throw new HttpError(403, 'host not allowed');
    }
    const allowed = (u: URL) => u.protocol === 'https:' && IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    const res = await fetch(target, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': BROWSER_UA } });
    const type = res.headers.get('content-type') ?? '';
    if (res.url && !allowed(new URL(res.url))) throw new HttpError(403, 'redirected to a host that is not allowed');
    if (!res.ok || !type.startsWith('image/')) throw new HttpError(502, 'image fetch failed');
    return new Response(res.body, {
      headers: {
        'content-type': type,
        'cache-control': 'public, max-age=604800, immutable',
        'access-control-allow-origin': '*',
      },
    });
  });

  return app;
}
