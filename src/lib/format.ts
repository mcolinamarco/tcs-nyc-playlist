import { MILE } from './course';
import type { Units } from './types';

/** 3:45:00 for long durations, 4:05 for short ones. */
export function formatClock(totalSec: number, forceHours = false): string {
  const neg = totalSec < 0;
  const s = Math.round(Math.abs(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const body =
    h > 0 || forceHours
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  return neg ? `−${body}` : body;
}

/** "1h 12m", "7m", "45s" */
export function formatSpan(totalSec: number): string {
  const s = Math.round(Math.abs(totalSec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatPace(secPerUnit: number, units: Units): string {
  return `${formatClock(secPerUnit)} /${units}`;
}

export function toUnits(meters: number, units: Units): number {
  return meters / (units === 'mi' ? MILE : 1000);
}

export function formatDistance(meters: number, units: Units, digits = 1): string {
  return `${toUnits(meters, units).toFixed(digits)} ${units}`;
}

/** "Mile 13.1" / "Km 21.1" */
export function formatMarker(meters: number, units: Units): string {
  return `${units === 'mi' ? 'Mile' : 'Km'} ${toUnits(meters, units).toFixed(1)}`;
}

/** Parses "3:45", "3:45:00", "225" (minutes) into seconds. */
export function parseFinishTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 1) return nums[0] * 60;
  if (nums.length === 2) return nums[0] * 3600 + nums[1] * 60;
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  return null;
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
