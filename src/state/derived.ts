import { create } from 'zustand';
import { useEffect, useMemo } from 'react';
import { buildTimeModel, type TimeModel } from '../lib/pacing';
import { computeSchedule, type Schedule } from '../lib/schedule';
import { catalogFind } from '../lib/services/catalog';
import type { Palette, Track } from '../lib/types';
import { usePlan } from './plan';
import { useTrackColors } from './palettes';

/** Live state while a song is being dragged along the course or timeline. */
interface DragState {
  uid: string | null;
  /** Which view started the drag. */
  source: 'map' | 'timeline' | 'list' | null;
  /** The playlist order the drop would produce. */
  order: Track[] | null;
  /** Where the dragged song would start (m). */
  atD: number | null;
  /** Course position under the pointer (m), e.g. while hovering the timeline. */
  cursorD: number | null;
  hoverUid: string | null;
  setDrag(p: Partial<Pick<DragState, 'uid' | 'order' | 'atD' | 'source'>>): void;
  endDrag(): void;
  setCursor(d: number | null): void;
  setHover(uid: string | null): void;
}

export const useDrag = create<DragState>()((set) => ({
  uid: null,
  source: null,
  order: null,
  atD: null,
  cursorD: null,
  hoverUid: null,
  setDrag: (p) => set(p),
  endDrag: () => set({ uid: null, source: null, order: null, atD: null }),
  setCursor: (cursorD) => set({ cursorD }),
  setHover: (hoverUid) => set({ hoverUid }),
}));

export interface Derived {
  tracks: Track[];
  model: TimeModel;
  schedule: Schedule;
  palettes: Palette[];
  colors: string[];
}

/**
 * Everything the views draw from: the drag preview order while a song is being
 * dragged (unless `preview` is false), otherwise the plan.
 */
export function useDerived(opts: { preview?: boolean } = {}): Derived {
  const planTracks = usePlan((s) => s.tracks);
  const pace = usePlan((s) => s.pace);
  const playback = usePlan((s) => s.playback);
  const theme = usePlan((s) => s.theme);
  const previewOrder = useDrag((s) => s.order);
  const tracks = (opts.preview !== false && previewOrder) || planTracks;
  const model = useMemo(() => buildTimeModel(pace), [pace]);
  const schedule = useMemo(() => computeSchedule(tracks, model, playback), [tracks, model, playback]);
  const { palettes, colors } = useTrackColors(tracks, theme);
  return { tracks, model, schedule, palettes, colors };
}

// --- Demo enrichment ---------------------------------------------------------------

const ENRICH_KEY = 'mixtape.enrich.v1';
type Enriched = Pick<Track, 'artworkUrl' | 'durationMs' | 'album' | 'albumKey' | 'previewUrl' | 'appleId'> | null;
const attempted = new Set<string>();

function enrichCache(): Record<string, Enriched> {
  try {
    return JSON.parse(localStorage.getItem(ENRICH_KEY) ?? '{}') as Record<string, Enriched>;
  } catch {
    return {};
  }
}

/** Fills in artwork / exact durations for demo songs from Deezer or iTunes. */
export function useDemoEnrichment() {
  const tracks = usePlan((s) => s.tracks);
  useEffect(() => {
    const todo = tracks.filter((t) => t.source === 'demo' && !t.artworkUrl && !attempted.has(`${t.artist}|${t.title}`));
    if (!todo.length) return;
    const cache = enrichCache();
    const patches: Record<string, Partial<Track>> = {};
    const toFetch: Track[] = [];
    for (const t of todo) {
      const key = `${t.artist}|${t.title}`;
      attempted.add(key);
      const hit = cache[key];
      if (hit) patches[t.uid] = hit;
      else if (hit === undefined) toFetch.push(t);
    }
    if (Object.keys(patches).length) usePlan.getState().patchTracks(patches);
    if (!toFetch.length) return;

    let pending: Record<string, Partial<Track>> = {};
    const flush = () => {
      if (Object.keys(pending).length) usePlan.getState().patchTracks(pending);
      pending = {};
    };
    const timer = setInterval(flush, 400);
    (async () => {
      const queue = [...toFetch];
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (queue.length) {
            const t = queue.shift()!;
            const key = `${t.artist}|${t.title}`;
            const found = await catalogFind(t.title, t.artist).catch(() => undefined);
            if (found === undefined) continue; // network failure: try again next visit
            const patch: Enriched = found
              ? {
                  artworkUrl: found.artworkUrl,
                  // Keep our duration if the catalog found a very different version.
                  durationMs: Math.abs(found.durationMs - t.durationMs) < 45000 ? found.durationMs : t.durationMs,
                  album: found.album ?? t.album,
                  albumKey: found.albumKey,
                  previewUrl: found.previewUrl,
                  appleId: found.appleId,
                }
              : null;
            cache[key] = patch;
            if (patch) pending[t.uid] = patch;
          }
        }),
      );
      try {
        localStorage.setItem(ENRICH_KEY, JSON.stringify(cache));
      } catch {
        /* ignore */
      }
      clearInterval(timer);
      flush();
    })();
    // No cleanup: patching tracks re-runs this effect, and `attempted` already
    // keeps songs from being looked up twice.
  }, [tracks]);
}
