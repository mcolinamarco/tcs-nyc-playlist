import { useEffect, useState } from 'react';
import { ChevronDown, Mountain } from 'lucide-react';
import { usePlan } from '../state/plan';
import { useDerived } from '../state/derived';
import { averagePace, halfSplits, MAX_FINISH, MIN_FINISH } from '../lib/pacing';
import { formatClock, parseFinishTime } from '../lib/format';

const PRESETS = [
  { label: 'Sub-3', sec: 2 * 3600 + 59 * 60 },
  { label: '3:30', sec: 3.5 * 3600 },
  { label: '4:00', sec: 4 * 3600 },
  { label: '4:30', sec: 4.5 * 3600 },
  { label: '5:00', sec: 5 * 3600 },
];

export function PacePanel() {
  const pace = usePlan((s) => s.pace);
  const playback = usePlan((s) => s.playback);
  const units = usePlan((s) => s.units);
  const { model } = useDerived({ preview: false });
  const [first, second] = halfSplits(model);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(formatClock(pace.finishSec, true));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatClock(pace.finishSec, true));
  }, [pace.finishSec, editing]);

  const commitText = () => {
    setEditing(false);
    const sec = parseFinishTime(text);
    if (sec) usePlan.getState().setPace({ finishSec: Math.min(MAX_FINISH, Math.max(MIN_FINISH, sec)) });
  };

  const perMile = averagePace(pace.finishSec, 'mi');
  const perKm = averagePace(pace.finishSec, 'km');
  const fill = `${(100 * (pace.finishSec - MIN_FINISH)) / (MAX_FINISH - MIN_FINISH)}%`;

  return (
    <section className="pace-panel">
      <div className="pace-head">
        <div>
          <div className="eyebrow">Predicted finish</div>
          <input
            className="finish-input"
            value={text}
            inputMode="numeric"
            aria-label="Finish time (h:mm:ss)"
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const step = e.shiftKey ? 600 : 60;
                const next = pace.finishSec + (e.key === 'ArrowUp' ? step : -step);
                usePlan.getState().setPace({ finishSec: Math.min(MAX_FINISH, Math.max(MIN_FINISH, next)) });
              }
            }}
          />
        </div>
        <div className="pace-numbers">
          <div className={units === 'mi' ? 'strong' : ''}>{formatClock(perMile)} /mi</div>
          <div className={units === 'km' ? 'strong' : ''}>{formatClock(perKm)} /km</div>
        </div>
      </div>
      <input
        type="range"
        className="finish-slider"
        min={MIN_FINISH}
        max={MAX_FINISH}
        step={60}
        value={pace.finishSec}
        style={{ ['--fill' as string]: fill }}
        aria-label="Finish time"
        onChange={(e) => usePlan.getState().setPace({ finishSec: Number(e.target.value) })}
      />
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.label} className={`chip${Math.abs(pace.finishSec - p.sec) < 30 ? ' on' : ''}`} onClick={() => usePlan.getState().setPace({ finishSec: p.sec })}>
            {p.label}
          </button>
        ))}
      </div>
      <button className={`disclosure${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          Pacing &amp; playback
          <small>
            {pace.hills ? 'hills' : 'flat'} · {pace.split === 0 ? 'even split' : `${pace.split > 0 ? '+' : ''}${(pace.split * 100).toFixed(0)}% 2nd half`}
            {playback.crossfadeSec ? ` · ${playback.crossfadeSec}s crossfade` : ''}
            {playback.leadInSec ? ` · ${Math.round(playback.leadInSec / 60)}m before start` : ''}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="pace-advanced">
          <label className="toggle-row">
            <span>
              <Mountain size={15} /> Slow down on hills
              <small>Bridges and the Fifth Avenue hill take longer, at the same overall time</small>
            </span>
            <input type="checkbox" className="switch" checked={pace.hills} onChange={(e) => usePlan.getState().setPace({ hills: e.target.checked })} />
          </label>
          <label className="slider-row">
            <span>
              Split <b>{pace.split === 0 ? 'Even' : `${pace.split > 0 ? '+' : ''}${(pace.split * 100).toFixed(0)}%`}</b>
              <small>
                1st half {formatClock(first, true)} · 2nd half {formatClock(second, true)}
              </small>
            </span>
            <input
              type="range"
              min={-0.04}
              max={0.1}
              step={0.01}
              value={pace.split}
              onChange={(e) => usePlan.getState().setPace({ split: Number(e.target.value) })}
            />
          </label>
          <label className="slider-row">
            <span>
              Crossfade <b>{playback.crossfadeSec ? `${playback.crossfadeSec}s` : 'Off'}</b>
              <small>Match your music app's setting, since it shortens every song</small>
            </span>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={playback.crossfadeSec}
              onChange={(e) => usePlan.getState().setPlayback({ crossfadeSec: Number(e.target.value) })}
            />
          </label>
          <label className="slider-row">
            <span>
              Press play <b>{playback.leadInSec ? `${Math.round(playback.leadInSec / 60)} min before` : 'at the start line'}</b>
              <small>Music in the corral before you cross the start mat</small>
            </span>
            <input
              type="range"
              min={0}
              max={30 * 60}
              step={60}
              value={playback.leadInSec}
              onChange={(e) => usePlan.getState().setPlayback({ leadInSec: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </section>
  );
}
