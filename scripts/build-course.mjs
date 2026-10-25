#!/usr/bin/env node
// Builds src/data/course.json — the 2026 TCS NYC Marathon course used by the app.
//
// Source: the 2024 course line (Strava route 3238560279604318212, via
// github.com/distanzrunning/gpx). The 2011–2025 course was unchanged, so the
// only edit needed for 2026 is the Bronx reroute announced by NYRR in Sept 2026:
//
//   Willis Ave Bridge → left E 135th St → right Alexander Ave → (NEW) straight
//   past E 138th St → left E 141st St → left Third Ave → right E 138th St →
//   Madison Ave Bridge.
//
// The old loop (E 138th St → Rider Ave → E 140th St → Morris Ave) is removed.
// The new streets are placed from the street geometry already present in the
// source line, so they're good to roughly 20–40 m.
//
// The source elevation comes from a terrain model, which puts bridge decks at
// water level. The Verrazzano, Pulaski and Queensboro climbs are rebuilt from
// known deck heights. The finished line is scaled to exactly 42,195 m.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data/source/nyc-marathon-2024.geojson');
const OUT = path.join(ROOT, 'src/data/course.json');

const MARATHON_M = 42195;
const MILE = 1609.344;
const PROFILE_STEP = 50;
const R = 6371008.8;

