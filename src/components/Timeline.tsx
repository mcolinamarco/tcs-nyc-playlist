import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { course, MILE, profileDistances, elevationAt, landmarkAt } from '../lib/course';
import { placeTrackAt, sameOrder } from '../lib/reorder';
import { boundaries, slotAtTime } from '../lib/schedule';
import { formatClock, formatMarker, toUnits } from '../lib/format';
import { textOn } from '../lib/colors';
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

const D = course.distance;
/** Narrowest window the timeline can zoom to (m). */
const MIN_SPAN = 600;
const LABELLED_LANDMARKS = ['verrazzano', 'pulaski', 'queensboro', 'first-ave', 'bronx', 'fifth-hill', 'central-park'];
const TICK_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];

type View = [number, number];

interface TimelineDrag {
  uid: string;
  x0: number;
  grabOffset: number;
  active: boolean;
  pointerId: number;
}

/** Keeps a window inside the course and at least MIN_SPAN wide. */
function clampView(v0: number, v1: number): View {
  const span = Math.min(D, Math.max(MIN_SPAN, v1 - v0));
  const start = Math.max(0, Math.min(D - span, v0));
  return [start, start + span];
}

export function Timeline() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [view, setView] = useState<View>([0, D]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const derived = useDerived();
  const { tracks, schedule, colors, model } = derived;
  const units = usePlan((s) => s.units);
  const selectedUid = usePlan((s) => s.selectedUid);
  const hoverUid = useDrag((s) => s.hoverUid);
  const dragUid = useDrag((s) => s.uid);
  const cursorD = useDrag((s) => s.cursorD);
  const focus = useUi((s) => s.focus);
  const dragRef = useRef<TimelineDrag | null>(null);
  const panRef = useRef<{ pointerId: number; x0: number; view: View; moved: boolean } | null>(null);
  const touches = useRef(new Map<number, number>());
  const pinchRef = useRef<{ dist: number; mid: number; view: View } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const [v0, v1] = view;
  const span = v1 - v0;
  const zoomed = span < D - 1;
  const innerW = Math.max(100, w - PAD_X * 2);
  const x = (d: number) => PAD_X + ((d - v0) / span) * innerW;
  const dAtX = (px: number) => Math.max(0, Math.min(D, v0 + ((px - PAD_X) / innerW) * span));

  /** Zoom by `factor` (<1 zooms in) keeping the point under `px` fixed. */
  const zoomAt = (factor: number, px: number) => {
    const [a, b] = viewRef.current;
    const s = b - a;
    const anchor = a + ((px - PAD_X) / innerW) * s;
    const s2 = Math.min(D, Math.max(MIN_SPAN, s * factor));
    const frac = (anchor - a) / s;
    setView(clampView(anchor - frac * s2, anchor - frac * s2 + s2));
  };
  const panBy = (meters: number) => {
    const [a, b] = viewRef.current;
    setView(clampView(a + meters, b + meters));
  };

  // Wheel / trackpad: vertical scroll and pinch zoom, horizontal scroll pans.
  // (A native listener: React's wheel handler is passive and can't preventDefault.)
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.clientX - el.getBoundingClientRect().left;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal && !e.ctrlKey) {
        const [a, b] = viewRef.current;
        panBy(((e.deltaX || e.deltaY) / innerW) * (b - a));
      } else {
        zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0015)), px);
      }
    };
    // Safari trackpad pinch
    let gestureStart: View | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = viewRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number };
      if (!gestureStart) return;
      const [a, b] = gestureStart;
      const px = ge.clientX - el.getBoundingClientRect().left;
      const anchor = a + ((px - PAD_X) / innerW) * (b - a);
      const s2 = Math.min(D, Math.max(MIN_SPAN, (b - a) / ge.scale));
      const frac = (anchor - a) / (b - a);
      setView(clampView(anchor - frac * s2, anchor - frac * s2 + s2));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [innerW]); // zoomAt/panBy only read refs and innerW

  // When a song is selected elsewhere and it's outside the zoomed window, bring it into view.
  useEffect(() => {
    if (!focus) return;
    const slot = schedule.slots.find((s) => s.uid === focus.uid);
    if (!slot || slot.phase !== 'race') return;
    const [a, b] = viewRef.current;
    if (slot.startD >= a && slot.endD <= b) return;
    const s = b - a;
    const mid = (slot.startD + slot.endD) / 2;
    setView(clampView(mid - s / 2, mid + s / 2));
  }, [focus]); // only when a new focus is requested

  const profile = useMemo(() => {
    const pos = profileDistances();
    const lo = Math.min(...course.elevation);
    const hi = Math.max(...course.elevation);
    return { pos, lo, hi };
  }, []);
  const y = (e: number) => ELE_Y + ELE_H - 3 - ((e - profile.lo) / (profile.hi - profile.lo)) * (ELE_H - 8);

  const areaPath = (d0: number, d1: number) => {
    const a = Math.max(d0, v0);
    const b = Math.min(d1, v1);
    if (b <= a) return '';
    const pts: string[] = [`M${x(a).toFixed(1)},${AXIS_Y}`, `L${x(a).toFixed(1)},${y(elevationAt(a)).toFixed(1)}`];
    // Only the samples inside [a, b] (samples are evenly spaced).
    const last = Math.min(profile.pos.length - 1, Math.ceil(b / course.profileStep));
    for (let i = Math.max(0, Math.floor(a / course.profileStep)); i <= last; i++) {
      const d = profile.pos[i];
      if (d > a && d < b) pts.push(`L${x(d).toFixed(1)},${y(course.elevation[i]).toFixed(1)}`);
    }
    pts.push(`L${x(b).toFixed(1)},${y(elevationAt(b)).toFixed(1)}`, `L${x(b).toFixed(1)},${AXIS_Y}Z`);
    return pts.join('');
  };
  const linePath = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < profile.pos.length; i++) {
      const d = profile.pos[i];
      // one sample either side of the window so the line reaches the edges
      if (d < v0 - 100 || d > v1 + 100) continue;
      pts.push(`${pts.length ? 'L' : 'M'}${x(d).toFixed(1)},${y(course.elevation[i]).toFixed(1)}`);
    }
    return pts.join('');
  }, [w, v0, v1]);

  // Axis ticks adapt to the zoom: labels at least ~34 px apart, minor ticks ~8 px.
  const unitM = units === 'mi' ? MILE : 1000;
  const pxPerUnit = (innerW / span) * unitM;
  const labelStep = TICK_STEPS.find((s) => s * pxPerUnit >= 34) ?? 10;
  const tickStep = TICK_STEPS.find((s) => s * pxPerUnit >= 8 && labelStep % s < 1e-9) ?? labelStep;
  const ticks: { d: number; label: string | null; major: boolean }[] = [];
  for (let k = Math.ceil(toUnits(v0, units) / tickStep); k * tickStep <= toUnits(v1, units) + 1e-9; k++) {
    const u = Math.round(k * tickStep * 1000) / 1000;
    if (u <= 0) continue;
    const isLabel = Math.abs(u / labelStep - Math.round(u / labelStep)) < 1e-6;
    ticks.push({ d: u * unitM, label: isLabel ? String(Number(u.toFixed(2))) : null, major: Number.isInteger(u) && u % 5 === 0 });
  }

  const focusUid = dragUid ?? selectedUid;

  // Landmark labels that fit without overlapping (≈6 px per character).
  const landmarkLabels = (() => {
    let lastEnd = -Infinity;
    const zoomedIn = span < D * 0.6;
    return course.landmarks
      .filter((l) => (zoomedIn || LABELLED_LANDMARKS.includes(l.id)) && l.start >= v0 && l.start < v1)
      .filter((l) => {
        const start = x(l.start);
        const end = start + 3 + l.short.length * 6;
        if (start < lastEnd + 6 || end > w - 90) return false;
        lastEnd = end;
        return true;
      });
  })();

  // --- Pointer handling ----------------------------------------------------------------
  const localX = (e: { clientX: number }) => e.clientX - (wrapRef.current?.getBoundingClientRect().left ?? 0);

  const onSongPointerDown = (e: React.PointerEvent, uid: string) => {
    if (e.button !== 0 || (e.pointerType === 'touch' && touches.current.size > 0)) return;
    const slot = schedule.slots.find((s) => s.uid === uid);
    if (!slot) return;
    const d = dAtX(localX(e));
    dragRef.current = { uid, x0: e.clientX, grabOffset: model.tAt(d) - slot.startT, active: false, pointerId: e.pointerId };
    if (e.pointerType === 'touch') touches.current.set(e.pointerId, localX(e));
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, localX(e));
      if (touches.current.size === 2) {
        // Second finger: pinch instead of drag/pan.
        dragRef.current = null;
        panRef.current = null;
        useDrag.getState().endDrag();
        const [p, q] = [...touches.current.values()];
        pinchRef.current = { dist: Math.abs(p - q), mid: (p + q) / 2, view: viewRef.current };
        return;
      }
    }
    panRef.current = { pointerId: e.pointerId, x0: e.clientX, view: viewRef.current, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const px = localX(e);
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, px);

    const pinch = pinchRef.current;
    if (pinch && touches.current.size >= 2) {
      const [p, q] = [...touches.current.values()];
      const dist = Math.max(10, Math.abs(p - q));
      const [a, b] = pinch.view;
      const anchor = a + ((pinch.mid - PAD_X) / innerW) * (b - a);
      const s2 = Math.min(D, Math.max(MIN_SPAN, ((b - a) * pinch.dist) / dist));
      const frac = (anchor - a) / (b - a);
      setView(clampView(anchor - frac * s2, anchor - frac * s2 + s2));
      return;
    }

    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      if (!drag.active) {
        if (Math.abs(e.clientX - drag.x0) < 4) return;
        drag.active = true;
        useDrag.getState().setDrag({ uid: drag.uid, source: 'timeline' });
      }
      // Near the edges of a zoomed timeline, scroll so the song can travel further.
      if (zoomed && px < PAD_X + 24) panBy(-span * 0.02);
      else if (zoomed && px > w - PAD_X - 24) panBy(span * 0.02);
      const d = dAtX(px);
      const plan = usePlan.getState();
      const order = placeTrackAt(plan.tracks, drag.uid, model.tAt(d) - drag.grabOffset, plan.playback);
      const start = boundaries(order, plan.playback)[order.findIndex((t) => t.uid === drag.uid)];
      const prev = useDrag.getState().order ?? plan.tracks;
      useDrag.getState().setDrag(sameOrder(prev, order) ? { atD: model.dAt(Math.max(0, start)) } : { order, atD: model.dAt(Math.max(0, start)) });
      useDrag.getState().setCursor(null);
      return;
    }

    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      if (Math.abs(e.clientX - pan.x0) > 3) pan.moved = true;
      if (pan.moved && zoomed) {
        const [a, b] = pan.view;
        const shift = ((pan.x0 - e.clientX) / innerW) * (b - a);
        setView(clampView(a + shift, b + shift));
        useDrag.getState().setCursor(null);
        return;
      }
    }
    useDrag.getState().setCursor(dAtX(px));
  };

  const endPointer = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinchRef.current = null;
    if (panRef.current?.pointerId === e.pointerId) panRef.current = null;
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

  const inView = (d: number) => d >= v0 && d <= v1;
  const zoomBtn = (factor: number) => zoomAt(factor, PAD_X + innerW / 2);

  return (
    <div className="timeline" ref={wrapRef}>
      <svg
        width={w}
        height={HEIGHT}
        className={zoomed ? 'zoomed' : undefined}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={(e) => {
          endPointer(e);
          dragRef.current = null;
          useDrag.getState().endDrag();
        }}
        onPointerLeave={() => !dragRef.current && !panRef.current && useDrag.getState().setCursor(null)}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest('.tl-song')) return;
          setView([0, D]);
        }}
      >
        <defs>
          <clipPath id="tl-plot">
            <rect x={PAD_X} y={0} width={innerW} height={HEIGHT} />
          </clipPath>
        </defs>

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
          <text className="tl-readout" x={Math.min(Math.max(x(cursorD!), 160), w - 220)} y={12} textAnchor="middle">
            {readout}
          </text>
        )}

        <g clipPath="url(#tl-plot)">
          {/* Elevation, coloured by song */}
          <path d={areaPath(0, D)} className="tl-ele-base" />
          {schedule.slots.map((s) =>
            s.phase === 'race' && s.endD > v0 && s.startD < v1 ? (
              <path key={s.uid} d={areaPath(s.startD, s.endD)} fill={colors[s.index]} className={`tl-ele${focusUid && focusUid !== s.uid ? ' dim' : ''}`} />
            ) : null,
          )}
          <path d={linePath} className="tl-ele-line" />

          {/* Song blocks */}
          {schedule.slots.map((s) => {
            if (s.phase !== 'race' || s.endD - s.startD < 1 || s.endD < v0 || s.startD > v1) return null;
            const x0 = x(s.startD);
            const bw = Math.max(1, x(s.endD) - x0 - 1);
            const track = tracks[s.index];
            const focused = s.uid === focusUid || s.uid === hoverUid;
            const showArt = bw >= 30 && track?.artworkUrl;
            // Title inside the block once it's wide enough; keep it in the visible part.
            const textX = Math.max(x0, PAD_X) + (showArt && x0 >= PAD_X ? BAND_H : 6);
            const room = Math.min(x0 + bw, w - PAD_X) - textX - 6;
            const chars = Math.floor(room / 6.4);
            const label = track && chars >= 6 ? (track.title.length > chars ? `${track.title.slice(0, chars - 1)}…` : track.title) : null;
            return (
              <g
                key={s.uid}
                className={`tl-song${focused ? ' focused' : ''}${focusUid && s.uid !== focusUid ? ' dim' : ''}${s.uid === dragUid ? ' dragging' : ''}`}
                onPointerDown={(e) => onSongPointerDown(e, s.uid)}
                onPointerEnter={() => useDrag.getState().setHover(s.uid)}
                onPointerLeave={() => useDrag.getState().setHover(null)}
              >
                <rect x={x0} y={BAND_Y} width={bw} height={BAND_H} rx={Math.min(4, bw / 2)} fill={colors[s.index]} />
                {showArt && (
                  <image href={track.artworkUrl} x={x0 + 3} y={BAND_Y + 3} width={BAND_H - 6} height={BAND_H - 6} preserveAspectRatio="xMidYMid slice" />
                )}
                {label && (
                  <text className="tl-song-title" x={textX} y={BAND_Y + BAND_H / 2 + 4} fill={textOn(colors[s.index])}>
                    {label}
                  </text>
                )}
                <title>
                  {track?.title} — {track?.artist}
                </title>
              </g>
            );
          })}

          {/* Halfway + cursor */}
          {inView(D / 2) && <line className="tl-half" x1={x(D / 2)} x2={x(D / 2)} y1={BAND_Y - 2} y2={AXIS_Y} />}
          {cursorD !== null && !dragUid && <line className="tl-cursor" x1={x(cursorD)} x2={x(cursorD)} y1={BAND_Y - 4} y2={AXIS_Y} />}
        </g>

        {/* Axis */}
        <line className="tl-axis" x1={PAD_X} x2={w - PAD_X} y1={AXIS_Y} y2={AXIS_Y} />
        {ticks.map((t) => (
          <g key={t.d} className="tl-tick">
            <line x1={x(t.d)} x2={x(t.d)} y1={AXIS_Y} y2={AXIS_Y + (t.major ? 6 : t.label ? 4 : 2)} />
            {t.label && (
              <text x={x(t.d)} y={AXIS_Y + 15} textAnchor="middle">
                {t.label}
              </text>
            )}
          </g>
        ))}
        <text className="tl-unit" x={PAD_X} y={AXIS_Y + 15}>
          {units}
        </text>
        {course.boroughs.map((b, i) => {
          const a = Math.max(b.start, v0);
          const e = Math.min(b.end, v1);
          if (e <= a) return null;
          const widthPx = x(e) - x(a);
          return (
            <g key={i} className="tl-borough">
              {b.start > v0 && i > 0 && <line x1={x(b.start)} x2={x(b.start)} y1={AXIS_Y + 20} y2={AXIS_Y + 32} />}
              {widthPx > 44 && (
                <text x={(x(a) + x(e)) / 2} y={AXIS_Y + 30} textAnchor="middle">
                  {widthPx > 70 ? b.name : b.name.slice(0, 3)}
                </text>
              )}
            </g>
          );
        })}

        {/* Where the window sits on the whole course */}
        {zoomed && <rect className="tl-window" x={PAD_X + (v0 / D) * innerW} y={HEIGHT - 3} width={Math.max(4, (span / D) * innerW)} height={2} rx={1} />}
      </svg>
      <div className="tl-zoom">
        <button className="tl-zoom-btn" onClick={() => zoomBtn(1 / 1.6)} title="Zoom in (scroll or pinch on the timeline)" disabled={span <= MIN_SPAN + 1}>
          <Plus size={13} />
        </button>
        <button className="tl-zoom-btn" onClick={() => zoomBtn(1.6)} title="Zoom out" disabled={!zoomed}>
          <Minus size={13} />
        </button>
        <button className="tl-zoom-btn" onClick={() => setView([0, D])} title="Whole course (double-click)" disabled={!zoomed}>
          <Maximize2 size={11} />
        </button>
      </div>
    </div>
  );
}
