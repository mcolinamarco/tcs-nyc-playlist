import { Plus, Redo2, Save, Undo2, ListMusic, AlertTriangle } from 'lucide-react';
import { isDirty, usePlan } from '../state/plan';
import { useSession } from '../state/session';
import { useDerived } from '../state/derived';
import { useUi } from '../state/ui';
import { formatClock, pluralize } from '../lib/format';
import { PacePanel } from './PacePanel';
import { TrackList } from './TrackList';
import { ServiceBadge } from './ServiceBadge';
import { Artwork } from './Artwork';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Brand />
      <PlaylistCard />
      <PacePanel />
      <TrackList />
      <Footer />
    </aside>
  );
}

function Brand() {
  const spotifyUser = useSession((s) => s.spotifyUser);
  const appleAuthorized = useSession((s) => s.appleAuthorized);
  return (
    <header className="brand">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
        <path d="M10 50c7-2 7-14 14-16s9 7 16 2 5-16 12-18" fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" />
        <path d="M10 50c7-2 7-14 14-16" fill="none" stroke="var(--accent-2)" strokeWidth="7" strokeLinecap="round" />
        <circle cx="52" cy="18" r="4.5" fill="currentColor" />
      </svg>
      <div className="brand-text">
        <h1>26.2 Mixtape</h1>
        <p>TCS NYC Marathon · Sun, Nov 1, 2026</p>
      </div>
      <div className="brand-accounts">
        {spotifyUser && <ServiceBadge service="spotify" title={`Spotify: ${spotifyUser.display_name ?? spotifyUser.id}`} />}
        {appleAuthorized && <ServiceBadge service="apple" title="Apple Music connected" />}
      </div>
    </header>
  );
}

function PlaylistCard() {
  const playlist = usePlan((s) => s.playlist);
  const warnings = usePlan((s) => s.warnings);
  const { tracks, schedule } = useDerived({ preview: false });
  const total = tracks.reduce((a, t) => a + t.durationMs, 0) / 1000;
  return (
    <section className="playlist-card">
      <div className="playlist-cover">
        {playlist.imageUrl ? (
          <img src={playlist.imageUrl} alt="" />
        ) : (
          <div className="mosaic">
            {tracks.slice(0, 4).map((t) => (
              <Artwork key={t.uid} track={t} size={29} />
            ))}
          </div>
        )}
      </div>
      <div className="playlist-info">
        <div className="playlist-name" title={playlist.name}>
          {playlist.name}
        </div>
        <div className="playlist-meta">
          <ServiceBadge service={playlist.service} />
          <span>
            {pluralize(tracks.length, 'song')} · {formatClock(total, true)}
          </span>
        </div>
        {warnings.length > 0 && (
          <div className="playlist-warning" title={warnings.join('\n')}>
            <AlertTriangle size={12} /> {warnings[0]}
          </div>
        )}
      </div>
      <div className="playlist-actions">
        <button className="btn small" onClick={() => useUi.getState().open('source')} title="Load a different playlist">
          <ListMusic size={15} /> Change
        </button>
        <button className="btn small" onClick={() => useUi.getState().open('search')} title="Search songs to add (/)">
          <Plus size={15} /> Add
        </button>
      </div>
      <Coverage gapSec={schedule.gapSec} overflowSec={schedule.overflowSec} />
    </section>
  );
}

function Coverage({ gapSec, overflowSec }: { gapSec: number; overflowSec: number }) {
  const finishSec = usePlan((s) => s.pace.finishSec);
  const leadIn = usePlan((s) => s.playback.leadInSec);
  const total = finishSec + leadIn + overflowSec;
  const pct = (x: number) => `${(100 * x) / Math.max(total, 1)}%`;
  return (
    <div className="coverage">
      <div className="coverage-bar" aria-hidden>
        {leadIn > 0 && <div className="cov pre" style={{ width: pct(leadIn) }} />}
        <div className="cov race" style={{ width: pct(finishSec - gapSec) }} />
        {gapSec > 0 && <div className="cov gap" style={{ width: pct(gapSec) }} />}
        {overflowSec > 0 && <div className="cov post" style={{ width: pct(overflowSec) }} />}
      </div>
      <div className={`coverage-text${gapSec > 0 ? ' warn' : ''}`}>
        {gapSec > 0
          ? `Music runs out ${formatClock(gapSec)} before the finish. Add songs.`
          : overflowSec > 0
            ? `Covers the whole race, with ${formatClock(overflowSec)} to spare after the finish.`
            : 'Ends exactly at the finish line.'}
      </div>
    </div>
  );
}

function Footer() {
  const canUndo = usePlan((s) => s.past.length > 0);
  const canRedo = usePlan((s) => s.future.length > 0);
  const dirty = usePlan(isDirty);
  return (
    <footer className="sidebar-footer">
      <button className="icon-btn" disabled={!canUndo} onClick={() => usePlan.getState().undo()} title="Undo (⌘Z)">
        <Undo2 size={17} />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => usePlan.getState().redo()} title="Redo (⇧⌘Z)">
        <Redo2 size={17} />
      </button>
      <span className={`dirty${dirty ? ' on' : ''}`}>{dirty ? 'Unsaved order' : 'Saved'}</span>
      <button className="btn primary" onClick={() => useUi.getState().open('save')}>
        <Save size={16} /> Save playlist
      </button>
    </footer>
  );
}