const toRad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const p1 = toRad(a[1]);
  const p2 = toRad(b[1]);
  const dp = p2 - p1;
  const dl = toRad(b[0] - a[0]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function cumulative(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

// Local east/north metres around an origin — accurate enough over a few km.
function enu(origin) {
  const mLat = 111132.954 - 559.822 * Math.cos(2 * toRad(origin[1]));
  const mLon = 111412.84 * Math.cos(toRad(origin[1]));
  return {
    to: (p) => [(p[0] - origin[0]) * mLon, (p[1] - origin[1]) * mLat],
    from: ([x, y]) => [origin[0] + x / mLon, origin[1] + y / mLat],
  };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => scale(a, 1 / Math.hypot(a[0], a[1]));
const bearingVec = (deg) => [Math.sin(toRad(deg)), Math.cos(toRad(deg))];

function nearestIndex(line, p, from = 0, to = line.length) {
  let best = -1;
  let bestD = Infinity;
  for (let i = from; i < to; i++) {
    const d = haversine(line[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (bestD > 15) throw new Error(`anchor ${p} not found on line (closest ${bestD.toFixed(1)} m)`);
  return best;
}

function pointAt(line, cum, d) {
  if (d <= 0) return line[0];
  if (d >= cum[cum.length - 1]) return line[line.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [
    line[lo][0] + t * (line[hi][0] - line[lo][0]),
    line[lo][1] + t * (line[hi][1] - line[lo][1]),
    line[lo][2] + t * (line[hi][2] - line[lo][2]),
  ];
}

// Projects p onto the line, only considering vertices whose distance is
// within ±window of `expected` (the course passes close to itself in places).
function projectNear(line, cum, p, expected, window = 1500) {
  const frame = enu(p);
  let best = { d: Infinity, along: expected };
  for (let i = 0; i < line.length - 1; i++) {
    if (cum[i + 1] < expected - window || cum[i] > expected + window) continue;
    const a = frame.to(line[i]);
    const b = frame.to(line[i + 1]);
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(scale(a, -1), ab) / len2));
    const q = add(a, scale(ab, t));
    const d = Math.hypot(q[0], q[1]);
    if (d < best.d) best = { d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best.along;
}

// ---------------------------------------------------------------------------
const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const feature = src.features.find((f) => f.geometry?.type === 'LineString');
let line = feature.geometry.coordinates.map(([lon, lat, ele]) => [lon, lat, ele ?? 0]);

// Drop consecutive near-duplicate vertices.
line = line.filter((p, i) => i === 0 || haversine(line[i - 1], p) > 0.75);
const cum0 = cumulative(line);
const raw0 = cum0[cum0.length - 1];
const rawMi = (mi) => mi * MILE; // positions below are miles along the *source* line

// --- 1. Bridge elevations ---------------------------------------------------
// [startMi, startEle, peakMi, peakEle, endMi, endEle] along the source line.
const BRIDGES = [
  // Verrazzano-Narrows: upper deck about 69 m above the water at midspan.
  { name: 'Verrazzano', start: [0.0, 20], peak: [1.05, 69], end: [1.95, 17] },
  // Pulaski Bridge over Newtown Creek (bascule, about 12 m).
  { name: 'Pulaski', start: [12.93, 5], peak: [13.12, 14], end: [13.33, 6] },
  // Queensboro Bridge, lower level: the long, quiet climb.
  { name: 'Queensboro', start: [14.84, 6], peak: [15.42, 38], end: [15.95, 16] },
];
const easeSine = (u) => Math.sin((u * Math.PI) / 2);
for (const b of BRIDGES) {
  const [s, se] = b.start;
  const [p, pe] = b.peak;
  const [e, ee] = b.end;
  for (let i = 0; i < line.length; i++) {
    const d = cum0[i];
    if (d < rawMi(s) || d > rawMi(e)) continue;
    if (d <= rawMi(p)) line[i][2] = se + (pe - se) * easeSine((d - rawMi(s)) / (rawMi(p) - rawMi(s)));
    else line[i][2] = ee + (pe - ee) * easeSine((rawMi(e) - d) / (rawMi(e) - rawMi(p)));
  }
}

// --- 2. Landmark anchors (taken from the source line before the splice) -----
// Spans are [startMi, endMi] along the source line, converted to coordinates
// now and re-projected onto the final line afterwards.
const LANDMARKS = [
  { id: 'verrazzano', name: 'Verrazzano-Narrows Bridge', short: 'Verrazzano', span: [0, 1.95], note: 'Cannon, Sinatra, and the biggest climb of the day.' },
  { id: 'fourth-ave', name: 'Fourth Avenue, Brooklyn', short: '4th Ave', span: [2.55, 7.85], note: 'Five straight miles through Bay Ridge, Sunset Park and Park Slope.' },
  { id: 'barclays', name: 'Barclays Center', short: 'Barclays', span: [7.85, 8.15], note: 'Atlantic & Flatbush, one of the loudest corners in Brooklyn.' },
  { id: 'lafayette', name: 'Lafayette Avenue', short: 'Lafayette', span: [8.15, 9.25], note: 'Fort Greene and Clinton Hill, packed and loud.' },
  { id: 'bedford', name: 'Bedford Avenue, Williamsburg', short: 'Bedford', span: [9.25, 11.45], note: 'The quiet stretch, a good place for a song that carries you.' },
  { id: 'greenpoint', name: 'Greenpoint', short: 'Greenpoint', span: [11.45, 12.93], note: 'Manhattan Ave and McGuinness Blvd.' },
  { id: 'pulaski', name: 'Pulaski Bridge · Halfway', short: 'Pulaski', span: [12.93, 13.33], note: 'Halfway mark on the bridge into Queens.' },
  { id: 'lic', name: 'Long Island City', short: 'LIC', span: [13.33, 14.84], note: 'A short, loud lap of Queens.' },
  { id: 'queensboro', name: 'Queensboro Bridge', short: 'Queensboro', span: [14.84, 15.95], note: 'No spectators, a long climb, then the roar of First Avenue.' },
  { id: 'first-ave', name: 'First Avenue', short: '1st Ave', span: [16.1, 19.45], note: 'The wall of sound. Three-plus miles of crowds.' },
  { id: 'willis', name: 'Willis Avenue Bridge', short: 'Willis Ave', span: [19.45, 19.92], note: 'Into the Bronx.' },
  { id: 'bronx', name: 'The Bronx (new 2026 route)', short: 'Bronx', span: [19.92, 21.08], note: 'New for 2026: Alexander Ave → E 141st St → Third Ave → E 138th St.' },
  { id: 'madison', name: 'Madison Avenue Bridge', short: 'Madison Ave', span: [21.08, 21.22], note: 'Back to Manhattan. Mile 21.' },
  { id: 'harlem', name: 'Harlem · Fifth Avenue', short: 'Harlem', span: [21.22, 22.75], note: 'Marcus Garvey Park and the Harlem crowds.' },
  { id: 'fifth-hill', name: 'Fifth Avenue hill', short: '5th Ave hill', span: [22.75, 23.9], note: 'A slow mile-long drag up along the park.' },
  { id: 'central-park', name: 'Central Park', short: 'Central Park', span: [23.9, 25.5], note: 'Rolling hills inside the park.' },
  { id: 'cps', name: 'Central Park South', short: 'CPS', span: [25.5, 25.85], note: 'Half a mile to go.' },
  { id: 'finish', name: 'Columbus Circle → Finish', short: 'Finish', span: [25.85, 99], note: 'Back into the park at Columbus Circle. Tavern on the Green.' },
];
const BOROUGHS = [
  { name: 'Staten Island', span: [0, 1.05] },
  { name: 'Brooklyn', span: [1.05, 13.1] },
  { name: 'Queens', span: [13.1, 15.3] },
  { name: 'Manhattan', span: [15.3, 19.72] },
  { name: 'Bronx', span: [19.72, 21.12] },
  { name: 'Manhattan', span: [21.12, 99] },
];
const anchor = (mi) => {
  const d = Math.min(rawMi(mi), raw0);
  return { coord: pointAt(line, cum0, d), expected: d, end: d >= raw0 };
};
const landmarkAnchors = LANDMARKS.map((l) => ({ ...l, a: anchor(l.span[0]), b: anchor(l.span[1]) }));
const boroughAnchors = BOROUGHS.map((b) => ({ ...b, a: anchor(b.span[0]), b: anchor(b.span[1]) }));

// --- 3. 2026 Bronx reroute --------------------------------------------------
const ALEX_SOUTH = [-73.92628, 40.80854]; // Alexander Ave just north of E 135th St
const ALEX_NORTH = [-73.92537, 40.80975]; // Alexander Ave approaching E 138th St
const OLD_TURN_138 = [-73.92534, 40.81004]; // old left turn onto E 138th St
const ST138_EAST = [-73.92559, 40.81024]; // E 138th St, just west of Alexander
const ST138_WEST = [-73.927, 40.81098]; // E 138th St at Rider Ave (old turn north)
const MORRIS_138 = [-73.92799, 40.81188]; // E 138th St at Morris Ave (old loop rejoins)

const iAlexNorth = nearestIndex(line, ALEX_NORTH);
const iRider = nearestIndex(line, ST138_WEST, iAlexNorth);
const iMorris = nearestIndex(line, MORRIS_138, iRider);

const frame = enu(ALEX_NORTH);
const alexDir = norm(sub(frame.to(ALEX_NORTH), frame.to(ALEX_SOUTH)));
const st138Dir = norm(sub(frame.to(ST138_WEST), frame.to(ST138_EAST)));
// Alexander Ave ∩ E 138th St
const a138 = (() => {
  const p = frame.to(ALEX_NORTH);
  const q = frame.to(ST138_EAST);
  // p + s*alexDir = q + t*st138Dir
  const det = alexDir[0] * -st138Dir[1] - alexDir[1] * -st138Dir[0];
  const r = sub(q, p);
  const s = (r[0] * -st138Dir[1] - r[1] * -st138Dir[0]) / det;
  return add(p, scale(alexDir, s));
})();
void OLD_TURN_138;
const BLOCKS_138_TO_141 = 300; // metres along Alexander Ave
const ST141_LEN = 60; // the short jog west on E 141st St to Third Ave
const a141 = add(a138, scale(alexDir, BLOCKS_138_TO_141));
const t141 = add(a141, scale(bearingVec(297), ST141_LEN));
// Third Ave meets E 138th St about 105 m west of Alexander.
const t138 = add(a138, scale(st138Dir, 105));

const bronxEle = 8;
const newPts = [a141, t141, t138].map((p) => [...frame.from(p), bronxEle]);
// Densify the new straight streets so later slicing/elevation work is uniform.
function densify(pts, step = 25) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(haversine(a, b) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
  }
  return out;
}
const bronxSegment = densify([line[iAlexNorth], ...newPts, line[iRider], line[iMorris]]).slice(1, -1);
// Keep the part of E 138th St west of Third Ave (the source vertices between
// Third Ave and Rider Ave), dropping the old Rider/140th/Morris loop.
const spliced = [...line.slice(0, iAlexNorth + 1), ...bronxSegment, ...line.slice(iMorris)];
const oldLen = cum0[iMorris] - cum0[iAlexNorth];
line = spliced;

let cum = cumulative(line);
const raw = cum[cum.length - 1];
const newLen = raw - raw0 + oldLen;
console.log(`source line ${raw0.toFixed(0)} m; Bronx section ${oldLen.toFixed(0)} m → ${newLen.toFixed(0)} m; spliced ${raw.toFixed(0)} m`);

// --- 4. Normalise to 42.195 km ------------------------------------------------
const k = MARATHON_M / raw;
cum = cum.map((d) => d * k);

// --- 5. Elevation profile (smoothed, every 50 m) --------------------------------
const profile = [];
for (let d = 0; d <= MARATHON_M + 1e-6; d += PROFILE_STEP) profile.push(pointAt(line, cum, d)[2]);
if ((profile.length - 1) * PROFILE_STEP < MARATHON_M) profile.push(line[line.length - 1][2]);
const smooth = profile.map((_, i) => {
  const w = 3; // ±150 m
  let s = 0;
  let n = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(profile.length - 1, i + w); j++) {
    s += profile[j];
    n++;
  }
  return s / n;
});

// --- 6. Re-project landmarks onto the final line ------------------------------
const projected = (anc) => {
  if (anc.end) return MARATHON_M;
  if (anc.expected === 0) return 0;
  // Expected position on the final line: shift by the Bronx delta if past it.
  const shift = anc.expected > cum0[iMorris] ? raw - raw0 : 0;
  return projectNear(line, cum, anc.coord, (anc.expected + shift) * k, 1200);
};
const round1 = (x) => Math.round(x * 10) / 10;
const landmarks = landmarkAnchors.map(({ a, b, span, ...l }) => ({
  ...l,
  start: round1(projected(a)),
  end: round1(projected(b)),
}));
const boroughs = boroughAnchors.map(({ a, b, span, ...l }) => ({
  ...l,
  start: round1(projected(a)),
  end: round1(projected(b)),
}));

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const out = {
  name: 'TCS New York City Marathon',
  edition: 2026,
  date: '2026-11-01',
  distance: MARATHON_M,
  coords: line.map((p) => [round5(p[0]), round5(p[1])]),
  dist: cum.map(round1),
  profileStep: PROFILE_STEP,
  elevation: smooth.map(round1),
  landmarks,
  boroughs,
  points: [
    { id: 'start', name: 'Start · Fort Wadsworth', at: 0 },
    { id: 'half', name: 'Halfway', at: MARATHON_M / 2 },
    { id: 'finish', name: 'Finish · Tavern on the Green', at: MARATHON_M },
  ],
  source: {
    line: '2024 TCS NYC Marathon route (Strava route 3238560279604318212) via github.com/distanzrunning/gpx',
    changes: '2026 Bronx reroute spliced in (Alexander Ave → E 141st St → Third Ave → E 138th St); bridge elevations rebuilt; scaled to 42.195 km.',
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${path.relative(ROOT, OUT)}: ${out.coords.length} vertices, ${out.elevation.length} elevation samples, scale ${k.toFixed(5)}`);
for (const l of landmarks) console.log(`  ${l.short.padEnd(13)} ${(l.start / MILE).toFixed(2)}–${(l.end / MILE).toFixed(2)} mi`);
for (const b of boroughs) console.log(`  ${b.name.padEnd(13)} ${(b.start / MILE).toFixed(2)}–${(b.end / MILE).toFixed(2)} mi`);
