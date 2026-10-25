import { course as defaultCourse, profileDistances, MILE, type Course } from './course';

export interface PaceSettings {
  /** Target finish time in seconds (chip time). */
  finishSec: number;
  /** Slow down on climbs and speed up on descents, at the same effort. */
  hills: boolean;
  /**
   * Second half vs first half, as a fraction of the average pace.
   * 0 = even, 0.04 = second half ~4% slower (typical), -0.02 = negative split.
   */
  split: number;
}

export interface TimeModel {
  finishSec: number;
  distance: number;
  /** Elapsed race time (s) when the runner reaches distance d (m). */
  tAt(d: number): number;
  /** Distance (m) reached at elapsed race time t (s). */
  dAt(t: number): number;
  /** Instantaneous pace at distance d, in seconds per metre. */
  paceAt(d: number): number;
}

export const MIN_FINISH = 2 * 3600;
export const MAX_FINISH = 8 * 3600;

/** Time cost of a grade (rise/run): ~3.3% slower per 1% uphill, ~1.8% faster per 1% downhill. */
export function hillFactor(grade: number): number {
  const g = Math.max(-0.08, Math.min(0.08, grade));
  return g >= 0 ? 1 + 3.3 * g : 1 + 1.8 * g;
}

export function buildTimeModel(settings: PaceSettings, c: Course = defaultCourse): TimeModel {
  const pos = profileDistances(c);
  const n = pos.length;
  const D = c.distance;
  const a = 2 * settings.split;
  const weights = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const len = pos[i + 1] - pos[i];
    if (len <= 0) continue;
    const mid = (pos[i] + pos[i + 1]) / 2;
    const grade = (c.elevation[i + 1] - c.elevation[i]) / len;
    const hill = settings.hills ? hillFactor(grade) : 1;
    const split = 1 + a * (mid / D - 0.5);
    weights[i] = hill * Math.max(0.5, split);
  }
  // Cumulative time ∝ Σ weight·length, scaled so the finish matches exactly.
  const t = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) t[i + 1] = t[i] + weights[i] * (pos[i + 1] - pos[i]);
  const k = settings.finishSec / t[n - 1];
  for (let i = 0; i < n; i++) t[i] *= k;

  const idxForD = (d: number) => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pos[mid] <= d) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  return {
    finishSec: settings.finishSec,
    distance: D,
    tAt(d) {
      if (d <= 0) return 0;
      if (d >= D) return settings.finishSec;
      const i = idxForD(d);
      const f = (d - pos[i]) / (pos[i + 1] - pos[i]);
      return t[i] + f * (t[i + 1] - t[i]);
    },
    dAt(time) {
      if (time <= 0) return 0;
      if (time >= settings.finishSec) return D;
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (t[mid] <= time) lo = mid;
        else hi = mid;
      }
      const f = (time - t[lo]) / (t[lo + 1] - t[lo] || 1);
      return pos[lo] + f * (pos[lo + 1] - pos[lo]);
    },
    paceAt(d) {
      const i = Math.min(n - 2, idxForD(Math.max(0, Math.min(D, d))));
      return (t[i + 1] - t[i]) / (pos[i + 1] - pos[i] || 1);
    },
  };
}

export function averagePace(finishSec: number, unit: 'mi' | 'km', c: Course = defaultCourse): number {
  return finishSec / (c.distance / (unit === 'mi' ? MILE : 1000));
}

export function halfSplits(model: TimeModel): [number, number] {
  const half = model.tAt(model.distance / 2);
  return [half, model.finishSec - half];
}
