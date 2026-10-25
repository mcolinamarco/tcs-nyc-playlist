import { useState } from 'react';
import type { Track } from '../lib/types';
import { usePalettes, paletteFor } from '../state/palettes';

/** Album art, or a tile in the album's colours while it loads / if there is none. */
export function Artwork({ track, size, color, className }: { track: Track; size: number; color?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const byUrl = usePalettes((s) => s.byUrl);
  const pal = paletteFor(track, byUrl);
  const showImg = track.artworkUrl && failed !== track.artworkUrl;
  const initials = (track.album || track.title)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <div
      className={`artwork ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${pal.primary}, ${pal.secondary})`,
        boxShadow: color ? `0 0 0 2px ${color}` : undefined,
      }}
    >
      {showImg ? (
        <img src={track.artworkUrl} alt="" loading="lazy" draggable={false} onError={() => setFailed(track.artworkUrl!)} />
      ) : (
        <span style={{ fontSize: Math.max(9, size * 0.32) }}>{initials}</span>
      )}
    </div>
  );
}
