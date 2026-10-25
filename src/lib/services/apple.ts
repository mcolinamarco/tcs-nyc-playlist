// Apple Music via MusicKit JS v3 (sign-in) + the Apple Music API (data).
// Needs a developer token, which the server signs (see .env.example).
//
// The Apple Music API can't reorder or remove songs in a library playlist, so
// "saving" always creates a new playlist in the user's library.

import type { LoadedPlaylist, PlaylistSummary, Track } from '../types';
import { getJson, ServiceError, newUid } from './http';
import { bestMatch } from './match';

const MUSICKIT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const API = 'https://api.music.apple.com';

interface MusicKitInstance {
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  isAuthorized: boolean;
  musicUserToken?: string;
  storefrontId?: string;
}
interface MusicKitGlobal {
  configure(opts: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance>;
  getInstance(): MusicKitInstance;
}
declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

let devToken: string | null = null;
let instancePromise: Promise<MusicKitInstance> | null = null;

async function developerToken(): Promise<string> {
  if (!devToken) devToken = (await getJson<{ token: string }>('/api/apple/token')).token;
  return devToken;
}

function loadScript(): Promise<MusicKitGlobal> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  return new Promise((resolve, reject) => {
    const done = () => (window.MusicKit ? resolve(window.MusicKit) : reject(new ServiceError('MusicKit failed to load', 0, 'apple')));
    document.addEventListener('musickitloaded', done, { once: true });
    const script = document.createElement('script');
    script.src = MUSICKIT_SRC;
    script.async = true;
    script.dataset.webComponents = '';
    script.onerror = () => reject(new ServiceError('Could not load Apple MusicKit', 0, 'apple'));
    script.onload = () => setTimeout(() => window.MusicKit && done(), 50);
    document.head.appendChild(script);
  });
}

export function musicKit(): Promise<MusicKitInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const [token, MK] = await Promise.all([developerToken(), loadScript()]);
      await MK.configure({ developerToken: token, app: { name: '26.2 Mixtape', build: '1.0.0' } });
      return MK.getInstance();
    })().catch((err) => {
      instancePromise = null;
      throw err;
    });
  }
  return instancePromise;
}

export async function login(): Promise<void> {
  const mk = await musicKit();
  await mk.authorize();
}

export async function logout(): Promise<void> {
  const mk = await musicKit();
  await mk.unauthorize();
}

