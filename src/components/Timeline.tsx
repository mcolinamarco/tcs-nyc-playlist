import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { course, MILE, profileDistances, elevationAt, landmarkAt } from '../lib/course';
import { placeTrackAt, sameOrder } from '../lib/reorder';
import { boundaries, slotAtTime } from '../lib/schedule';
import { formatClock, formatMarker } from '../lib/format';
import { usePlan } from '../state/plan';
import { useDerived, useDrag } from '../state/derived';
import { useUi } from '../state/ui';

const PAD_X = 14;
const BAND_Y = 22;
const BAND_H = 30;
const ELE_Y = BAND_Y + BAND_H + 4;
const ELE_H = 46;
const AXIS_Y = ELE_Y + ELE_H;
const HEIGHT = AXIS_Y + 34;

const LABELLED_LANDMARKS = ['verrazzano', 'pulaski', 'queensboro', 'first-ave', 'bronx', 'fifth-hill', 'central-park'];

interface TimelineDrag {
  uid: string;
  x0: number;
  grabOffset: number;
  active: boolean;
  pointerId: number;
}

export function Timeline() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const derived = useDerived();
  const { tracks, schedule, colors, model } = derived;
  const units = usePlan((s) => s.units);
  const selectedUid = usePlan((s) => s.selectedUid);
  const hoverUid = useDrag((s) => s.hoverUid);
  const dragUid = useDrag((s) => s.uid);
  const cursorD = useDrag((s) => s.cursorD);
  const dragRef = useRef<TimelineDrag | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const D = course.distance;
  const innerW = Math.max(100, w - PAD_X * 2);
  const x = (d: number) => PAD_X + (d / D) * innerW;
  const dAtX = (px: number) => Math.max(0, Math.min(D, ((px - PAD_X) / innerW) * D));

  const profile = useMemo(() => {
    const pos = profileDistances();
    const lo = Math.min(...course.elevation);
    const hi = Math.max(...course.elevation);
    return { pos, lo, hi };
  }, []);
  const y = (e: number) => ELE_Y + ELE_H - 3 - ((e - profile.lo) / (profile.hi - profile.lo)) * (ELE_H - 8);

  const areaPath = (d0: number, d1: number) => {
    const pts: string[] = [`M${x(d0).toFixed(1)},${AXIS_Y}`, `L${x(d0).toFixed(1)},${y(elevationAt(d0)).toFixed(1)}`];
    for (let i = 0; i < profile.pos.length; i++) {
      const d = profile.pos[i];
      if (d > d0 && d < d1) pts.push(`L${x(d).toFixed(1)},${y(course.elevation[i]).toFixed(1)}`);
    }
    pts.push(`L${x(d1).toFixed(1)},${y(elevationAt(d1)).toFixed(1)}`, `L${x(d1).toFixed(1)},${AXIS_Y}Z`);
    return pts.join('');
  };
  const linePath = useMemo(
    () => profile.pos.map((d, i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(course.elevation[i]).toFixed(1)}`).join(''),
    [w],
  );

  const step = units === 'mi' ? MILE : 1000;
  const count = Math.floor(D / step);
  const labelEvery = innerW / count > 30 ? 1 : innerW / count > 15 ? 2 : 5;
  const focusUid = dragUid ?? selectedUid;

  // Landmark labels that fit without overlapping (≈6 px per character).
  const landmarkLabels = (() => {
    let lastEnd = -Infinity;
    return course.landmarks
      .filter((l) => LABELLED_LANDMARKS.includes(l.id))
      .filter((l) => {
        const start = x(l.start);
        const end = start + 3 + l.short.length * 6;
        if (start < lastEnd + 6 || end > w - PAD_X) return false;
        lastEnd = end;
        return true;
      });
  })();

  // --- Pointer handling ----------------------------------------------------------------
  const localX = (e: React.PointerEvent) => e.clientX - (wrapRef.current?.getBoundingClientRect().left ?? 0);

  const onPointerDown = (e: React.PointerEvent, uid: string) => {
    if (e.button !== 0) return;
    const slot = schedule.slots.find((s) => s.uid === uid);
    if (!slot) return;
    const d = dAtX(localX(e));
    dragRef.current = { uid, x0: e.clientX, grabOffset: model.tAt(d) - slot.startT, active: false, pointerId: e.pointerId };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dAtX(localX(e));
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      if (!drag.active) {
        if (Math.abs(e.clientX - drag.x0) < 4) return;
        drag.active = true;
        useDrag.getState().setDrag({ uid: drag.uid, source: 'timeline' });
      }
      const plan = usePlan.getState();
      const order = placeTrackAt(plan.tracks, drag.uid, model.tAt(d) - drag.grabOffset, plan.playback);
      const start = boundaries(order, plan.playback)[order.findIndex((t) => t.uid === drag.uid)];
      const prev = useDrag.getState().order ?? plan.tracks;
      useDrag.getState().setDrag(sameOrder(prev, order) ? { atD: model.dAt(Math.max(0, start)) } : { order, atD: model.dAt(Math.max(0, start)) });
      useDrag.getState().setCursor(null);
      return;
    }
    useDrag.getState().setCursor(d);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const plan = usePlan.getState();
    if (drag.active) {
      const order = useDrag.getState().order;
      if (order && !sameOrder(order, plan.tracks)) plan.setTracks(order);
      useDrag.getState().endDrag();
    }
    plan.select(drag.uid);
    useUi.getState().requestFocus(drag.uid);
  };

  // --- Cursor readout --------------------------------------------------------------------
  let readout: string | null = null;
  if (cursorD !== null && !dragUid) {
    const t = model.tAt(cursorD);
    const playing = slotAtTime(schedule, t);
    const ele = elevationAt(cursorD);
    const eleText = units === 'mi' ? `${Math.round(ele * 3.281)} ft` : `${Math.round(ele)} m`;
    const lm = landmarkAt(cursorD);
    readout = `${formatMarker(cursorD, units)} · ${formatClock(t, true)} · ${eleText}${lm ? ` · ${lm.short}` : ''}${playing ? ` · ♪ ${tracks[playing.slot.index]?.title}` : ''}`;
  }

  return (
    <div className="timeline" ref={wrapRef}>
      <svg
        width={w}
        height={HEIGHT}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          useDrag.getState().endDrag();
        }}
        onPointerLeave={() => !dragRef.current && useDrag.getState().setCursor(null)}
      >
        {/* Landmark labels along the top (hidden while the cursor readout is showing). */}
        {!readout &&
          landmarkLabels.map((l) => (
            <g key={l.id} className="tl-landmark">
              <line x1={x(l.start)} x2={x(l.start)} y1={13} y2={BAND_Y} />
              <text x={x(l.start) + 3} y={11}>
                {l.short}
              </text>
            </g>
          ))}
        {readout && (
          <text className="tl-readout" x={Math.min(Math.max(x(cursorD!), 160), w - 160)} y={12} textAnchor="middle">
            {readout}
          </text>
        )}

        {/* Elevation, coloured by song */}
        <path d={areaPath(0, D)} className="tl-ele-base" />
        {schedule.slots.map((s) =>
          s.phase === 'race' && s.endD > s.startD ? (
            <path key={s.uid} d={areaPath(s.startD, s.endD)} fill={colors[s.index]} className={`tl-ele${focusUid && focusUid !== s.uid ? ' dim' : ''}`} />
          ) : null,
        )}
        <path d={linePath} className="tl-ele-line" />

        {/* Song blocks */}
        {schedule.slots.map((s) => {
          if (s.phase !== 'race' || s.endD - s.startD < 1) return null;
          const x0 = x(s.startD);
          const bw = Math.max(1, x(s.endD) - x0 - 1);
          const track = tracks[s.index];
          const focused = s.uid === focusUid || s.uid === hoverUid;
          return (
            <g
              key={s.uid}
              className={`tl-song${focused ? ' focused' : ''}${focusUid && s.uid !== focusUid ? ' dim' : ''}${s.uid === dragUid ? ' dragging' : ''}`}
              onPointerDown={(e) => onPointerDown(e, s.uid)}
              onPointerEnter={() => useDrag.getState().setHover(s.uid)}
              onPointerLeave={() => useDrag.getState().setHover(null)}
            >
              <rect x={x0} y={BAND_Y} width={bw} height={BAND_H} rx={Math.min(4, bw / 2)} fill={colors[s.index]} />
              {bw >= 30 && track?.artworkUrl && (
                <image href={track.artworkUrl} x={x0 + 3} y={BAND_Y + 3} width={BAND_H - 6} height={BAND_H - 6} preserveAspectRatio="xMidYMid slice" />
              )}
              <title>
                {track?.title} — {track?.artist}
              </title>
            </g>
          );
        })}

        {/* Axis */}
        <line className="tl-axis" x1={PAD_X} x2={w - PAD_X} y1={AXIS_Y} y2={AXIS_Y} />
        {Array.from({ length: count }, (_, i) => i + 1).map((i) => (
          <g key={i} className="tl-tick">
            <line x1={x(i * step)} x2={x(i * step)} y1={AXIS_Y} y2={AXIS_Y + (i % 5 === 0 ? 6 : 3)} />
            {i % labelEvery === 0 && (
              <text x={x(i * step)} y={AXIS_Y + 15} textAnchor="middle">
                {i}
              </text>
            )}
          </g>
        ))}
        <text className="tl-unit" x={PAD_X} y={AXIS_Y + 15}>
          {units}
        </text>
        {course.boroughs.map((b, i) => (
          <g key={i} className="tl-borough">
            {i > 0 && <line x1={x(b.start)} x2={x(b.start)} y1={AXIS_Y + 20} y2={AXIS_Y + 32} />}
            {x(b.end) - x(b.start) > 44 && (
              <text x={(x(b.start) + x(b.end)) / 2} y={AXIS_Y + 30} textAnchor="middle">
                {x(b.end) - x(b.start) > 70 ? b.name : b.name.slice(0, 3)}
              </text>
            )}
          </g>
        ))}

        {/* Halfway + cursor */}
        <line className="tl-half" x1={x(D / 2)} x2={x(D / 2)} y1={BAND_Y - 2} y2={AXIS_Y} />
        {cursorD !== null && !dragUid && <line className="tl-cursor" x1={x(cursorD)} x2={x(cursorD)} y1={BAND_Y - 4} y2={AXIS_Y} />}
      </svg>
    </div>
  );
}
