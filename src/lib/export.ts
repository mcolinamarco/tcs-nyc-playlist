import { landmarksBetween } from './course';
import { formatClock, toUnits } from './format';
import type { Schedule } from './schedule';
import type { Track, Units } from './types';

export function planRows(tracks: Track[], schedule: Schedule, units: Units) {
  return tracks.map((t, i) => {
    const s = schedule.slots[i];
    const where =
      s.phase === 'pre' ? 'Before the start' : s.phase === 'post' ? 'After the finish' : `${toUnits(s.startD, units).toFixed(1)}–${toUnits(s.endD, units).toFixed(1)} ${units}`;
    return {
      n: i + 1,
      title: t.title,
      artist: t.artist,
      start: s.phase === 'race' ? formatClock(Math.max(0, s.startT), true) : '',
      where,
      landmark: s.phase === 'race' ? (landmarksBetween(s.startD, s.endD)[0]?.name ?? '') : '',
      length: formatClock(t.durationMs / 1000),
    };
  });
}

export function planText(name: string, finishSec: number, tracks: Track[], schedule: Schedule, units: Units): string {
  const lines = [`${name} — TCS NYC Marathon 2026, ${formatClock(finishSec, true)} finish`, ''];
  for (const r of planRows(tracks, schedule, units)) {
    lines.push(`${String(r.n).padStart(2)}. ${r.start.padEnd(8)} ${r.where.padEnd(17)} ${r.title} — ${r.artist}${r.landmark ? `  [${r.landmark}]` : ''}`);
  }
  return lines.join('\n');
}

export function planCsv(tracks: Track[], schedule: Schedule, units: Units): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = planRows(tracks, schedule, units);
  const header = ['#', 'Title', 'Artist', 'Race clock', `Where (${units})`, 'Landmark', 'Length'];
  return [header, ...rows.map((r) => [r.n, r.title, r.artist, r.start, r.where, r.landmark, r.length])].map((r) => r.map(esc).join(',')).join('\n');
}

export function download(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
