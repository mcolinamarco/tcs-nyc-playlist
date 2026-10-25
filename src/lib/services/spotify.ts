// Spotify Web API, browser-only: Authorization Code + PKCE (no secret needed).
//
// Written against the February 2026 Web API changes for development-mode apps:
//  - playlist contents live at /playlists/{id}/items (old /tracks kept as a fallback)
//  - each playlist row carries the track under `item` (older: `track`)
//  - playlist contents are only readable for playlists the user owns or
//    collaborates on — anything else goes through the server's public reader
//  - new playlists are created with POST /me/playlists
//  - search returns at most 10 results per request

import type { LoadedPlaylist, PlaylistSummary, Track } from '../types';
import { ServiceError, newUid, sleep } from './http';
import { bestMatch } from './match';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-private',
];
const AUTH_KEY = 'mixtape.spotify.auth';
const PKCE_KEY = 'mixtape.spotify.pkce';

interface StoredAuth {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface SpotifyUser {
  id: string;
  display_name?: string;
  country?: string;
  product?: string;
}

/** Thrown when Spotify won't hand over a playlist's contents to this app. */
export class SpotifyRestrictedError extends ServiceError {}

export const redirectUri = () => `${window.location.origin}/callback`;

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, len);
}

function loadAuth(): StoredAuth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as StoredAuth | null;
  } catch {
    return null;
  }
}

