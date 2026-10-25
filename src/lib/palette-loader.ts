// Loads album artwork into a small canvas and extracts its palette.
// Results are cached in memory and localStorage, keyed by artwork URL.

import { paletteFromPixels } from './colors';
import type { Palette } from './types';

const STORAGE_KEY = 'mixtape.palettes.v1';
const MAX_ENTRIES = 800;
const SIZE = 40;

let cache: Map<string, Palette> | null = null;
function store(): Map<string, Palette> {
  if (!cache) {
    try {
      cache = new Map(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as [string, Palette][]);
    } catch {
      cache = new Map();
    }
  }
  return cache;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = [...store().entries()].slice(-MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* storage full or unavailable */
    }
  }, 500);
}

export function cachedPalette(url: string): Palette | undefined {
  return store().get(url);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => reject(new Error('timeout')), 10000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('load failed'));
    };
    img.src = src;
  });
}

let canvas: HTMLCanvasElement | null = null;
function pixels(img: HTMLImageElement): Uint8ClampedArray {
  canvas ??= document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no canvas');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  return ctx.getImageData(0, 0, SIZE, SIZE).data; // throws if the image is cross-origin tainted
}

const inflight = new Map<string, Promise<Palette | null>>();
let active = 0;
const queue: (() => void)[] = [];
const CONCURRENCY = 6;

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

/** Palette for an artwork URL, or null if the image can't be read. */
export function loadPalette(url: string, opts: { proxy: boolean }): Promise<Palette | null> {
  const hit = store().get(url);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = withSlot(async () => {
    const attempts = [url, ...(opts.proxy ? [`/api/image?url=${encodeURIComponent(url)}`] : [])];
    for (const src of attempts) {
      try {
        const palette = paletteFromPixels(pixels(await loadImage(src)));
        store().set(url, palette);
        persist();
        return palette;
      } catch {
        /* try the next source */
      }
    }
    return null;
  }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
