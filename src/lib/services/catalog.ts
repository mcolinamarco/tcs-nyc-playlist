// Keyless song search for people who haven't connected a service, and for
// filling in artwork for the demo playlist. Deezer first (generous rate
// limits), iTunes as a fallback. Both are called with JSONP: no CORS needed.

import type { Track } from '../types';
import { jsonp, newUid } from './http';
import { bestMatch } from './match';

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  preview?: string;
  explicit_lyrics?: boolean;
  artist: { name: string };
  album: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

interface ItunesTrack {
  wrapperType?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionId?: number;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
  trackExplicitness?: string;
}

function fromDeezer(t: DeezerTrack): Track {
  return {
    uid: newUid(),
    source: 'deezer',
    id: String(t.id),
    title: t.title,
    artist: t.artist.name,
    album: t.album.title,
    albumKey: `deezer-album:${t.album.id}`,
    durationMs: t.duration * 1000,
    artworkUrl: t.album.cover_big ?? t.album.cover_medium,
    previewUrl: t.preview || undefined,
    explicit: t.explicit_lyrics,
  };
}

function fromItunes(t: ItunesTrack): Track | null {
  if (!t.trackId || !t.trackName) return null;
  return {
    uid: newUid(),
    source: 'itunes',
    id: String(t.trackId),
    appleId: String(t.trackId),
    title: t.trackName,
    artist: t.artistName ?? '',
    album: t.collectionName,
    albumKey: `itunes-album:${t.collectionId ?? t.collectionName}`,
    durationMs: t.trackTimeMillis ?? 0,
    artworkUrl: t.artworkUrl100?.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/, '/600x600bb.jpg'),
    previewUrl: t.previewUrl,
    explicit: t.trackExplicitness === 'explicit',
  };
}

async function deezerSearch(q: string, limit: number): Promise<Track[]> {
  const res = await jsonp<{ data?: DeezerTrack[]; error?: unknown }>(
    `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}&output=jsonp`,
  );
  if (!res.data) throw new Error('Deezer search failed');
  return res.data.map(fromDeezer);
}

async function itunesSearch(q: string, limit: number): Promise<Track[]> {
  const res = await jsonp<{ results?: ItunesTrack[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=${limit}`,
  );
  return (res.results ?? []).map(fromItunes).filter((t): t is Track => Boolean(t));
}

export async function catalogSearch(q: string, limit = 20): Promise<Track[]> {
  try {
    return await deezerSearch(q, limit);
  } catch {
    return itunesSearch(q, limit);
  }
}

/**
 * Find one specific song (used to fill in artwork and exact durations).
 * Resolves to null when it isn't found; rejects when both catalogs are unreachable.
 */
export async function catalogFind(title: string, artist: string): Promise<Track | null> {
  const target = { title, artist };
  let reached = false;
  try {
    const q = `artist:"${artist.split(/,| feat| &/i)[0].trim()}" track:"${title}"`;
    const strict = await deezerSearch(q, 5);
    reached = true;
    const hit = bestMatch(target, strict, 0.6) ?? bestMatch(target, await deezerSearch(`${artist} ${title}`, 8), 0.6);
    if (hit) return hit;
  } catch {
    /* fall back to iTunes */
  }
  try {
    const results = await itunesSearch(`${artist} ${title}`, 8);
    return bestMatch(target, results, 0.6);
  } catch (err) {
    if (reached) return null;
    throw err;
  }
}
