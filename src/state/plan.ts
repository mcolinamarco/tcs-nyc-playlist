import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEMO_NAME, demoTracks } from '../data/demo';
import type { Theme } from '../lib/colors';
import type { PaceSettings } from '../lib/pacing';
import { placeTrackAt, moveTrack, sameOrder } from '../lib/reorder';
import type { PlaybackSettings } from '../lib/schedule';
import type { LoadedPlaylist, PlaylistRef, Track, Units } from '../lib/types';

const HISTORY_LIMIT = 100;

export interface PlanState {
  playlist: PlaylistRef;
  tracks: Track[];
  /** Order as last loaded from / saved to the service — to show "unsaved changes". */
  savedOrder: string[];
  warnings: string[];
  pace: PaceSettings;
  playback: PlaybackSettings;
  units: Units;
  theme: Theme;
  selectedUid: string | null;
  past: Track[][];
  future: Track[][];

  loadPlaylist(loaded: LoadedPlaylist): void;
  loadDemo(): void;
  setTracks(tracks: Track[], record?: boolean): void;
  /** Patch fields of tracks by uid without touching undo history (enrichment). */
  patchTracks(patches: Record<string, Partial<Track>>): void;
  move(uid: string, toIndex: number): void;
  placeAt(uid: string, targetStartT: number): void;
  remove(uid: string): void;
  add(tracks: Track[], atIndex?: number): void;
  undo(): void;
  redo(): void;
  markSaved(ref?: Partial<PlaylistRef>): void;
  setPace(p: Partial<PaceSettings>): void;
  setPlayback(p: Partial<PlaybackSettings>): void;
  setUnits(u: Units): void;
  setTheme(t: Theme): void;
  select(uid: string | null): void;
}

const DEFAULT_PACE: PaceSettings = { finishSec: 4 * 3600, hills: true, split: 0.02 };
const DEFAULT_PLAYBACK: PlaybackSettings = { leadInSec: 0, crossfadeSec: 0 };

function demoPlan() {
  const tracks = demoTracks();
  return {
    playlist: { service: 'demo', name: DEMO_NAME } as PlaylistRef,
    tracks,
    savedOrder: tracks.map((t) => t.uid),
    warnings: [],
  };
}

export const usePlan = create<PlanState>()(
  persist(
    (set, get) => {
      const commit = (tracks: Track[], record = true) => {
        const { tracks: prev, past } = get();
        if (sameOrder(prev, tracks) && prev.length === tracks.length && prev.every((t, i) => t === tracks[i])) return;
        set({
          tracks,
          past: record ? [...past, prev].slice(-HISTORY_LIMIT) : past,
          future: record ? [] : get().future,
        });
      };
      return {
        ...demoPlan(),
        pace: DEFAULT_PACE,
        playback: DEFAULT_PLAYBACK,
        units: 'mi',
        theme: 'dark',
        selectedUid: null,
        past: [],
        future: [],

        loadPlaylist(loaded) {
          set({
            playlist: loaded.ref,
            tracks: loaded.tracks,
            savedOrder: loaded.tracks.map((t) => t.uid),
            warnings: loaded.warnings ?? [],
            selectedUid: null,
            // Undo history belongs to one playlist.
            past: [],
            future: [],
          });
        },
        loadDemo() {
          set({ ...demoPlan(), selectedUid: null, past: [], future: [] });
        },
        setTracks(tracks, record = true) {
          commit(tracks, record);
        },
        patchTracks(patches) {
          const apply = (list: Track[]) => list.map((t) => (patches[t.uid] ? { ...t, ...patches[t.uid] } : t));
          set({ tracks: apply(get().tracks), past: get().past.map(apply), future: get().future.map(apply) });
        },
        move(uid, toIndex) {
          const tracks = get().tracks;
          commit(moveTrack(tracks, tracks.findIndex((t) => t.uid === uid), toIndex));
        },
        placeAt(uid, targetStartT) {
          commit(placeTrackAt(get().tracks, uid, targetStartT, get().playback));
        },
        remove(uid) {
          commit(get().tracks.filter((t) => t.uid !== uid));
          if (get().selectedUid === uid) set({ selectedUid: null });
        },
        add(tracks, atIndex) {
          const list = get().tracks.slice();
          list.splice(atIndex ?? list.length, 0, ...tracks);
          commit(list);
        },
        undo() {
          const { past, tracks, future } = get();
          if (!past.length) return;
          set({ tracks: past[past.length - 1], past: past.slice(0, -1), future: [tracks, ...future] });
        },
        redo() {
          const { past, tracks, future } = get();
          if (!future.length) return;
          set({ tracks: future[0], past: [...past, tracks], future: future.slice(1) });
        },
        markSaved(ref) {
          set({ savedOrder: get().tracks.map((t) => t.uid), playlist: { ...get().playlist, ...ref } });
        },
        setPace(p) {
          set({ pace: { ...get().pace, ...p } });
        },
        setPlayback(p) {
          set({ playback: { ...get().playback, ...p } });
        },
        setUnits(units) {
          set({ units });
        },
        setTheme(theme) {
          set({ theme });
        },
        select(uid) {
          set({ selectedUid: uid });
        },
      };
    },
    {
      name: 'mixtape.plan.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        playlist: s.playlist,
        tracks: s.tracks,
        savedOrder: s.savedOrder,
        pace: s.pace,
        playback: s.playback,
        units: s.units,
        theme: s.theme,
      }),
    },
  ),
);

export function isDirty(s: Pick<PlanState, 'tracks' | 'savedOrder'>): boolean {
  return s.tracks.length !== s.savedOrder.length || s.tracks.some((t, i) => t.uid !== s.savedOrder[i]);
}
