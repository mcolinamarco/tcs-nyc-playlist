import { useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Pause, Play, Trash2, X } from 'lucide-react';
import { course, landmarksBetween, MILE } from '../lib/course';
import { formatClock, formatSpan, toUnits } from '../lib/format';
import { togglePreview } from '../lib/preview';
import { usePlan } from '../state/plan';
import { useDerived } from '../state/derived';
import { useUi } from '../state/ui';
import { Artwork } from './Artwork';

export function SongCard() {
  const selectedUid = usePlan((s) => s.selectedUid);
  const units = usePlan((s) => s.units);
  const previewUrl = useUi((s) => s.previewUrl);
  const { tracks, schedule, colors, palettes, model } = useDerived();
  const [mile, setMile] = useState('');
  const idx = tracks.findIndex((t) => t.uid === selectedUid);
  if (idx < 0) return null;
  const track = tracks[idx];
  const slot = schedule.slots[idx];
  const plan = usePlan.getState();
  const landmarks = slot.phase === 'race' ? landmarksBetween(slot.startD, slot.endD) : [];
  const unitLabel = units === 'mi' ? 'Mile' : 'Km';

  const moveTo = (d: number) => {
    plan.placeAt(track.uid, model.tAt(d));
    useUi.getState().requestFocus(track.uid);
  };
  const nudge = (delta: number) => {
    const to = Math.max(0, Math.min(tracks.length - 1, idx + delta));
    if (to !== idx) {
      plan.move(track.uid, to);
      useUi.getState().requestFocus(track.uid);
    }
  };

  return (
    <div className="song-card" style={{ ['--song' as string]: colors[idx] }}>
      <button className="icon-btn ghost song-card-close" onClick={() => plan.select(null)} aria-label="Close">
        <X size={16} />
      </button>
      <div className="song-card-top">
        <Artwork track={track} size={76} />
        <div className="song-card-text">
          <div className="song-card-pos">
            Song {idx + 1} of {tracks.length}
          </div>
          <div className="song-card-title">{track.title}</div>
          <div className="song-card-artist">{track.artist}</div>
          {track.album && <div className="song-card-album">{track.album}</div>}
        </div>
      </div>

      <div className="song-card-stats">
        {slot.phase === 'race' ? (
          <>
            <div>
              <span>Plays</span>
              <b>
                {unitLabel} {toUnits(slot.startD, units).toFixed(1)} → {toUnits(slot.endD, units).toFixed(1)}
              </b>
            </div>
            <div>
              <span>Race clock</span>
              <b>
                {formatClock(Math.max(0, slot.startT), true)} → {formatClock(Math.min(model.finishSec, slot.endT), true)}
              </b>
            </div>
          </>
        ) : (
          <div>
            <span>When</span>
            <b>{slot.phase === 'pre' ? `Before the start (${formatSpan(-slot.startT)} before)` : `After the finish (+${formatSpan(slot.startT - model.finishSec)})`}</b>
          </div>
        )}
        <div>
          <span>Length</span>
          <b>{formatClock(track.durationMs / 1000)}</b>
        </div>
        <div className="swatches" title="Album colours: primary / secondary">
          <i style={{ background: palettes[idx].primary }} />
          <i style={{ background: palettes[idx].secondary }} />
        </div>
      </div>

      {landmarks.length > 0 && (
        <div className="song-card-landmarks">
          {landmarks.slice(0, 3).map((l) => (
            <span key={l.id} className="landmark-chip big" title={l.note}>
              <MapPin size={12} /> {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="song-card-move">
        <select
          value=""
          onChange={(e) => {
            const l = course.landmarks.find((x) => x.id === e.target.value);
            if (l) moveTo(l.start + 1);
          }}
          aria-label="Move song to a landmark"
        >
          <option value="">Start this song at…</option>
          {course.landmarks.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({unitLabel.toLowerCase()} {toUnits(l.start, units).toFixed(1)})
            </option>
          ))}
        </select>
        <form
          className="mile-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(mile);
            if (Number.isFinite(v) && v >= 0) moveTo(Math.min(course.distance, v * (units === 'mi' ? MILE : 1000)));
            setMile('');
          }}
        >
          <input value={mile} onChange={(e) => setMile(e.target.value)} placeholder={units === 'mi' ? 'mile' : 'km'} inputMode="decimal" aria-label={`Start at ${unitLabel}`} />
          <button className="btn small" type="submit" disabled={!mile}>
            Go
          </button>
        </form>
      </div>

      <div className="song-card-actions">
        <button className="btn small" onClick={() => nudge(-1)} disabled={idx === 0} title="One song earlier">
          <ChevronLeft size={15} /> Earlier
        </button>
        <button className="btn small" onClick={() => nudge(1)} disabled={idx === tracks.length - 1} title="One song later">
          Later <ChevronRight size={15} />
        </button>
        {track.previewUrl && (
          <button className="btn small" onClick={() => togglePreview(track.previewUrl)}>
            {previewUrl === track.previewUrl ? <Pause size={14} /> : <Play size={14} />} Preview
          </button>
        )}
        <button className="btn small danger" onClick={() => plan.remove(track.uid)} title="Remove from plan">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
