import { memo, useEffect, useRef } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pause, Play, X, Flag } from 'lucide-react';
import { usePlan } from '../state/plan';
import { useDerived, useDrag } from '../state/derived';
import { useUi } from '../state/ui';
import { landmarksBetween } from '../lib/course';
import { formatClock, toUnits } from '../lib/format';
import { togglePreview } from '../lib/preview';
import { boundaries, type Slot } from '../lib/schedule';
import type { Track, Units } from '../lib/types';
import { Artwork } from './Artwork';

export function TrackList() {
  const dragSource = useDrag((s) => s.source);
  // While the list itself is being dragged, dnd-kit animates the rows, so the
  // list keeps the committed order; for map/timeline drags it follows the preview.
  const { tracks, schedule, colors, model } = useDerived({ preview: dragSource !== 'list' });
  const selectedUid = usePlan((s) => s.selectedUid);
  const units = usePlan((s) => s.units);
  const previewUrl = useUi((s) => s.previewUrl);
  const draggingUid = useDrag((s) => s.uid);
  const listRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Keep the selected row visible when it's chosen on the map or timeline.
  useEffect(() => {
    if (!selectedUid) return;
    listRef.current?.querySelector(`[data-uid="${window.CSS.escape(selectedUid)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedUid]);

  const onDragStart = (e: DragStartEvent) => {
    useDrag.getState().setDrag({ uid: String(e.active.id), source: 'list' });
  };
  const onDragOver = (e: DragOverEvent) => {
    const plan = usePlan.getState().tracks;
    if (!e.over) return;
    const from = plan.findIndex((t) => t.uid === e.active.id);
    const to = plan.findIndex((t) => t.uid === e.over!.id);
    if (from < 0 || to < 0) return;
    const order = arrayMove(plan, from, to);
    const start = boundaries(order, usePlan.getState().playback)[order.findIndex((t) => t.uid === e.active.id)];
    useDrag.getState().setDrag({ order, atD: model.dAt(Math.max(0, start)) });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const plan = usePlan.getState();
    if (e.over && e.active.id !== e.over.id) {
      const from = plan.tracks.findIndex((t) => t.uid === e.active.id);
      const to = plan.tracks.findIndex((t) => t.uid === e.over!.id);
      if (from >= 0 && to >= 0) plan.setTracks(arrayMove(plan.tracks, from, to));
    }
    plan.select(String(e.active.id));
    useDrag.getState().endDrag();
  };

  if (!tracks.length) {
    return (
      <div className="track-list empty">
        <p>This playlist is empty.</p>
        <button className="btn" onClick={() => useUi.getState().open('search')}>
          Search songs to add
        </button>
      </div>
    );
  }

  const finishIndex = schedule.finishIndex;
  const lastPre = schedule.slots.findLastIndex((s) => s.phase === 'pre');

  return (
    <div className="track-list" ref={listRef}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => useDrag.getState().endDrag()}>
        <SortableContext items={tracks.map((t) => t.uid)} strategy={verticalListSortingStrategy}>
          {tracks.map((track, i) => (
            <div key={track.uid} className="track-slot">
              <Row
                track={track}
                slot={schedule.slots[i]}
                color={colors[i]}
                index={i}
                units={units}
                selected={track.uid === selectedUid}
                dragging={track.uid === draggingUid}
                playing={Boolean(track.previewUrl) && previewUrl === track.previewUrl}
              />
              {i === lastPre && <div className="list-divider start">Start line · you cross the mat here</div>}
              {i === finishIndex && (
                <div className="list-divider finish">
                  <Flag size={13} /> Finish {formatClock(model.finishSec, true)} · {formatClock(model.finishSec - schedule.slots[i].startT)} into this song
                </div>
              )}
            </div>
          ))}
        </SortableContext>
      </DndContext>
      {schedule.gapSec > 0 && (
        <div className="list-divider gap">
          {formatClock(schedule.gapSec)} of silence to the finish ·{' '}
          <button className="link" onClick={() => useUi.getState().open('search')}>
            add songs
          </button>
        </div>
      )}
      <div className="list-end-hint">{toUnits(42195, units).toFixed(1)} {units} · drag rows, or drag songs on the map</div>
    </div>
  );
}

const Row = memo(function Row({
  track,
  slot,
  color,
  index,
  units,
  selected,
  dragging,
  playing,
}: {
  track: Track;
  slot: Slot;
  color: string;
  index: number;
  units: Units;
  selected: boolean;
  dragging: boolean;
  playing: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.uid });
  const style = { transform: CSS.Translate.toString(transform), transition };
  const landmark = slot.phase === 'race' ? landmarksBetween(slot.startD, slot.endD)[0] : undefined;
  const select = () => {
    usePlan.getState().select(track.uid);
    useUi.getState().requestFocus(track.uid);
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-uid={track.uid}
      className={`track-row ${slot.phase}${selected ? ' selected' : ''}${isDragging || dragging ? ' dragging' : ''}`}
      onClick={select}
      onMouseEnter={() => useDrag.getState().setHover(track.uid)}
      onMouseLeave={() => useDrag.getState().setHover(null)}
    >
      <span className="track-color" style={{ background: color }} />
      <button className="grip" {...attributes} {...listeners} aria-label={`Move ${track.title}`} onClick={(e) => e.stopPropagation()}>
        <GripVertical size={15} />
      </button>
      <div className="track-art">
        <Artwork track={track} size={40} />
        {track.previewUrl && (
          <button
            className={`art-play${playing ? ' on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreview(track.previewUrl);
            }}
            aria-label={playing ? 'Stop preview' : 'Play preview'}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
        )}
      </div>
      <div className="track-main">
        <div className="track-title">
          <span className="track-num">{index + 1}</span>
          {track.title}
          {track.explicit && <span className="explicit">E</span>}
        </div>
        <div className="track-sub">
          {track.artist}
          {landmark && <span className="landmark-chip">{landmark.short}</span>}
        </div>
      </div>
      <div className="track-when">
        {slot.phase === 'race' ? (
          <>
            <div className="track-mile">
              {units === 'mi' ? 'mi' : 'km'} {toUnits(slot.startD, units).toFixed(1)}
            </div>
            <div className="track-time">{formatClock(Math.max(0, slot.startT), true)}</div>
          </>
        ) : (
          <div className="track-phase">{slot.phase === 'pre' ? 'pre-race' : 'post-race'}</div>
        )}
      </div>
      <button
        className="row-remove"
        onClick={(e) => {
          e.stopPropagation();
          usePlan.getState().remove(track.uid);
        }}
        aria-label={`Remove ${track.title}`}
        title="Remove from plan"
      >
        <X size={14} />
      </button>
    </div>
  );
});