function saveAuth(auth: StoredAuth | null) {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function isLoggedIn(): boolean {
  return Boolean(loadAuth());
}

export async function beginLogin(clientId: string): Promise<void> {
  if (!crypto.subtle) throw new ServiceError('Spotify sign-in needs https or http://127.0.0.1', 0, 'spotify');
  const verifier = randomString(64);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, clientId }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

/** Finishes the redirect from Spotify. Returns true if this page load was the callback. */
export async function completeLoginFromCallback(): Promise<boolean> {
  if (window.location.pathname !== '/callback') return false;
  const params = new URLSearchParams(window.location.search);
  window.history.replaceState(null, '', '/');
  const pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as { verifier: string; state: string; clientId: string } | null;
  sessionStorage.removeItem(PKCE_KEY);
  if (params.get('error')) throw new ServiceError(`Spotify sign-in was cancelled (${params.get('error')})`, 0, 'spotify');
  const code = params.get('code');
  if (!code || !pending || params.get('state') !== pending.state) {
    throw new ServiceError('Spotify sign-in failed — please try again', 0, 'spotify');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: pending.clientId,
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) throw new ServiceError('Spotify sign-in failed — check the redirect URI in your Spotify app settings', res.status, 'spotify');
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  saveAuth({
    clientId: pending.clientId,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return true;
}

export function logout() {
  saveAuth(null);
  me = null;
}

async function accessToken(forceRefresh = false): Promise<string> {
  const auth = loadAuth();
  if (!auth) throw new ServiceError('Not signed in to Spotify', 401, 'spotify');
  if (!forceRefresh && auth.expiresAt - Date.now() > 60_000) return auth.accessToken;
  if (!auth.refreshToken) {
    saveAuth(null);
    throw new ServiceError('Spotify session expired — sign in again', 401, 'spotify');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: auth.clientId }),
  });
  if (!res.ok) {
    saveAuth(null);
    throw new ServiceError('Spotify session expired — sign in again', 401, 'spotify');
  }
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  saveAuth({
    ...auth,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

async function api<T>(pathOrUrl: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await accessToken(attempt > 0 && attempt < 2);
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ServiceError('Could not reach Spotify', 0, 'spotify');
  }
  if (res.status === 401 && attempt === 0) return api<T>(pathOrUrl, init, 1);
  if (res.status === 429 && attempt < 3) {
    const wait = Math.min(10, Number(res.headers.get('retry-after') ?? '2'));
    await sleep(wait * 1000);
    return api<T>(pathOrUrl, init, attempt + 2);
  }
  if (!res.ok) {
    let message = `Spotify error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = `Spotify: ${body.error.message}`;
    } catch {
      /* empty body */
    }
    throw new ServiceError(message, res.status, 'spotify');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

let me: SpotifyUser | null = null;
export async function getMe(): Promise<SpotifyUser> {
  if (!me) me = await api<SpotifyUser>('/me');
  return me;
}

// --- Parsing ----------------------------------------------------------------------------

interface SpImage {
  url: string;
  width?: number | null;
}
interface SpTrack {
  id: string | null;
  uri: string;
  type?: string;
  name: string;
  duration_ms: number;
  explicit?: boolean;
  is_local?: boolean;
  preview_url?: string | null;
  artists?: { name: string }[];
  album?: { id?: string; name?: string; images?: SpImage[] };
  external_ids?: { isrc?: string };
  // episodes
  images?: SpImage[];
  show?: { id?: string; name?: string; publisher?: string };
}

function pickImage(images: SpImage[] | undefined, target = 300): string | undefined {
  if (!images?.length) return undefined;
  return [...images].sort((a, b) => Math.abs((a.width ?? 640) - target) - Math.abs((b.width ?? 640) - target))[0].url;
}

export function fromSpotifyTrack(t: SpTrack): Track {
  const isEpisode = t.type === 'episode';
  const artist = isEpisode ? (t.show?.publisher ?? t.show?.name ?? '') : (t.artists ?? []).map((a) => a.name).join(', ');
  const album = isEpisode ? t.show?.name : t.album?.name;
  return {
    uid: newUid(),
    source: 'spotify',
    id: t.id ?? t.uri,
    title: t.name,
    artist,
    album,
    albumKey: `spotify-album:${(isEpisode ? t.show?.id : t.album?.id) ?? album ?? t.uri}`,
    durationMs: t.duration_ms,
    artworkUrl: pickImage(isEpisode ? t.images : t.album?.images),
    isrc: t.external_ids?.isrc,
    spotifyUri: t.uri,
    previewUrl: t.preview_url ?? undefined,
    explicit: t.explicit,
    local: t.is_local || t.uri.startsWith('spotify:local:'),
  };
}

/** A playlist row: Feb 2026 API puts the track under `item`; older under `track`. */
export function rowTrack(row: { item?: unknown; track?: unknown }): SpTrack | null {
  const candidate = typeof row.item === 'object' && row.item ? row.item : typeof row.track === 'object' && row.track ? row.track : null;
  return candidate as SpTrack | null;
}

interface Paging<T> {
  items: T[];
  next: string | null;
  total?: number;
}

// --- Reading ----------------------------------------------------------------------------

interface SpPlaylist {
  id: string;
  name: string;
  collaborative?: boolean;
  owner?: { id: string; display_name?: string };
  images?: SpImage[] | null;
  items?: Paging<{ item?: unknown; track?: unknown }> & { total?: number };
  tracks?: Paging<{ item?: unknown; track?: unknown }> & { total?: number };
  external_urls?: { spotify?: string };
}

export async function getMyPlaylists(): Promise<PlaylistSummary[]> {
  const user = await getMe();
  const out: PlaylistSummary[] = [];
  let url: string | null = '/me/playlists?limit=50';
  while (url && out.length < 500) {
    const page: Paging<SpPlaylist> = await api<Paging<SpPlaylist>>(url);
    for (const p of page.items) {
      if (!p) continue;
      out.push({
        service: 'spotify',
        id: p.id,
        name: p.name,
        imageUrl: pickImage(p.images ?? undefined, 120),
        trackCount: p.items?.total ?? p.tracks?.total,
        owner: p.owner?.display_name ?? p.owner?.id,
        editable: p.owner?.id === user.id || Boolean(p.collaborative),
      });
    }
    url = page.next;
  }
  return out;
}

async function playlistRows(id: string, first?: Paging<{ item?: unknown; track?: unknown }>) {
  const rows: { item?: unknown; track?: unknown }[] = [];
  let next: string | null;
  if (first?.items?.length) {
    rows.push(...first.items);
    next = first.next;
  } else {
    next = `/playlists/${id}/items?limit=50`;
  }
  let triedLegacy = false;
  while (next) {
    const url: string = next;
    try {
      const page: Paging<{ item?: unknown; track?: unknown }> = await api(url);
      rows.push(...page.items);
      next = page.next;
    } catch (err) {
      if (err instanceof ServiceError && err.status === 404 && !triedLegacy && url.includes('/items')) {
        triedLegacy = true;
        next = url.replace('/items', '/tracks');
        continue;
      }
      if (err instanceof ServiceError && (err.status === 403 || err.status === 404)) {
        throw new SpotifyRestrictedError("Spotify doesn't let this app read that playlist", err.status, 'spotify');
      }
      throw err;
    }
  }
  return rows;
}

function rowsToTracks(rows: { item?: unknown; track?: unknown }[]): { tracks: Track[]; warnings: string[] } {
  const tracks: Track[] = [];
  let skipped = 0;
  let local = 0;
  for (const row of rows) {
    const t = rowTrack(row);
    if (!t || !t.duration_ms) {
      skipped++;
      continue;
    }
    const track = fromSpotifyTrack(t);
    if (track.local) local++;
    tracks.push(track);
  }
  const warnings: string[] = [];
  if (skipped) warnings.push(`${skipped} unavailable items skipped`);
  if (local) warnings.push(`${local} local files can't be saved back through the Spotify API`);
  return { tracks, warnings };
}

export async function loadPlaylist(id: string): Promise<LoadedPlaylist> {
  const user = await getMe();
  const pl = await api<SpPlaylist>(`/playlists/${id}`).catch((err) => {
    if (err instanceof ServiceError && (err.status === 403 || err.status === 404)) {
      throw new SpotifyRestrictedError("Spotify doesn't let this app read that playlist", err.status, 'spotify');
    }
    throw err;
  });
  const editable = pl.owner?.id === user.id || Boolean(pl.collaborative);
  const first = pl.items ?? pl.tracks;
  if (!editable && !first?.items?.length) {
    throw new SpotifyRestrictedError('Spotify only shares the songs of your own playlists with this app', 403, 'spotify');
  }
  const { tracks, warnings } = rowsToTracks(await playlistRows(id, first));
  return {
    ref: {
      service: 'spotify',
      id: pl.id,
      name: pl.name,
      owner: pl.owner?.display_name ?? pl.owner?.id,
      editable,
      url: pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}`,
      imageUrl: pickImage(pl.images ?? undefined, 300),
    },
    tracks,
    warnings,
  };
}

export async function loadAlbum(id: string): Promise<LoadedPlaylist> {
  const album = await api<{
    id: string;
    name: string;
    artists: { name: string }[];
    images: SpImage[];
    tracks: Paging<SpTrack>;
    external_urls?: { spotify?: string };
  }>(`/albums/${id}`);
  const items = [...album.tracks.items];
  let next = album.tracks.next;
  while (next) {
    const page: Paging<SpTrack> = await api(next);
    items.push(...page.items);
    next = page.next;
  }
  const tracks = items.map((t) => fromSpotifyTrack({ ...t, album: { id: album.id, name: album.name, images: album.images } }));
  return {
    ref: {
      service: 'spotify',
      id: album.id,
      name: album.name,
      owner: album.artists.map((a) => a.name).join(', '),
      editable: false,
      url: album.external_urls?.spotify,
      imageUrl: pickImage(album.images),
    },
    tracks,
  };
}

export async function getTrack(id: string): Promise<Track> {
  return fromSpotifyTrack(await api<SpTrack>(`/tracks/${id}`));
}

export async function search(q: string): Promise<Track[]> {
  // Development-mode apps get at most 10 results per request.
  const res = await api<{ tracks?: Paging<SpTrack> }>(`/search?type=track&limit=10&q=${encodeURIComponent(q)}`);
  return (res.tracks?.items ?? []).filter(Boolean).map(fromSpotifyTrack);
}

/** Finds the Spotify URI for a track that came from another service. */
export async function findUri(track: Track): Promise<string | null> {
  if (track.spotifyUri && !track.local) return track.spotifyUri;
  if (track.isrc) {
    const res = await api<{ tracks?: Paging<SpTrack> }>(`/search?type=track&limit=5&q=${encodeURIComponent(`isrc:${track.isrc}`)}`);
    const hit = res.tracks?.items?.[0];
    if (hit) return hit.uri;
  }
  const primaryArtist = track.artist.split(/,| feat\.? | & /i)[0].trim();
  const strict = await search(`track:${track.title} artist:${primaryArtist}`);
  const hit = bestMatch(track, strict) ?? bestMatch(track, await search(`${track.title} ${primaryArtist}`));
  return hit?.spotifyUri ?? null;
}

// --- Writing ----------------------------------------------------------------------------

async function writeItems(playlistId: string, method: 'PUT' | 'POST', uris: string[]) {
  try {
    await api(`/playlists/${playlistId}/items`, { method, body: JSON.stringify({ uris }) });
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) {
      await api(`/playlists/${playlistId}/tracks`, { method, body: JSON.stringify({ uris }) });
    } else throw err;
  }
}

/** Overwrites a playlist with exactly these songs, in this order. */
export async function replacePlaylist(playlistId: string, uris: string[]): Promise<void> {
  await writeItems(playlistId, 'PUT', uris.slice(0, 100));
  for (let i = 100; i < uris.length; i += 100) await writeItems(playlistId, 'POST', uris.slice(i, i + 100));
}

export async function createPlaylist(name: string, description: string, uris: string[]): Promise<{ id: string; url: string }> {
  const body = JSON.stringify({ name, description, public: false });
  let pl: { id: string; external_urls?: { spotify?: string } };
  try {
    pl = await api('/me/playlists', { method: 'POST', body });
  } catch (err) {
    if (!(err instanceof ServiceError) || (err.status !== 404 && err.status !== 405)) throw err;
    const user = await getMe();
    pl = await api(`/users/${encodeURIComponent(user.id)}/playlists`, { method: 'POST', body });
  }
  for (let i = 0; i < uris.length; i += 100) await writeItems(pl.id, 'POST', uris.slice(i, i + 100));
  return { id: pl.id, url: pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}` };
}
