import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { Maximize2, Moon, Sun, HelpCircle } from 'lucide-react';
import { course, MILE, pointAt, projectOntoCourse, sliceCourse, landmarkAt } from '../lib/course';
import { boundaries } from '../lib/schedule';
import { placeTrackAt, sameOrder } from '../lib/reorder';
import { formatClock, formatMarker } from '../lib/format';
import type { Theme } from '../lib/colors';
import type { Track } from '../lib/types';
import { usePlan } from '../state/plan';
import { useDerived, useDrag, type Derived } from '../state/derived';
import { useUi } from '../state/ui';
import { Artwork } from './Artwork';

const STYLES: Record<Theme, string> = {
  dark: (import.meta.env.VITE_MAP_STYLE_DARK as string | undefined) || 'https://tiles.openfreemap.org/styles/dark',
  light: (import.meta.env.VITE_MAP_STYLE_LIGHT as string | undefined) || 'https://tiles.openfreemap.org/styles/positron',
};

/** Used when the basemap can't be reached: the course still draws on a plain background. */
const fallbackStyle = (theme: Theme): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': theme === 'dark' ? '#0b0e14' : '#eceef2' } }],
});

const width = (extra: number): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  3.5 + extra * 0.6,
  13,
  7 + extra,
  16,
  13 + extra,
];

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const TIMELINE_PAD = 176;

function addCourseLayers(map: maplibregl.Map, theme: Theme) {
  const dark = theme === 'dark';
  map.addSource('course', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: course.coords } },
  });
  map.addSource('songs', { type: 'geojson', data: EMPTY });
  map.addSource('ticks', { type: 'geojson', data: EMPTY });
  map.addSource('cursor', { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'course-casing',
    type: 'line',
    source: 'course',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#000000' : '#ffffff', 'line-opacity': dark ? 0.7 : 0.95, 'line-width': width(7) },
  });
  map.addLayer({
    id: 'course-base',
    type: 'line',
    source: 'course',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#363d4b' : '#c4c9d2', 'line-width': width(0) },
  });
  map.addLayer({
    id: 'song-lines',
    type: 'line',
    source: 'songs',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': width(0) },
  });
  map.addLayer({
    id: 'song-focus-casing',
    type: 'line',
    source: 'songs',
    filter: ['==', ['get', 'uid'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#ffffff' : '#0b0d12', 'line-width': width(7) },
  });
  map.addLayer({
    id: 'song-focus',
    type: 'line',
    source: 'songs',
    filter: ['==', ['get', 'uid'], ''],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': width(2.5) },
  });
  map.addLayer({
    id: 'song-ticks',
    type: 'circle',
    source: 'ticks',
    minzoom: 11.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 1.6, 15, 3.6],
      'circle-color': dark ? '#0b0e14' : '#ffffff',
      'circle-stroke-color': dark ? '#ffffff' : '#0b0d12',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11.5, 0.8, 15, 1.6],
    },
  });
  map.addLayer({
    id: 'song-hit',
    type: 'line',
    source: 'songs',
    paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 26 },
  });
  map.addLayer({
    id: 'cursor-halo',
    type: 'circle',
    source: 'cursor',
    paint: { 'circle-radius': 14, 'circle-color': dark ? '#ffffff' : '#0b0d12', 'circle-opacity': 0.18 },
  });
  map.addLayer({
    id: 'cursor',
    type: 'circle',
    source: 'cursor',
    paint: {
      'circle-radius': 6.5,
      'circle-color': ['coalesce', ['get', 'color'], '#ffffff'],
      'circle-stroke-color': dark ? '#ffffff' : '#0b0d12',
      'circle-stroke-width': 2.5,
    },
  });
}

function songFeatures(d: Derived): { songs: FeatureCollection; ticks: FeatureCollection } {
  const songs: Feature[] = [];
  const ticks: Feature[] = [];
  for (const slot of d.schedule.slots) {
    if (slot.phase !== 'race' || slot.endD - slot.startD < 0.5) continue;
    songs.push({
      type: 'Feature',
      properties: { uid: slot.uid, idx: slot.index, color: d.colors[slot.index] },
      geometry: { type: 'LineString', coordinates: sliceCourse(slot.startD, slot.endD) },
    });
    if (slot.startD > 1) ticks.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pointAt(slot.startD) } });
  }
  return { songs: { type: 'FeatureCollection', features: songs }, ticks: { type: 'FeatureCollection', features: ticks } };
}