export async function isAuthorized(): Promise<boolean> {
  try {
    return (await musicKit()).isAuthorized;
  } catch {
    return false;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const mk = await musicKit();
  const headers: Record<string, string> = { authorization: `Bearer ${await developerToken()}` };
  if (mk.musicUserToken) headers['music-user-token'] = mk.musicUserToken;
  if (init.body) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ServiceError('Could not reach Apple Music', 0, 'apple');
  }
  if (!res.ok) {
    let message = `Apple Music error ${res.status}`;
    try {
      const body = (await res.json()) as { errors?: { title?: string; detail?: string }[] };
      const e = body.errors?.[0];
      if (e) message = `Apple Music: ${e.detail ?? e.title}`;
    } catch {
      /* empty body */
    }
    throw new ServiceError(message, res.status, 'apple');
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function storefront(): Promise<string> {
  const mk = await musicKit();
  if (mk.storefrontId) return mk.storefrontId;
  try {
    const res = await api<{ data: { id: string }[] }>('/v1/me/storefront');
    return res.data[0]?.id ?? 'us';
  } catch {
    return 'us';
  }
}

// --- Parsing --------------------------------------------------------------------------

interface Artwork {
  url: string;
  bgColor?: string;
  textColor1?: string;
  textColor2?: string;
}
interface SongResource {
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
    artwork?: Artwork;
    playParams?: { id: string; catalogId?: string; isLibrary?: boolean };
  };
  relationships?: { catalog?: { data?: SongResource[] } };
}

export const artworkUrl = (a: Artwork | undefined, size = 300) =>
  a?.url?.replace('{w}', String(size)).replace('{h}', String(size)).replace('{c}', 'bb').replace('{f}', 'jpg');

export function fromAppleSong(s: SongResource): Track | null {
  const a = s.attributes;
  if (!a || !a.durationInMillis) return null;
  const catalog = s.relationships?.catalog?.data?.[0];
  const ca = catalog?.attributes;
  const isLibrary = s.type.startsWith('library-');
  const art = ca?.artwork ?? a.artwork;
  const catalogId = isLibrary ? (catalog?.id ?? a.playParams?.catalogId) : s.id;
  return {
    uid: newUid(),
    source: 'apple',
    id: s.id,
    title: a.name,
    artist: a.artistName,
    album: a.albumName,
    albumKey: `apple-album:${(a.albumName ?? s.id).toLowerCase()}|${a.artistName.toLowerCase()}`,
    durationMs: a.durationInMillis,
    artworkUrl: artworkUrl(art),
    isrc: ca?.isrc ?? a.isrc,
    appleId: catalogId,
    appleLibraryId: isLibrary ? s.id : undefined,
    previewUrl: (ca?.previews ?? a.previews)?.[0]?.url,
    explicit: (ca?.contentRating ?? a.contentRating) === 'explicit',
    colorHints: [art?.bgColor, art?.textColor1].filter((c): c is string => Boolean(c)).map((c) => `#${c}`),
  };
}

// --- Reading ---------------------------------------------------------------------------

interface Page<T> {
  data: T[];
  next?: string;
}

export async function getLibraryPlaylists(): Promise<PlaylistSummary[]> {
  const out: PlaylistSummary[] = [];
  let next: string | undefined = '/v1/me/library/playlists?limit=100';
  while (next && out.length < 500) {
    const page: Page<{ id: string; attributes?: { name?: string; canEdit?: boolean; artwork?: Artwork } }> = await api(next);
    for (const p of page.data) {
      out.push({
        service: 'apple',
        id: p.id,
        name: p.attributes?.name ?? 'Untitled playlist',
        imageUrl: artworkUrl(p.attributes?.artwork, 120),
        editable: Boolean(p.attributes?.canEdit),
      });
    }
    next = page.next;
  }
  return out;
}

async function allPages<T>(first: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = first;
  while (next) {
    const page: Page<T> = await api(next);
    out.push(...page.data);
    next = page.next;
  }
  return out;
}

export async function loadLibraryPlaylist(id: string): Promise<LoadedPlaylist> {
  const meta = await api<Page<{ id: string; attributes?: { name?: string; artwork?: Artwork } }>>(`/v1/me/library/playlists/${id}`);
  let songs: SongResource[];
  try {
    songs = await allPages<SongResource>(`/v1/me/library/playlists/${id}/tracks?limit=100&include=catalog`);
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) songs = []; // empty playlist
    else songs = await allPages<SongResource>(`/v1/me/library/playlists/${id}/tracks?limit=100`);
  }
  const tracks = songs.map(fromAppleSong).filter((t): t is Track => Boolean(t));
  const skipped = songs.length - tracks.length;
  return {
    ref: {
      service: 'apple',
      id,
      name: meta.data[0]?.attributes?.name ?? 'Apple Music playlist',
      imageUrl: artworkUrl(meta.data[0]?.attributes?.artwork),
      editable: false,
    },
    tracks,
    warnings: skipped ? [`${skipped} unavailable items skipped`] : [],
  };
}

export async function search(term: string): Promise<Track[]> {
  const sf = await storefront();
  const res = await api<{ results?: { songs?: Page<SongResource> } }>(
    `/v1/catalog/${sf}/search?types=songs&limit=25&term=${encodeURIComponent(term)}`,
  );
  return (res.results?.songs?.data ?? []).map(fromAppleSong).filter((t): t is Track => Boolean(t));
}

/** Catalog id for a track that came from another service. */
export async function findCatalogId(track: Track): Promise<{ id: string; type: 'songs' | 'library-songs' } | null> {
  if (track.appleId) return { id: track.appleId, type: 'songs' };
  if (track.appleLibraryId) return { id: track.appleLibraryId, type: 'library-songs' };
  const sf = await storefront();
  if (track.isrc) {
    const res = await api<Page<SongResource>>(`/v1/catalog/${sf}/songs?filter[isrc]=${encodeURIComponent(track.isrc)}`);
    const hit = res.data.find((s) => s.attributes?.durationInMillis);
    if (hit) return { id: hit.id, type: 'songs' };
  }
  const primaryArtist = track.artist.split(/,| feat\.? | & /i)[0].trim();
  const hit = bestMatch(track, await search(`${track.title} ${primaryArtist}`));
  return hit?.appleId ? { id: hit.appleId, type: 'songs' } : null;
}

export async function createLibraryPlaylist(
  name: string,
  description: string,
  items: { id: string; type: 'songs' | 'library-songs' }[],
): Promise<void> {
  const created = await api<Page<{ id: string }>>('/v1/me/library/playlists', {
    method: 'POST',
    body: JSON.stringify({
      attributes: { name, description },
      relationships: { tracks: { data: items.slice(0, 100) } },
    }),
  });
  const id = created?.data?.[0]?.id;
  // Add the rest in batches (appending is the only edit the API allows).
  for (let i = 100; id && i < items.length; i += 100) {
    await api(`/v1/me/library/playlists/${id}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ data: items.slice(i, i + 100) }),
    });
  }
}
