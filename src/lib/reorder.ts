import type { Track } from './types';
import { boundaries, type PlaybackSettings } from './schedule';

export function moveTrack<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/**
 * Where to insert a song so that it starts as close as possible to
 * `targetStartT` (race seconds). `others` is the playlist without the song.
 */
export function insertionIndexForStart(others: Track[], targetStartT: number, playback: PlaybackSettings): number {
  const b = boundaries(others, playback);
  let best = 0;
  let bestDiff = Infinity;
  for (let k = 0; k < b.length; k++) {
    const diff = Math.abs(b[k] - targetStartT);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

/** The playlist with `uid` moved so it starts nearest to `targetStartT`. */
export function placeTrackAt(tracks: Track[], uid: string, targetStartT: number, playback: PlaybackSettings): Track[] {
  const from = tracks.findIndex((t) => t.uid === uid);
  if (from < 0) return tracks;
  const others = tracks.filter((t) => t.uid !== uid);
  const k = insertionIndexForStart(others, targetStartT, playback);
  if (k === from) return tracks;
  others.splice(k, 0, tracks[from]);
  return others;
}

export function sameOrder(a: Track[], b: Track[]): boolean {
  return a.length === b.length && a.every((t, i) => t.uid === b[i].uid);
}
