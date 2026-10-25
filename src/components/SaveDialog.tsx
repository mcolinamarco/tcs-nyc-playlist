import { useState } from 'react';
import { Copy, Download, ExternalLink, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { ServiceBadge } from './ServiceBadge';
import { usePlan } from '../state/plan';
import { useSession } from '../state/session';
import { useDerived } from '../state/derived';
import { saveToApple, saveToSpotify, type Progress, type SaveResult } from '../lib/services/save';
import { download, planCsv, planText } from '../lib/export';
import { formatClock, pluralize } from '../lib/format';

export function SaveDialog() {
  const playlist = usePlan((s) => s.playlist);
  const pace = usePlan((s) => s.pace);
  const units = usePlan((s) => s.units);
  const config = useSession((s) => s.config);
  const spotifyUser = useSession((s) => s.spotifyUser);
  const appleAuthorized = useSession((s) => s.appleAuthorized);
  const { tracks, schedule } = useDerived({ preview: false });
  const baseName = playlist.name.replace(/ \(demo\)$/, '');
  const [name, setName] = useState(`${baseName} · NYC Marathon ${formatClock(pace.finishSec, true)}`);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<(SaveResult & { service: 'spotify' | 'apple' }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const description = `Race order for the 2026 TCS NYC Marathon at a ${formatClock(pace.finishSec, true)} finish. Planned with 26.2 Mixtape.`;
  const canReplace = playlist.service === 'spotify' && playlist.editable && playlist.id && spotifyUser;
  const localCount = tracks.filter((t) => t.local).length;

  const run = async (service: 'spotify' | 'apple', fn: () => Promise<SaveResult>) => {
    setError(null);
    setResult(null);
    try {
      const res = await fn();
      setResult({ ...res, service });
      if (service === 'spotify' && res.id) {
        // Later saves can update this playlist in place.
        const isNew = res.id !== playlist.id;
        usePlan.getState().markSaved(
          isNew ? { service: 'spotify', id: res.id, name, url: res.url, editable: true, imageUrl: undefined, owner: spotifyUser?.display_name } : undefined,
        );
      }
      useSession.getState().toast(`Saved ${pluralize(res.saved, 'song')} to ${service === 'spotify' ? 'Spotify' : 'Apple Music'}`, 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const copyText = async () => {
    const text = planText(baseName, pace.finishSec, tracks, schedule, units);
    try {
      await navigator.clipboard.writeText(text);
      useSession.getState().toast('Race plan copied', 'success');
    } catch {
      download('race-plan.txt', text, 'text/plain');
    }
  };

  const busy = Boolean(progress);
  return (
    <Modal title="Save your race order" subtitle={`${pluralize(tracks.length, 'song')} in planned order`} wide>
      <div className="save-grid">
        <section className="save-card">
          <h3>
            <ServiceBadge service="spotify" />
          </h3>
          {!config.spotifyClientId ? (
            <p className="muted">Spotify isn't configured on this server. See the README.</p>
          ) : !spotifyUser ? (
            <>
              <p>Connect Spotify to save this order.</p>
              <button className="btn spotify" onClick={() => void useSession.getState().loginSpotify()}>
                Connect Spotify
              </button>
            </>
          ) : (
            <>
              {canReplace && (
                <button
                  className="btn primary block"
                  disabled={busy}
                  onClick={() =>
                    void run('spotify', () => saveToSpotify({ mode: 'replace', playlistId: playlist.id, name, description, tracks, onProgress: setProgress }))
                  }
                >
                  Update “{playlist.name}” in place
                </button>
              )}
              <button
                className={`btn block${canReplace ? '' : ' primary'}`}
                disabled={busy || !name.trim()}
                onClick={() => void run('spotify', () => saveToSpotify({ mode: 'new', name, description, tracks, onProgress: setProgress }))}
              >
                Save as a new Spotify playlist
              </button>
              {canReplace && <p className="muted small">Updating replaces the playlist's songs with this order. “Date added” will reset.</p>}
              {localCount > 0 && <p className="muted small">{pluralize(localCount, 'local file')} can't be saved through the Spotify API and will be left out.</p>}
            </>
          )}
        </section>

        <section className="save-card">
          <h3>
            <ServiceBadge service="apple" />
          </h3>
          {!config.apple ? (
            <p className="muted">Apple Music isn't configured on this server. See the README.</p>
          ) : !appleAuthorized ? (
            <>
              <p>Connect Apple Music to save this order.</p>
              <button className="btn apple" onClick={() => void useSession.getState().loginApple()}>
                Connect Apple Music
              </button>
            </>
          ) : (
            <>
              <button
                className="btn primary block"
                disabled={busy || !name.trim()}
                onClick={() => void run('apple', () => saveToApple({ name, description, tracks, onProgress: setProgress }))}
              >
                Save as a new library playlist
              </button>
              <p className="muted small">Apple Music doesn't let apps reorder existing playlists, so the order is saved as a new one.</p>
            </>
          )}
        </section>
      </div>

      <label className="name-field">
        <span>New playlist name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {progress && (
        <div className="progress">
          <div className="progress-label">
            <Loader2 size={15} className="spin" /> {progress.label} {progress.total ? `${progress.done}/${progress.total}` : ''}
          </div>
          <div className="progress-bar">
            <i style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} />
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {result && (
        <div className="save-result">
          <p>
            Saved {pluralize(result.saved, 'song')} to {result.service === 'spotify' ? 'Spotify' : 'your Apple Music library'}.
            {result.url && (
              <>
                {' '}
                <a href={result.url} target="_blank" rel="noreferrer">
                  Open playlist <ExternalLink size={13} />
                </a>
              </>
            )}
          </p>
          {result.unmatched.length > 0 && (
            <details>
              <summary>{pluralize(result.unmatched.length, 'song')} couldn't be matched</summary>
              <ul>
                {result.unmatched.map((t) => (
                  <li key={t.uid}>
                    {t.title} — {t.artist}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="export-row">
        <span className="muted">Or take the plan with you:</span>
        <button className="btn small" onClick={() => void copyText()}>
          <Copy size={14} /> Copy race plan
        </button>
        <button className="btn small" onClick={() => download('nyc-marathon-playlist-plan.csv', planCsv(tracks, schedule, units))}>
          <Download size={14} /> CSV
        </button>
      </div>
    </Modal>
  );
}