function boundsOf(coords: [number, number][]): [[number, number], [number, number]] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of coords) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

interface Hover {
  uid: string;
  x: number;
  y: number;
  d: number;
}

interface PointerDrag {
  uid: string;
  x0: number;
  y0: number;
  /** Seconds between the song's start and the point that was grabbed. */
  grabOffset: number;
  lastD: number;
  active: boolean;
  touch: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const setBasemapRef = useRef<(t: Theme) => void>(() => undefined);
  const [styleGen, setStyleGen] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [zoomBand, setZoomBand] = useState<'far' | 'mid' | 'near'>('far');

  const theme = usePlan((s) => s.theme);
  const units = usePlan((s) => s.units);
  const selectedUid = usePlan((s) => s.selectedUid);
  const derived = useDerived();
  const hoverUid = useDrag((s) => s.hoverUid);
  const dragUid = useDrag((s) => s.uid);
  const dragAtD = useDrag((s) => s.atD);
  const cursorD = useDrag((s) => s.cursorD);
  const focus = useUi((s) => s.focus);

  // Latest values for the imperative map handlers.
  const latest = useRef({ derived, theme });
  latest.current = { derived, theme };

  // --- Map setup (once) -------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current!;
    const initialTheme = usePlan.getState().theme;
    const map = new maplibregl.Map({
      container,
      style: STYLES[initialTheme],
      bounds: course.bounds,
      fitBoundsOptions: { padding: { top: 60, bottom: TIMELINE_PAD, left: 40, right: 40 } },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 18,
      minZoom: 9,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map;

    let styleLoaded = false;
    let usingFallback = false;
    const useFallback = () => {
      if (styleLoaded || usingFallback) return;
      usingFallback = true;
      map.setStyle(fallbackStyle(latest.current.theme), { diff: false });
    };
    let fallbackTimer = setTimeout(useFallback, 8000);
    map.on('error', () => {
      if (!styleLoaded) useFallback();
    });
    map.on('style.load', () => {
      styleLoaded = true;
      clearTimeout(fallbackTimer);
      addCourseLayers(map, latest.current.theme);
      setStyleGen((n) => n + 1);
    });
    setBasemapRef.current = (t: Theme) => {
      styleLoaded = false;
      usingFallback = false;
      clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(useFallback, 8000);
      map.setStyle(STYLES[t], { diff: false });
    };

    const onZoom = () => {
      const z = map.getZoom();
      setZoomBand(z < 11.6 ? 'far' : z < 13 ? 'mid' : 'near');
    };
    map.on('zoom', onZoom);
    onZoom();

    // --- Pointer interaction: hover, click-to-select, drag a song along the course ---
    let drag: PointerDrag | null = null;
    let raf = 0;
    let pendingMove: { x: number; y: number; lngLat: maplibregl.LngLat } | null = null;

    const slotFor = (uid: string) => latest.current.derived.schedule.slots.find((s) => s.uid === uid);

    const startDrag = (uid: string, grabD: number, x: number, y: number, touch: boolean): PointerDrag | null => {
      const slot = slotFor(uid);
      if (!slot) return null;
      const { model } = latest.current.derived;
      return { uid, x0: x, y0: y, grabOffset: model.tAt(grabD) - slot.startT, lastD: grabD, active: false, touch };
    };

    const activate = (d: PointerDrag) => {
      d.active = true;
      useDrag.getState().setDrag({ uid: d.uid, source: 'map' });
      useDrag.getState().setHover(null);
      setHover(null);
      map.getCanvas().style.cursor = 'grabbing';
      if (d.touch) {
        map.dragPan.disable();
        navigator.vibrate?.(12);
      }
    };

    const processMove = () => {
      raf = 0;
      const move = pendingMove;
      if (!drag || !move) return;
      if (!drag.active) {
        if (drag.touch || Math.hypot(move.x - drag.x0, move.y - drag.y0) < 4) return;
        activate(drag);
      }
      const proj = projectOntoCourse([move.lngLat.lng, move.lngLat.lat], { near: drag.lastD, window: 1500 });
      drag.lastD = proj.d;
      const plan = usePlan.getState();
      const { model } = latest.current.derived;
      const target = model.tAt(proj.d) - drag.grabOffset;
      const order = placeTrackAt(plan.tracks, drag.uid, target, plan.playback);
      const idx = order.findIndex((t) => t.uid === drag!.uid);
      const start = boundaries(order, plan.playback)[idx];
      const prev = useDrag.getState().order ?? plan.tracks;
      useDrag.getState().setDrag(sameOrder(prev, order) ? { atD: model.dAt(Math.max(0, start)) } : { order, atD: model.dAt(Math.max(0, start)) });
      setGhost({ x: move.x, y: move.y });
    };

    const queueMove = (x: number, y: number, lngLat: maplibregl.LngLat) => {
      pendingMove = { x, y, lngLat };
      if (!raf) raf = requestAnimationFrame(processMove);
    };

    const finish = () => {
      const d = drag;
      drag = null;
      if (!d) return;
      clearTimeout(d.timer);
      if (d.active) {
        const order = useDrag.getState().order;
        const plan = usePlan.getState();
        if (order && !sameOrder(order, plan.tracks)) plan.setTracks(order);
        plan.select(d.uid);
        useDrag.getState().endDrag();
        setGhost(null);
        map.getCanvas().style.cursor = '';
        if (d.touch) map.dragPan.enable();
      } else {
        usePlan.getState().select(d.uid);
      }
    };

    const hitAt = (x: number, y: number) =>
      map.getLayer('song-hit') ? map.queryRenderedFeatures([[x - 3, y - 3], [x + 3, y + 3]], { layers: ['song-hit'] })[0] : undefined;

    /**
     * The song under the pointer. The (wide, invisible) hit line says which
     * stretch of course we're on; projecting onto the course near it says
     * exactly where — so neighbouring songs never steal the pointer.
     */
    const songAt = (x: number, y: number, lngLat: maplibregl.LngLat): { uid: string; d: number } | null => {
      const hitUid = hitAt(x, y)?.properties?.uid as string | undefined;
      const hitSlot = hitUid ? slotFor(hitUid) : undefined;
      if (!hitSlot) return null;
      const { d } = projectOntoCourse([lngLat.lng, lngLat.lat], { near: (hitSlot.startD + hitSlot.endD) / 2, window: 2500 });
      const slot = latest.current.derived.schedule.slots.find((s) => s.phase === 'race' && d >= s.startD && d < s.endD) ?? hitSlot;
      return { uid: slot.uid, d };
    };

    map.on('mousedown', (e) => {
      if (e.originalEvent.button !== 0) return;
      const hit = songAt(e.point.x, e.point.y, e.lngLat);
      if (!hit) return;
      e.preventDefault(); // keep the map from panning
      drag = startDrag(hit.uid, hit.d, e.point.x, e.point.y, false);
    });

    map.on('mousemove', (e) => {
      if (drag) {
        queueMove(e.point.x, e.point.y, e.lngLat);
        return;
      }
      const hit = songAt(e.point.x, e.point.y, e.lngLat);
      map.getCanvas().style.cursor = hit ? 'grab' : '';
      useDrag.getState().setHover(hit?.uid ?? null);
      setHover(hit ? { uid: hit.uid, x: e.point.x, y: e.point.y, d: hit.d } : null);
    });

    map.on('mouseout', () => {
      if (!drag) {
        setHover(null);
        useDrag.getState().setHover(null);
      }
    });

    const onWindowUp = () => finish();
    window.addEventListener('mouseup', onWindowUp);

    map.on('click', (e) => {
      if (!hitAt(e.point.x, e.point.y) && !useDrag.getState().uid) usePlan.getState().select(null);
    });

    // Touch: long-press a song to pick it up; otherwise the map pans as usual.
    map.on('touchstart', (e) => {
      if (e.points.length !== 1) return;
      const hit = songAt(e.point.x, e.point.y, e.lngLat);
      if (!hit) return;
      const d = startDrag(hit.uid, hit.d, e.point.x, e.point.y, true);
      if (!d) return;
      drag = d;
      d.timer = setTimeout(() => {
        if (drag === d) {
          activate(d);
          queueMove(d.x0, d.y0, e.lngLat);
        }
      }, 320);
    });
    map.on('touchmove', (e) => {
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(e.point.x - drag.x0, e.point.y - drag.y0) > 8) {
          clearTimeout(drag.timer);
          drag = null; // it's a pan
        }
        return;
      }
      e.preventDefault();
      queueMove(e.point.x, e.point.y, e.lngLat);
    });
    map.on('touchend', () => finish());
    map.on('touchcancel', () => finish());

