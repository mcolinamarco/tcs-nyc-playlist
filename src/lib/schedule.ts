import type { Track } from './types';
import type { TimeModel } from './pacing';

export interface PlaybackSettings {
  /** Seconds of music before you cross the start line (0 = press play at the start). */
  leadInSec: number;
  /** Crossfade between songs in seconds, as set in your music app. */
  crossfadeSec: number;
}

export type Phase = 'pre' | 'race' | 'post';

export interface Slot {
  uid: string;
  index: number;
  /** Race time (s) when the song starts / hands over to the next one. */
  startT: number;
  endT: number;
  /** Course distance (m) covered while it plays, clamped to the course. */
  startD: number;
  endD: number;
  phase: Phase;
}

export interface Schedule {
  slots: Slot[];
  /** Race time when the music stops. */
  musicEndT: number;
  /** Seconds of silence before the finish (music runs out early). */
  gapSec: number;
  /** Seconds of music left over after the finish line. */
  overflowSec: number;
  /** Index of the song playing as you cross the finish, or -1. */
  finishIndex: number;
}

/** Seconds a track occupies before the next one starts. */
export function effectiveSec(track: Track, isLast: boolean, crossfadeSec: number): number {
  const dur = track.durationMs / 1000;
  return isLast ? dur : Math.max(1, dur - crossfadeSec);
}

/**
 * Race times at which each song starts, plus a final entry for when the
 * music stops: boundaries[i] is the start of track i.
 */
export function boundaries(tracks: Track[], playback: PlaybackSettings): number[] {
  const out = [0 - playback.leadInSec];
  for (let i = 0; i < tracks.length; i++) {
    out.push(out[i] + effectiveSec(tracks[i], i === tracks.length - 1, playback.crossfadeSec));
  }
  return out;
}

export function computeSchedule(tracks: Track[], model: TimeModel, playback: PlaybackSettings): Schedule {
  const b = boundaries(tracks, playback);
  const T = model.finishSec;
  let finishIndex = -1;
  const slots: Slot[] = tracks.map((track, index) => {
    const startT = b[index];
    const endT = b[index + 1];
    const phase: Phase = endT <= 0 ? 'pre' : startT >= T ? 'post' : 'race';
    if (startT < T && endT >= T) finishIndex = index;
    return {
      uid: track.uid,
      index,
      startT,
      endT,
      startD: model.dAt(Math.max(0, startT)),
      endD: model.dAt(Math.max(0, endT)),
      phase,
    };
  });
  const musicEndT = b[b.length - 1];
  return {
    slots,
    musicEndT,
    gapSec: Math.max(0, T - Math.max(0, musicEndT)),
    overflowSec: Math.max(0, musicEndT - T),
    finishIndex,
  };
}

/** Which slot is playing at race time t, and how far into it. */
export function slotAtTime(schedule: Schedule, t: number): { slot: Slot; offsetSec: number } | null {
  for (const slot of schedule.slots) {
    if (t >= slot.startT && t < slot.endT) return { slot, offsetSec: t - slot.startT };
  }
  return null;
}
