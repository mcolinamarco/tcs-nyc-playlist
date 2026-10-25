import { describe, expect, it } from 'vitest';
import { course, elevationAt, landmarkAt, MILE, pointAt, projectOntoCourse, sliceCourse } from './course';
import { buildTimeModel, halfSplits, hillFactor } from './pacing';
import { boundaries, computeSchedule } from './schedule';
import { insertionIndexForStart, moveTrack, placeTrackAt } from './reorder';
import { fallbackPalette, hexDeltaE, hexToLab, labToHex, paletteFromPixels, segmentColors } from './colors';
import { formatClock, parseFinishTime } from './format';
import type { Track } from './types';

const track = (n: number, sec: number, album = `album-${n}`): Track => ({
  uid: `u${n}`,
  id: `t${n}`,
  source: 'demo',
  title: `Song ${n}`,
  artist: 'Artist',
  albumKey: album,
  durationMs: sec * 1000,
});

describe('course', () => {
  it('is exactly a marathon long', () => {
    expect(course.distance).toBe(42195);
    expect(course.dist[0]).toBe(0);
    expect(course.dist[course.dist.length - 1]).toBeCloseTo(42195, 0);
    expect(course.elevation.length).toBe(Math.ceil(42195 / course.profileStep) + 1);
  });

  it('starts on Staten Island and finishes in Central Park', () => {
    const [lon0, lat0] = pointAt(0);
    expect(lon0).toBeLessThan(-74.05);
    expect(lat0).toBeLessThan(40.61);
    const [lon1, lat1] = pointAt(course.distance);
    expect(lon1).toBeCloseTo(-73.977, 2);
    expect(lat1).toBeCloseTo(40.772, 2);
  });

  it('slices include interior vertices and exact endpoints', () => {
    const s = sliceCourse(1000, 5000);
    expect(s.length).toBeGreaterThan(5);
    expect(s[0]).toEqual(pointAt(1000));
    expect(s[s.length - 1]).toEqual(pointAt(5000));
    expect(sliceCourse(3000, 3000)).toEqual([]);
  });

  it('projects a point back to its distance', () => {
    for (const d of [500, 10000, 21097, 33000, 42000]) {
      const p = projectOntoCourse(pointAt(d));
      expect(Math.abs(p.d - d)).toBeLessThan(2);
      expect(p.offset).toBeLessThan(1);
    }
  });

  it('knows the landmarks', () => {
    expect(landmarkAt(16.5 * MILE)?.id).toBe('first-ave');
    expect(landmarkAt(15.2 * MILE)?.id).toBe('queensboro');
    expect(landmarkAt(20.3 * MILE)?.id).toBe('bronx');
    expect(landmarkAt(course.distance)?.id).toBe('finish');
  });

  it('has real climbs on the bridges', () => {
    expect(elevationAt(1.05 * MILE) - elevationAt(0)).toBeGreaterThan(30);
    expect(elevationAt(15.3 * MILE) - elevationAt(14.7 * MILE)).toBeGreaterThan(20);
  });
});

describe('pacing', () => {
  it('even pace is linear', () => {
    const m = buildTimeModel({ finishSec: 4 * 3600, hills: false, split: 0 });
    expect(m.tAt(course.distance / 2)).toBeCloseTo(2 * 3600, 0);
    expect(m.tAt(course.distance)).toBe(4 * 3600);
    expect(m.dAt(3600)).toBeCloseTo(course.distance / 4, 0);
  });

  it('tAt and dAt are inverses', () => {
    const m = buildTimeModel({ finishSec: 3.5 * 3600, hills: true, split: 0.04 });
    for (const d of [0, 1234, 20000, 40000, course.distance]) expect(m.dAt(m.tAt(d))).toBeCloseTo(d, 3);
  });

  it('hills slow you down on the Queensboro but keep the finish time', () => {
    const m = buildTimeModel({ finishSec: 4 * 3600, hills: true, split: 0 });
    expect(m.tAt(course.distance)).toBe(4 * 3600);
    const climb = m.paceAt(15.2 * MILE);
    const flat = m.paceAt(17.5 * MILE);
    expect(climb).toBeGreaterThan(flat * 1.03);
    expect(hillFactor(0.02)).toBeGreaterThan(1);
    expect(hillFactor(-0.02)).toBeLessThan(1);
  });

  it('positive split makes the second half slower', () => {
    const m = buildTimeModel({ finishSec: 4 * 3600, hills: false, split: 0.05 });
    const [first, second] = halfSplits(m);
    expect(second).toBeGreaterThan(first);
    expect(first + second).toBeCloseTo(4 * 3600, 6);
    expect((second - first) / (4 * 3600)).toBeCloseTo(0.025, 2);
  });
});

