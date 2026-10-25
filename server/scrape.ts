// Readers for public playlist pages, used when a link points at a playlist the
// APIs won't hand over (Spotify dev-mode apps can only read the signed-in
// user's own playlists; Apple needs a developer token). Each parser is
// deliberately tolerant: it looks for the shape of a track rather than a fixed
// path, so small page changes don't break it.

export interface ScrapedTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  artworkUrl?: string;
  previewUrl?: string;
  explicit?: boolean;
  spotifyUri?: string;
  appleId?: string;
  isrc?: string;
  colorHints?: string[];
}

export interface ScrapedPlaylist {
  name: string;
  owner?: string;
  imageUrl?: string;
  tracks: ScrapedTrack[];
}

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

function* walk(node: Json, depth = 0): Generator<Record<string, Json>> {
  if (depth > 40) return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child, depth + 1);
  } else if (isObj(node)) {
    yield node;
    for (const v of Object.values(node)) yield* walk(v, depth + 1);
  }
}

export function extractScriptJson(html: string, idOrType: { id?: string; type?: string }): Json[] {
  const out: Json[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (idOrType.id && !new RegExp(`id=["']${idOrType.id}["']`).test(attrs)) continue;
    if (idOrType.type && !new RegExp(`type=["']${idOrType.type.replace('+', '\\+')}["']`).test(attrs)) continue;
    try {
      out.push(JSON.parse(decodeEntities(m[2].trim())));
    } catch {
      /* not JSON */
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  // JSON in <script> tags is normally raw, but some pages HTML-escape it.
  if (!/&(quot|amp|lt|gt|#\d+);/.test(s) || s.trimStart().startsWith('{"') || s.trimStart().startsWith('[')) return s;
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

export function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content.replace(/&quot;/g, '"')) : undefined;
}

// --- Spotify embed -------------------------------------------------------------

/** Parses open.spotify.com/embed/{playlist|album}/{id} (Next.js page data). */
export function parseSpotifyEmbed(html: string): ScrapedPlaylist | null {
  const blobs = extractScriptJson(html, { id: '__NEXT_DATA__' });
  for (const blob of blobs) {
    for (const node of walk(blob)) {
      const list = node.trackList;
      if (!Array.isArray(list) || list.length === 0) continue;
      const tracks: ScrapedTrack[] = [];
      for (const t of list) {
        if (!isObj(t)) continue;
        const uri = typeof t.uri === 'string' ? t.uri : '';
        const id = uri.split(':').pop() ?? '';
        const duration = Number(t.duration);
        if (!uri.startsWith('spotify:track:') || !id || !Number.isFinite(duration)) continue;
        tracks.push({
          id,
          title: String(t.title ?? ''),
          artist: String(t.subtitle ?? '').replace(/ /g, ' '),
          durationMs: duration,
          explicit: Boolean(t.isExplicit),
          previewUrl: isObj(t.audioPreview) && typeof t.audioPreview.url === 'string' ? t.audioPreview.url : undefined,
          spotifyUri: uri,
        });
      }
      if (tracks.length === 0) continue;
      const cover = isObj(node.coverArt) && Array.isArray(node.coverArt.sources) ? node.coverArt.sources : [];
      const coverUrl = cover.map((s) => (isObj(s) ? s.url : undefined)).find((u): u is string => typeof u === 'string');
      const visual = isObj(node.visualIdentity) && Array.isArray(node.visualIdentity.image) ? node.visualIdentity.image : [];
      const visualUrl = visual.map((s) => (isObj(s) ? s.url : undefined)).find((u): u is string => typeof u === 'string');
      return {
        name: String(node.name ?? node.title ?? 'Spotify playlist'),
        owner: typeof node.subtitle === 'string' ? node.subtitle : undefined,
        imageUrl: coverUrl ?? visualUrl,
        tracks,
      };
    }
  }
  return null;
}

// --- Apple Music web page -------------------------------------------------------

const ISO_DURATION = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)$/;
export function isoDurationMs(s: string): number | undefined {
  const m = s.match(ISO_DURATION);
  if (!m) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

const songIdFromUrl = (url: string): string | undefined =>
  url.match(/\/song\/(?:[^/?#]+\/)?(\d+)/)?.[1] ?? url.match(/[?&]i=(\d+)/)?.[1];

/**
 * Ordered song ids (plus whatever metadata the page already has) from a
 * music.apple.com playlist or album page. Full metadata is filled in later
 * from the iTunes lookup API.
 */
export function parseApplePage(html: string): { name?: string; imageUrl?: string; tracks: Partial<ScrapedTrack>[] } {
  const name = metaContent(html, 'og:title')?.replace(/ (?:on|-) Apple Music$/i, '').trim();
  const imageUrl = metaContent(html, 'og:image');

  // 1. schema.org JSON-LD (MusicPlaylist / MusicAlbum → track[])
  for (const blob of extractScriptJson(html, { type: 'application/ld+json' })) {
    for (const node of walk(blob)) {
      const list = node.track ?? (isObj(node.tracks) ? node.tracks : undefined);
      if (!Array.isArray(list)) continue;
      const tracks = list.filter(isObj).map((t) => {
        const url = typeof t.url === 'string' ? t.url : '';
        const by = isObj(t.byArtist) ? t.byArtist.name : Array.isArray(t.byArtist) && isObj(t.byArtist[0]) ? t.byArtist[0].name : undefined;
        return {
          appleId: songIdFromUrl(url),
          title: typeof t.name === 'string' ? t.name : undefined,
          artist: typeof by === 'string' ? by : undefined,
          durationMs: typeof t.duration === 'string' ? isoDurationMs(t.duration) : undefined,
        };
      });
      if (tracks.some((t) => t.appleId)) return { name: name ?? (typeof node.name === 'string' ? node.name : undefined), imageUrl, tracks };
    }
  }

  // 2. The page's serialized app state: objects that look like song lockups.
  const seen = new Set<string>();
  const tracks: Partial<ScrapedTrack>[] = [];
  for (const blob of extractScriptJson(html, { id: 'serialized-server-data' })) {
    for (const node of walk(blob)) {
      const desc = isObj(node.contentDescriptor) ? node.contentDescriptor : undefined;
      const ids = desc && isObj(desc.identifiers) ? desc.identifiers : undefined;
      const kind = desc?.kind;
      const adam = ids?.storeAdamID ?? ids?.storeAdamId;
      if (kind !== 'song' || (typeof adam !== 'string' && typeof adam !== 'number')) continue;
      const id = String(adam);
      if (seen.has(id)) continue;
      seen.add(id);
      const art = isObj(node.artwork) && isObj(node.artwork.dictionary) ? node.artwork.dictionary : undefined;
      tracks.push({
        appleId: id,
        title: typeof node.title === 'string' ? node.title : undefined,
        artist: typeof node.artistName === 'string' ? node.artistName : undefined,
        durationMs: typeof node.duration === 'number' ? node.duration : undefined,
        artworkUrl: typeof art?.url === 'string' ? appleArtwork(art.url) : undefined,
        colorHints: typeof art?.bgColor === 'string' ? [`#${art.bgColor}`] : undefined,
      });
    }
  }
  if (tracks.length) return { name, imageUrl, tracks };

  // 3. Last resort: song links in page order.
  const re = /https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:song\/[^"'\s<>]+|album\/[^"'\s<>]+\?i=\d+)/g;
  for (const m of html.match(re) ?? []) {
    const id = songIdFromUrl(m);
    if (id && !seen.has(id)) {
      seen.add(id);
      tracks.push({ appleId: id });
    }
  }
  return { name, imageUrl, tracks };
}

export function appleArtwork(template: string, size = 300): string {
  return template
    .replace('{w}', String(size))
    .replace('{h}', String(size))
    .replace('{c}', 'bb')
    .replace('{f}', 'jpg');
}

// --- iTunes lookup -----------------------------------------------------------------

export interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionId?: number;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
  trackExplicitness?: string;
  discNumber?: number;
  trackNumber?: number;
}

export function itunesArtwork(url100: string | undefined, size = 300): string | undefined {
  return url100?.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, `/${size}x${size}bb.jpg`);
}

export function fromItunes(r: ItunesResult): ScrapedTrack | null {
  if (r.wrapperType !== 'track' || !r.trackId) return null;
  return {
    id: String(r.trackId),
    appleId: String(r.trackId),
    title: r.trackName ?? '',
    artist: r.artistName ?? '',
    album: r.collectionName,
    durationMs: r.trackTimeMillis ?? 0,
    artworkUrl: itunesArtwork(r.artworkUrl100),
    previewUrl: r.previewUrl,
    explicit: r.trackExplicitness === 'explicit',
  };
}
