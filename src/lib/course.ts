import raw from '../data/course.json';

export const MILE = 1609.344;
export const KM = 1000;

export interface Span {
  start: number;
  end: number;
}

export interface Landmark extends Span {
  id: string;
  name: string;
  short: string;
  note: string;
}

export interface Borough extends Span {
  name: string;
}

export interface CoursePoint {
  id: string;
  name: string;
  at: number;
}

export interface Course {
  name: string;
  edition: number;
  date: string;
  distance: number;
  coords: [number, number][];
  /** Cumulative distance (m) at each vertex of `coords`. */
  dist: number[];
  profileStep: number;
  /** Elevation (m) every `profileStep` metres; the last sample is at the finish. */
  elevation: number[];
  landmarks: Landmark[];
  boroughs: Borough[];
  points: CoursePoint[];
  bounds: [[number, number], [number, number]];
}

function withBounds(c: Omit<Course, 'bounds'>): Course {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of c.coords) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return { ...c, bounds: [[w, s], [e, n]] };
}

export const course: Course = withBounds(raw as unknown as Omit<Course, 'bounds'>);

/** Index i such that dist[i] <= d < dist[i+1] (clamped). */
function segmentIndex(c: Course, d: number): number {
  const { dist } = c;
  if (d <= 0) return 0;
  if (d >= dist[dist.length - 1]) return dist.length - 2;
  let lo = 0;
  let hi = dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function pointAt(d: number, c: Course = course): [number, number] {
  const i = segmentIndex(c, d);
  const a = c.coords[i];
  const b = c.coords[i + 1];
  const span = c.dist[i + 1] - c.dist[i] || 1;
  const t = Math.min(1, Math.max(0, (d - c.dist[i]) / span));
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/** The part of the course between two distances, as a coordinate list. */
export function sliceCourse(d0: number, d1: number, c: Course = course): [number, number][] {
  const start = Math.max(0, Math.min(d0, d1));
  const end = Math.min(c.distance, Math.max(d0, d1));
  if (end - start < 0.01) return [];
  const out: [number, number][] = [pointAt(start, c)];
  const i0 = segmentIndex(c, start);
  const i1 = segmentIndex(c, end);
  for (let i = i0 + 1; i <= i1; i++) out.push(c.coords[i]);
  out.push(pointAt(end, c));
  return out;
}

export function elevationAt(d: number, c: Course = course): number {
  const { elevation, profileStep, distance } = c;
  const x = Math.max(0, Math.min(distance, d));
  const i = Math.min(elevation.length - 2, Math.floor(x / profileStep));
  const d0 = i * profileStep;
  const d1 = Math.min((i + 1) * profileStep, distance);
  const t = d1 > d0 ? (x - d0) / (d1 - d0) : 0;
  return elevation[i] + t * (elevation[i + 1] - elevation[i]);
}

/** Distance (m) of each elevation sample. */
export function profileDistances(c: Course = course): number[] {
  return c.elevation.map((_, i) => Math.min(i * c.profileStep, c.distance));
}

export function landmarkAt(d: number, c: Course = course): Landmark | undefined {
  return c.landmarks.find((l) => d >= l.start && d < l.end) ?? (d >= c.distance ? c.landmarks[c.landmarks.length - 1] : undefined);
}

/** Landmarks overlapping [d0, d1), most-covered first. */
export function landmarksBetween(d0: number, d1: number, c: Course = course): Landmark[] {
  return c.landmarks
    .map((l) => ({ l, overlap: Math.min(d1, l.end) - Math.max(d0, l.start) }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .map((x) => x.l);
}

export function boroughAt(d: number, c: Course = course): Borough | undefined {
  return c.boroughs.find((b) => d >= b.start && d < b.end) ?? c.boroughs[c.boroughs.length - 1];
}

// --- Projection of an arbitrary point onto the course -------------------------

const LAT0 = 40.72;
const M_PER_DEG_LAT = 111132.954 - 559.822 * Math.cos((2 * LAT0 * Math.PI) / 180);
const M_PER_DEG_LON = 111412.84 * Math.cos((LAT0 * Math.PI) / 180);

let planar: [number, number][] | null = null;
function planarCoords(c: Course): [number, number][] {
  if (c === course && planar) return planar;
  const p = c.coords.map(([lon, lat]) => [lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT] as [number, number]);
  if (c === course) planar = p;
  return p;
}

export interface Projection {
  /** Distance along the course (m). */
  d: number;
  /** How far the point is from the course line (m). */
  offset: number;
}

/**
 * Nearest point on the course to [lon, lat]. If `near` is given, positions
 * within `window` metres of it win ties, so a drag doesn't jump to a
 * different stretch of the course that happens to run nearby.
 */
export function projectOntoCourse(
  lngLat: [number, number],
  opts: { near?: number; window?: number } = {},
  c: Course = course,
): Projection {
  const pts = planarCoords(c);
  const px = lngLat[0] * M_PER_DEG_LON;
  const py = lngLat[1] * M_PER_DEG_LAT;
  let best: Projection = { d: 0, offset: Infinity };
  let bestScore = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const offset = Math.hypot(px - qx, py - qy);
    const d = c.dist[i] + t * (c.dist[i + 1] - c.dist[i]);
    // Penalise jumps away from the previous position during a drag.
    const penalty = opts.near === undefined ? 0 : Math.max(0, Math.abs(d - opts.near) - (opts.window ?? 2000)) * 0.25;
    const score = offset + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = { d, offset };
    }
  }
  return best;
}