describe('schedule', () => {
  const model = buildTimeModel({ finishSec: 1000, hills: false, split: 0 });

  it('lays songs end to end with crossfade and lead-in', () => {
    const tracks = [track(1, 200), track(2, 300), track(3, 100)];
    expect(boundaries(tracks, { leadInSec: 0, crossfadeSec: 0 })).toEqual([0, 200, 500, 600]);
    expect(boundaries(tracks, { leadInSec: 50, crossfadeSec: 10 })).toEqual([-50, 140, 430, 530]);
  });

  it('assigns phases, distances, gap and overflow', () => {
    const tracks = [track(1, 100), track(2, 400), track(3, 400), track(4, 300), track(5, 200)];
    const s = computeSchedule(tracks, model, { leadInSec: 120, crossfadeSec: 0 });
    expect(s.slots.map((x) => x.phase)).toEqual(['pre', 'race', 'race', 'race', 'post']);
    expect(s.slots[1].startD).toBe(0);
    expect(s.slots[3].endD).toBe(course.distance);
    expect(s.overflowSec).toBe(280);
    expect(s.finishIndex).toBe(3);

    const short = computeSchedule([track(1, 300)], model, { leadInSec: 0, crossfadeSec: 0 });
    expect(short.gapSec).toBe(700);
    expect(short.slots[0].endD).toBeCloseTo(course.distance * 0.3, 0);
  });
});

describe('reorder', () => {
  const tracks = [track(1, 100), track(2, 100), track(3, 100), track(4, 100)];
  const pb = { leadInSec: 0, crossfadeSec: 0 };

  it('moves items', () => {
    expect(moveTrack([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveTrack([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
  });

  it('snaps to the nearest song boundary', () => {
    const others = tracks.slice(1);
    expect(insertionIndexForStart(others, 0, pb)).toBe(0);
    expect(insertionIndexForStart(others, 140, pb)).toBe(1);
    expect(insertionIndexForStart(others, 260, pb)).toBe(3);
    expect(insertionIndexForStart(others, 9999, pb)).toBe(3);
  });

  it('places a track to start near a target time', () => {
    expect(placeTrackAt(tracks, 'u1', 210, pb).map((t) => t.uid)).toEqual(['u2', 'u3', 'u1', 'u4']);
    expect(placeTrackAt(tracks, 'u4', 0, pb).map((t) => t.uid)).toEqual(['u4', 'u1', 'u2', 'u3']);
    expect(placeTrackAt(tracks, 'u2', 90, pb)).toBe(tracks);
  });
});

describe('colors', () => {
  it('round-trips hex through OKLab', () => {
    for (const hex of ['#ff0000', '#1db954', '#fa243c', '#000000', '#ffffff', '#123456']) {
      expect(labToHex(hexToLab(hex))).toBe(hex);
    }
  });

  it('finds the two colours of a two-colour cover', () => {
    const px: number[] = [];
    for (let i = 0; i < 1600; i++) px.push(...(i < 1000 ? [220, 30, 60, 255] : [20, 60, 200, 255]));
    const p = paletteFromPixels(px);
    expect(hexDeltaE(p.primary, '#dc1e3c')).toBeLessThan(0.02);
    expect(hexDeltaE(p.secondary, '#143cc8')).toBeLessThan(0.02);
  });

  it('prefers a vivid accent over a large dull background', () => {
    const px: number[] = [];
    for (let i = 0; i < 1600; i++) px.push(...(i < 1300 ? [35, 35, 38, 255] : [255, 200, 0, 255]));
    const p = paletteFromPixels(px);
    expect(hexDeltaE(p.primary, '#ffc800')).toBeLessThan(0.03);
  });

  it('gives monochrome covers a distinct secondary', () => {
    const px: number[] = [];
    for (let i = 0; i < 400; i++) px.push(240, 240, 240, 255);
    const p = paletteFromPixels(px);
    expect(hexDeltaE(p.primary, p.secondary)).toBeGreaterThan(0.1);
  });

  it('alternates colours for songs from the same album', () => {
    const pal = { primary: '#e0245e', secondary: '#2aa3ef' };
    const other = { primary: '#33cc66', secondary: '#ffffff' };
    const colors = segmentColors([pal, pal, pal, other], 'dark');
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[1]).not.toBe(colors[2]);
    expect(colors[0]).toBe(colors[2]);
    for (let i = 1; i < colors.length; i++) expect(hexDeltaE(colors[i], colors[i - 1])).toBeGreaterThan(0.09);
  });

  it('fallback palettes are stable and varied', () => {
    expect(fallbackPalette('1989')).toEqual(fallbackPalette('1989'));
    expect(fallbackPalette('1989').primary).not.toBe(fallbackPalette('Ready to Die').primary);
  });
});

describe('format', () => {
  it('formats and parses times', () => {
    expect(formatClock(3 * 3600 + 45 * 60)).toBe('3:45:00');
    expect(formatClock(245)).toBe('4:05');
    expect(formatClock(-30)).toBe('−0:30');
    expect(parseFinishTime('3:45')).toBe(13500);
    expect(parseFinishTime('3:45:30')).toBe(13530);
    expect(parseFinishTime('225')).toBe(13500);
    expect(parseFinishTime('abc')).toBeNull();
  });
});