    return () => {
      window.removeEventListener('mouseup', onWindowUp);
      cancelAnimationFrame(raf);
      clearTimeout(fallbackTimer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Theme → basemap -----------------------------------------------------------------
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    setBasemapRef.current(theme);
  }, [theme]);

  // --- Song segments -------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !map.getSource('songs')) return;
    const { songs, ticks } = songFeatures(derived);
    (map.getSource('songs') as GeoJSONSource).setData(songs);
    (map.getSource('ticks') as GeoJSONSource).setData(ticks);
  }, [derived.schedule, derived.colors, styleGen]);

  // --- Focus / hover highlight -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !map.getLayer('song-focus')) return;
    const focusIds = [dragUid ?? selectedUid, hoverUid].filter((x): x is string => Boolean(x));
    const filter: ExpressionSpecification = ['in', ['get', 'uid'], ['literal', focusIds]];
    map.setFilter('song-focus', filter);
    map.setFilter('song-focus-casing', filter);
    const active = dragUid ?? selectedUid;
    map.setPaintProperty('song-lines', 'line-opacity', active ? ['case', ['==', ['get', 'uid'], active], 1, 0.5] : 1);
  }, [selectedUid, hoverUid, dragUid, styleGen]);

  // --- Cursor dot (timeline hover / drag target) ------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !map.getSource('cursor')) return;
    const d = dragAtD ?? cursorD;
    const color = dragUid ? derived.colors[derived.tracks.findIndex((t) => t.uid === dragUid)] : undefined;
    (map.getSource('cursor') as GeoJSONSource).setData(
      d === null
        ? EMPTY
        : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: color ? { color } : {}, geometry: { type: 'Point', coordinates: pointAt(d) } }] },
    );
  }, [cursorD, dragAtD, dragUid, styleGen, derived.colors, derived.tracks]);

  // --- Bring a song into view when asked (list / timeline / search) ------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const slot = latest.current.derived.schedule.slots.find((s) => s.uid === focus.uid);
    if (!slot || slot.phase !== 'race') return;
    const coords = sliceCourse(slot.startD, slot.endD);
    if (coords.length < 2) return;
    const b = boundsOf(coords);
    const view = map.getBounds();
    const inView = view.contains(b[0]) && view.contains(b[1]) && map.getZoom() >= 12;
    if (!inView) {
      map.fitBounds(b, { padding: { top: 120, bottom: TIMELINE_PAD + 30, left: 80, right: 80 }, maxZoom: 14.5, duration: 700 });
    }
  }, [focus]);

  // --- Markers: start/finish, miles (or km), landmarks -----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: maplibregl.Marker[] = [];
    const add = (el: HTMLElement, lngLat: [number, number], anchor: maplibregl.PositionAnchor = 'center') => {
      markers.push(new maplibregl.Marker({ element: el, anchor }).setLngLat(lngLat).addTo(map));
    };
    const step = units === 'mi' ? MILE : 1000;
    const count = Math.floor(course.distance / step);
    for (let i = 1; i <= count; i++) {
      const el = document.createElement('div');
      const major = units === 'mi' ? i % 5 === 0 : i % 5 === 0;
      el.className = `mile-marker${major ? ' major' : ''}`;
      el.textContent = String(i);
      el.title = `${units === 'mi' ? 'Mile' : 'Km'} ${i}`;
      add(el, pointAt(i * step));
    }
    const half = document.createElement('div');
    half.className = 'mile-marker half';
    half.textContent = '½';
    half.title = 'Halfway — 13.1 mi / 21.1 km';
    add(half, pointAt(course.distance / 2));

    const flag = (label: string, cls: string) => {
      const el = document.createElement('div');
      el.className = `course-flag ${cls}`;
      el.innerHTML = `<span>${label}</span>`;
      return el;
    };
    add(flag('Start', 'start'), pointAt(0), 'bottom');
    add(flag('Finish', 'finish'), pointAt(course.distance), 'bottom');

    for (const l of course.landmarks) {
      if (l.id === 'finish') continue;
      const el = document.createElement('div');
      el.className = 'landmark-label';
      el.textContent = l.short;
      el.title = `${l.name} — ${l.note}`;
      add(el, pointAt((l.start + l.end) / 2), 'left');
    }
    return () => markers.forEach((m) => m.remove());
  }, [units]);

  const fit = () =>
    mapRef.current?.fitBounds(course.bounds, { padding: { top: 60, bottom: TIMELINE_PAD, left: 40, right: 40 }, duration: 700 });

  return (
    <div className="map-wrap" data-zband={zoomBand} data-dragging={dragUid ? 'true' : undefined}>
      <div ref={containerRef} className="map" />
      <div className="map-toolbar">
        <button className="icon-btn" onClick={() => usePlan.getState().setUnits(units === 'mi' ? 'km' : 'mi')} title="Switch units">
          <span className="units-label">{units}</span>
        </button>
        <button
          className="icon-btn"
          onClick={() => usePlan.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Light map' : 'Dark map'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button className="icon-btn" onClick={fit} title="Show the whole course">
          <Maximize2 size={16} />
        </button>
        <button className="icon-btn" onClick={() => useUi.getState().open('help')} title="How it works">
          <HelpCircle size={17} />
        </button>
      </div>
      {hover && !dragUid && <HoverCard hover={hover} derived={derived} />}
      {ghost && dragUid && <DragGhost x={ghost.x} y={ghost.y} uid={dragUid} derived={derived} atD={dragAtD} />}
    </div>
  );
}

