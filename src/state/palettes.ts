import { create } from 'zustand';
import { useEffect } from 'react';
import { fallbackPalette } from '../lib/colors';
import { cachedPalette, loadPalette } from '../lib/palette-loader';
import type { Palette, Track } from '../lib/types';

interface PaletteState {
  byUrl: Record<string, Palette>;
  failed: Record<string, true>;
  set(url: string, p: Palette | null): void;
}

export const usePalettes = create<PaletteState>()((set, get) => ({
  byUrl: {},
  failed: {},
  set(url, p) {
    if (p) set({ byUrl: { ...get().byUrl, [url]: p } });
    else set({ failed: { ...get().failed, [url]: true } });
  },
}));

export function paletteFor(track: Track, byUrl: Record<string, Palette>): Palette {
  const fromArt = track.artworkUrl ? (byUrl[track.artworkUrl] ?? cachedPalette(track.artworkUrl)) : undefined;
  if (fromArt) return fromArt;
  if (track.colorHints?.length) {
    const fb = fallbackPalette(track.albumKey);
    return { primary: track.colorHints[0], secondary: track.colorHints[1] ?? fb.secondary };
  }
  return fallbackPalette(track.albumKey);
}

/** Kicks off palette extraction for any artwork we haven't analysed yet. */
export function usePaletteLoading(tracks: Track[], proxy: boolean) {
  const byUrl = usePalettes((s) => s.byUrl);
  const failed = usePalettes((s) => s.failed);
  useEffect(() => {
    const urls = new Set(tracks.map((t) => t.artworkUrl).filter((u): u is string => Boolean(u)));
    for (const url of urls) {
      if (byUrl[url] || failed[url]) continue;
      const cached = cachedPalette(url);
      if (cached) {
        usePalettes.getState().set(url, cached);
        continue;
      }
      void loadPalette(url, { proxy }).then((p) => usePalettes.getState().set(url, p));
    }
  }, [tracks, proxy, byUrl, failed]);
}
