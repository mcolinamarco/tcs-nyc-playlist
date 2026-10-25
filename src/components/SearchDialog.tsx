import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pause, Play, Plus, Search } from 'lucide-react';
import { Modal } from './Modal';
import { Artwork } from './Artwork';
import { usePlan } from '../state/plan';
import { useSession } from '../state/session';
import { useUi } from '../state/ui';
import { useDerived } from '../state/derived';
import { catalogSearch } from '../lib/services/catalog';
import * as spotify from '../lib/services/spotify';
import * as apple from '../lib/services/apple';
import { newUid } from '../lib/services/http';
import { insertionIndexForStart } from '../lib/reorder';
import { formatClock } from '../lib/format';
import { togglePreview } from '../lib/preview';
import { MILE } from '../lib/course';
import type { Track } from '../lib/types';

type Provider = 'spotify' | 'apple' | 'catalog';
type Where = 'end' | 'after' | 'mile';

export function SearchDialog() {
  const spotifyUser = useSession((s) => s.spotifyUser);
  const appleAuthorized = useSession((s) => s.appleAuthorized);
  const playlistService = usePlan((s) => s.playlist.service);
  const selectedUid = usePlan((s) => s.selectedUid);
  const units = usePlan((s) => s.units);
  const previewUrl = useUi((s) => s.previewUrl);
  const { tracks, model } = useDerived({ preview: false });

  const providers: Provider[] = [...(spotifyUser ? (['spotify'] as const) : []), ...(appleAuthorized ? (['apple'] as const) : []), 'catalog'];
  const preferred: Provider = playlistService === 'apple' && appleAuthorized ? 'apple' : spotifyUser ? 'spotify' : appleAuthorized ? 'apple' : 'catalog';
  const [provider, setProvider] = useState<Provider>(preferred);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, true>>({});
  const selectedIdx = tracks.findIndex((t) => t.uid === selectedUid);
  const [where, setWhere] = useState<Where>(selectedIdx >= 0 ? 'after' : 'end');
  const [mile, setMile] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const res = provider === 'spotify' ? await spotify.search(term) : provider === 'apple' ? await apple.search(term) : await catalogSearch(term, 20);
        if (n === seq.current) {
          setResults(res);
          setError(null);
        }
      } catch (err) {
        if (n === seq.current) setError((err as Error).message);
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 320);
    return () => clearTimeout(timer);
  }, [q, provider]);

  const insertIndex = (): number => {
    const plan = usePlan.getState();
    if (where === 'after' && selectedIdx >= 0) return plan.tracks.findIndex((t) => t.uid === selectedUid) + 1;
    if (where === 'mile') {
      const v = Number(mile);
      if (Number.isFinite(v) && v >= 0) return insertionIndexForStart(plan.tracks, model.tAt(v * (units === 'mi' ? MILE : 1000)), plan.playback);
    }
    return plan.tracks.length;
  };

  const add = (t: Track) => {
    const copy = { ...t, uid: newUid() };
    const at = insertIndex();
    usePlan.getState().add([copy], at);
    if (where === 'after') usePlan.getState().select(copy.uid);
    setAdded((a) => ({ ...a, [t.id]: true }));
    useSession.getState().toast(`Added “${t.title}” as song ${at + 1}`, 'success');
  };

  const label: Record<Provider, string> = { spotify: 'Spotify', apple: 'Apple Music', catalog: 'Everything' };

  return (
    <Modal title="Search songs" subtitle="Add songs to your plan, then drag them where you want them." wide>
      <div className="search-top">
        <div className="input-row">
          <Search size={17} />
          <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song or artist" aria-label="Search songs" />
          {busy && <Loader2 size={16} className="spin" />}
        </div>
        {providers.length > 1 && (
          <div className="segmented">
            {providers.map((p) => (
              <button key={p} className={provider === p ? 'on' : ''} onClick={() => setProvider(p)}>
                {label[p]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="insert-where">
        <span>Add</span>
        <select value={where} onChange={(e) => setWhere(e.target.value as Where)}>
          <option value="end">at the end</option>
          {selectedIdx >= 0 && <option value="after">after “{tracks[selectedIdx].title}”</option>}
          <option value="mile">near {units === 'mi' ? 'mile' : 'km'}…</option>
        </select>
        {where === 'mile' && <input className="mile-input" value={mile} onChange={(e) => setMile(e.target.value)} placeholder={units === 'mi' ? '20' : '32'} inputMode="decimal" />}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="results">
        {results.map((t) => (
          <div key={`${t.source}:${t.id}`} className="result-row">
            <Artwork track={t} size={44} />
            <div className="result-main">
              <div className="result-title">
                {t.title}
                {t.explicit && <span className="explicit">E</span>}
              </div>
              <div className="result-sub">
                {t.artist}
                {t.album ? ` · ${t.album}` : ''}
              </div>
            </div>
            <span className="result-dur">{formatClock(t.durationMs / 1000)}</span>
            {t.previewUrl && (
              <button className="icon-btn ghost" onClick={() => togglePreview(t.previewUrl)} aria-label="Preview">
                {previewUrl === t.previewUrl ? <Pause size={16} /> : <Play size={16} />}
              </button>
            )}
            <button className={`btn small${added[t.id] ? ' done' : ' primary'}`} onClick={() => add(t)}>
              {added[t.id] ? <Check size={15} /> : <Plus size={15} />} {added[t.id] ? 'Added' : 'Add'}
            </button>
          </div>
        ))}
        {!results.length && q.trim().length >= 2 && !busy && !error && <p className="muted">No songs found.</p>}
        {q.trim().length < 2 && (
          <p className="muted">
            {provider === 'catalog'
              ? 'Searches a public music catalog. Songs are matched to Spotify or Apple Music when you save.'
              : `Searching ${label[provider]}.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
