// Fuzzy matching between services ("Song - 2014 Remaster" ≈ "Song").

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([](feat|ft|with|from|remaster|remastered|live|radio edit|single version|album version|explicit|clean)[^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(.*remaster.*|.*version.*|.*edit.*|live.*|mono|stereo)$/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeArtist(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/,|&| and | feat\.? | ft\.? | x | with /)
    .map((a) => a.replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean);
}

/** 0..1 — how likely two (title, artist, duration) triples are the same recording. */
export function matchScore(
  a: { title: string; artist: string; durationMs?: number },
  b: { title: string; artist: string; durationMs?: number },
): number {
  const ta = normalizeTitle(a.title);
  const tb = normalizeTitle(b.title);
  let title = 0;
  if (ta === tb) title = 1;
  else if (ta && tb && (ta.startsWith(tb) || tb.startsWith(ta))) title = 0.75;
  else if (ta && tb && (ta.includes(tb) || tb.includes(ta))) title = 0.55;
  const aa = normalizeArtist(a.artist);
  const ab = normalizeArtist(b.artist);
  const artist = aa.some((x) => ab.some((y) => x === y || x.includes(y) || y.includes(x))) ? 1 : 0;
  let duration = 0.5;
  if (a.durationMs && b.durationMs) {
    const diff = Math.abs(a.durationMs - b.durationMs) / 1000;
    duration = diff < 3 ? 1 : diff < 10 ? 0.8 : diff < 30 ? 0.4 : 0;
  }
  return title * 0.55 + artist * 0.3 + duration * 0.15;
}

export function bestMatch<T extends { title: string; artist: string; durationMs?: number }>(
  target: { title: string; artist: string; durationMs?: number },
  candidates: T[],
  threshold = 0.7,
): T | null {
  let best: T | null = null;
  let bestScore = threshold;
  for (const c of candidates) {
    const s = matchScore(target, c);
    if (s >= bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}
