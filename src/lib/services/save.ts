import type { Track } from '../types';
import { mapLimit } from './http';
import * as spotify from './spotify';
import * as apple from './apple';

export interface Progress {
  done: number;
  total: number;
  label: string;
}

export interface SaveResult {
  /** Id of the playlist written to (Spotify). */
  id?: string;
  url?: string;
  saved: number;
  unmatched: Track[];
}

export async function saveToSpotify(opts: {
  mode: 'replace' | 'new';
  playlistId?: string;
  name: string;
  description: string;
  tracks: Track[];
  onProgress: (p: Progress) => void;
}): Promise<SaveResult> {
  const total = opts.tracks.length;
  let done = 0;
  opts.onProgress({ done, total, label: 'Matching songs on Spotify…' });
  const uris = await mapLimit(opts.tracks, 3, async (t) => {
    const uri = t.local ? null : await spotify.findUri(t).catch(() => null);
    opts.onProgress({ done: ++done, total, label: 'Matching songs on Spotify…' });
    return uri;
  });
  const unmatched = opts.tracks.filter((_, i) => !uris[i]);
  const found = uris.filter((u): u is string => Boolean(u));
  opts.onProgress({ done: total, total, label: 'Saving playlist…' });
  if (opts.mode === 'replace' && opts.playlistId) {
    await spotify.replacePlaylist(opts.playlistId, found);
    return { id: opts.playlistId, url: `https://open.spotify.com/playlist/${opts.playlistId}`, saved: found.length, unmatched };
  }
  const created = await spotify.createPlaylist(opts.name, opts.description, found);
  return { id: created.id, url: created.url, saved: found.length, unmatched };
}

export async function saveToApple(opts: {
  name: string;
  description: string;
  tracks: Track[];
  onProgress: (p: Progress) => void;
}): Promise<SaveResult> {
  const total = opts.tracks.length;
  let done = 0;
  opts.onProgress({ done, total, label: 'Matching songs on Apple Music…' });
  const ids = await mapLimit(opts.tracks, 3, async (t) => {
    const id = await apple.findCatalogId(t).catch(() => null);
    opts.onProgress({ done: ++done, total, label: 'Matching songs on Apple Music…' });
    return id;
  });
  const unmatched = opts.tracks.filter((_, i) => !ids[i]);
  const found = ids.filter((x): x is NonNullable<typeof x> => Boolean(x));
  opts.onProgress({ done: total, total, label: 'Creating playlist in your library…' });
  await apple.createLibraryPlaylist(opts.name, opts.description, found);
  return { saved: found.length, unmatched };
}