function HoverCard({ hover, derived }: { hover: Hover; derived: Derived }) {
  const units = usePlan((s) => s.units);
  const idx = derived.tracks.findIndex((t) => t.uid === hover.uid);
  const track: Track | undefined = derived.tracks[idx];
  const slot = derived.schedule.slots[idx];
  if (!track || !slot) return null;
  const t = derived.model.tAt(hover.d);
  const into = Math.max(0, t - slot.startT);
  const landmark = landmarkAt(hover.d);
  return (
    <div className="hover-card" style={{ left: hover.x, top: hover.y }}>
      <Artwork track={track} size={44} color={derived.colors[idx]} />
      <div className="hover-card-body">
        <div className="hover-card-title">{track.title}</div>
        <div className="hover-card-artist">{track.artist}</div>
        <div className="hover-card-meta">
          {formatMarker(hover.d, units)} · {formatClock(t, true)} · {formatClock(into)} into the song
        </div>
        {landmark && <div className="hover-card-landmark">{landmark.name}</div>}
      </div>
    </div>
  );
}

function DragGhost({ x, y, uid, derived, atD }: { x: number; y: number; uid: string; derived: Derived; atD: number | null }) {
  const units = usePlan((s) => s.units);
  const idx = derived.tracks.findIndex((t) => t.uid === uid);
  const track = derived.tracks[idx];
  const slot = derived.schedule.slots[idx];
  if (!track || !slot) return null;
  const landmark = atD !== null ? landmarkAt(atD) : undefined;
  return (
    <div className="drag-ghost" style={{ left: x, top: y }}>
      <Artwork track={track} size={36} color={derived.colors[idx]} />
      <div>
        <div className="drag-ghost-title">{track.title}</div>
        <div className="drag-ghost-meta">
          {slot.phase === 'pre' ? 'Before the start' : slot.phase === 'post' ? 'After the finish' : `Starts ${formatMarker(slot.startD, units)} · ${formatClock(Math.max(0, slot.startT), true)}`}
          {landmark && slot.phase === 'race' ? ` · ${landmark.short}` : ''}
        </div>
      </div>
    </div>
  );
}
