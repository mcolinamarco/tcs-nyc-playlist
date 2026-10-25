import type { Palette } from './types';

// Colour work happens in OKLab: perceptually uniform, so distances and
// lightness clamps behave the way they look.

export type Lab = [number, number, number];
export type Theme = 'dark' | 'light';

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToLab(r8: number, g8: number, b8: number): Lab {
  const r = toLinear(r8 / 255);
  const g = toLinear(g8 / 255);
  const b = toLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Linear-light RGB, possibly out of [0, 1]. */
function labToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

export function lch(lab: Lab): [number, number, number] {
  const [L, a, b] = lab;
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

export function fromLch(L: number, C: number, h: number): Lab {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

/** Hex for a Lab colour, reducing chroma until it fits in sRGB. */
export function labToHex(lab: Lab): string {
  let [L, C, h] = lch(lab);
  L = Math.max(0, Math.min(1, L));
  let rgb = labToLinear(fromLch(L, C, h));
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinear(fromLch(L, mid, h)))) lo = mid;
      else hi = mid;
    }
    rgb = labToLinear(fromLch(L, lo, h));
  }
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.max(0, Math.min(1, toGamma(Math.max(0, c)))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function hexToLab(hex: string): Lab {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0.5, 0, 0];
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function hexDeltaE(a: string, b: string): number {
  return deltaE(hexToLab(a), hexToLab(b));
}

// --- Palette extraction ---------------------------------------------------------

interface Cluster {
  lab: Lab;
  share: number;
}

function kmeans(points: Lab[], k: number, iterations = 12): Cluster[] {
  if (points.length === 0) return [];
  // Deterministic farthest-point initialisation, seeded with the mean.
  const mean: Lab = [0, 0, 0];
  for (const p of points) for (let j = 0; j < 3; j++) mean[j] += p[j] / points.length;
  const centers: Lab[] = [mean];
  const nearestDist = points.map((p) => deltaE(p, mean));
  while (centers.length < k) {
    let far = 0;
    for (let i = 1; i < points.length; i++) if (nearestDist[i] > nearestDist[far]) far = i;
    if (nearestDist[far] < 0.02) break; // image has fewer distinct colours than k
    centers.push([...points[far]] as Lab);
    for (let i = 0; i < points.length; i++) nearestDist[i] = Math.min(nearestDist[i], deltaE(points[i], points[far]));
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = deltaE(points[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s[0] += points[i][0];
      s[1] += points[i][1];
      s[2] += points[i][2];
      s[3]++;
    }
    sums.forEach((s, c) => {
      if (s[3] > 0) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const counts = new Array(centers.length).fill(0);
  for (let i = 0; i < points.length; i++) counts[assign[i]]++;
  return centers.map((lab, c) => ({ lab, share: counts[c] / points.length })).filter((c) => c.share > 0);
}

/**
 * Primary = the most characteristic (vivid, well-represented) colour of the
 * artwork; secondary = a well-represented colour that looks clearly
 * different from it. Expects RGBA bytes (canvas ImageData).
 */
export function paletteFromPixels(data: ArrayLike<number>): Palette {
  const points: Lab[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    points.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
  }
  if (points.length === 0) return { primary: '#9aa4b2', secondary: '#d8dde5' };
  const clusters = kmeans(points, 6).filter((c) => c.share >= 0.015);

  const vividness = (c: Cluster) => {
    const [L, C] = lch(c.lab);
    const extreme = L < 0.18 || L > 0.96 ? 0.35 : 1;
    return Math.pow(c.share, 0.55) * (0.12 + Math.min(C, 0.25) * 3.2) * extreme;
  };
  const primary = clusters.reduce((a, b) => (vividness(b) > vividness(a) ? b : a));
  const rest = clusters.filter((c) => c !== primary && c.share >= 0.03);
  let secondary: Cluster | undefined;
  let bestScore = 0;
  for (const c of rest) {
    const [, C] = lch(c.lab);
    const score = deltaE(c.lab, primary.lab) * Math.pow(c.share, 0.35) * (0.5 + Math.min(C, 0.2) * 2.5);
    if (score > bestScore) {
      bestScore = score;
      secondary = c;
    }
  }
  const p = primary.lab;
  const s = secondary && deltaE(secondary.lab, p) > 0.06 ? secondary.lab : derivedSecondary(p);
  return { primary: labToHex(p), secondary: labToHex(s) };
}

/** A companion colour for single-colour artwork: shifted lightness and hue. */
function derivedSecondary(lab: Lab): Lab {
  const [L, C, h] = lch(lab);
  const L2 = L > 0.6 ? L - 0.25 : L + 0.25;
  return fromLch(L2, C < 0.04 ? C : C * 0.8, (h + 30) % 360);
}

/** Readable, distinctive colour from any string (album name, id). */
export function fallbackPalette(key: string): Palette {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 3600) / 10;
  return {
    primary: labToHex(fromLch(0.72, 0.15, hue)),
    secondary: labToHex(fromLch(0.86, 0.08, (hue + 40) % 360)),
  };
}

/** Adjusts a colour so it reads as a line on the map's basemap. */
export function forDisplay(hex: string, theme: Theme): string {
  const [L, C, h] = lch(hexToLab(hex));
  const [lo, hi] = theme === 'dark' ? [0.64, 0.93] : [0.4, 0.72];
  const L2 = Math.max(lo, Math.min(hi, L));
  // Near-greys stay grey; everything else keeps (or gains a little) chroma.
  const C2 = C < 0.03 ? C : Math.max(C, 0.06);
  return labToHex(fromLch(L2, C2, h));
}

const MIN_NEIGHBOUR_DE = 0.1;

/**
 * Colour for each song's stretch of course. Uses each album's primary colour
 * unless it would blend into the previous song, in which case the secondary
 * is used — so consecutive songs from one album alternate.
 */
export function segmentColors(palettes: Palette[], theme: Theme): string[] {
  const out: string[] = [];
  let prev: Lab | null = null;
  for (const pal of palettes) {
    const a = forDisplay(pal.primary, theme);
    const b = forDisplay(pal.secondary, theme);
    let pick = a;
    if (prev) {
      const da = deltaE(hexToLab(a), prev);
      const db = deltaE(hexToLab(b), prev);
      if (da < MIN_NEIGHBOUR_DE && db > da) pick = b;
      if (Math.max(da, db) < MIN_NEIGHBOUR_DE) {
        // Both too close (e.g. same mono-colour album twice): shift lightness.
        const [L, C, h] = lch(hexToLab(pick));
        pick = forDisplay(labToHex(fromLch(L > 0.78 ? L - 0.2 : L + 0.16, C, h)), theme);
      }
    }
    out.push(pick);
    prev = hexToLab(pick);
  }
  return out;
}

/** Black or white text on top of a colour. */
export function textOn(hex: string): string {
  return hexToLab(hex)[0] > 0.68 ? '#0b0d12' : '#ffffff';
}
