import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, LogOut, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { ServiceBadge } from './ServiceBadge';
import { usePlan } from '../state/plan';
import { useSession } from '../state/session';
import { useUi } from '../state/ui';
import { loadFromLink } from '../lib/services/load';
import * as spotify from '../lib/services/spotify';
import * as apple from '../lib/services/apple';
import type { LoadedPlaylist, PlaylistSummary } from '../lib/types';
import { pluralize } from '../lib/format';
import { demoTracks } from '../data/demo';

type Tab = 'link' | 'spotify' | 'apple' | 'demo';

function useLoad() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<LoadedPlaylist>) => {
    setBusy(key);
    setError(null);
    try {
      const loaded = await fn();
      if (!loaded.tracks.length) throw new Error('That playlist has no playable songs');
      usePlan.getState().loadPlaylist(loaded);
      useUi.getState().close();
      useSession.getState().toast(`Loaded “${loaded.ref.name}” · ${pluralize(loaded.tracks.length, 'song')}`, 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

export function SourceDialog() {
  const [tab, setTab] = useState<Tab>('link');
  return (
    <Modal title="Choose a playlist" subtitle="Load the songs you want to plan around the course." wide>
      <div className="tabs" role="tablist">
        {(
          [
            ['link', 'Paste a link'],
            ['spotify', 'Spotify'],
            ['apple', 'Apple Music'],
            ['demo', 'Demo'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
            {id === 'spotify' || id === 'apple' ? <ServiceBadge service={id} /> : label}
          </button>
        ))}
      </div>
      {tab === 'link' && <LinkTab />}
      {tab === 'spotify' && <SpotifyTab />}
      {tab === 'apple' && <AppleTab />}
      {tab === 'demo' && <DemoTab />}
    </Modal>
  );
}

function LinkTab() {
  const [text, setText] = useState('');
  const config = useSession((s) => s.config);
  const spotifyUser = useSession((s) => s.spotifyUser);
  const { busy, error, run } = useLoad();
  return (
    <form
      className="tab-body"
      onSubmit={(e) => {
        e.preventDefault();
        void run('link', () => loadFromLink(text, { spotifyLoggedIn: Boolean(spotifyUser), server: config.server }));
      }}
    >
      <div className="input-row">
        <Link2 size={17} />
        <input
          data-autofocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://open.spotify.com/playlist/…  or  https://music.apple.com/…/playlist/…"
          aria-label="Playlist link"
        />
        <button className="btn primary" disabled={!text.trim() || Boolean(busy)}>
          {busy ? <Loader2 size={16} className="spin" /> : 'Load'}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <ul className="hints">
        <li>Spotify and Apple Music playlist, album and song links all work. The playlist has to be public or shared.</li>
        <li>To overwrite a Spotify playlist in place later, load one of your own (Spotify tab) or paste its link while signed in.</li>
        {!config.server && <li className="warn">No app server is running, so public links are limited. Run the app with `npm run dev` or `npm start`.</li>}
      </ul>
    </form>
  );
}

function PlaylistPicker({ items, onPick, busy }: { items: PlaylistSummary[]; onPick: (p: PlaylistSummary) => void; busy: string | null }) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => items.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())), [items, filter]);
  return (
    <>
      {items.length > 8 && <input className="filter" placeholder="Filter playlists" value={filter} onChange={(e) => setFilter(e.target.value)} data-autofocus />}
      <div className="playlist-grid">
        {shown.map((p) => (
          <button key={p.id} className="playlist-tile" onClick={() => onPick(p)} disabled={Boolean(busy)}>
            {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <div className="tile-ph" />}
            <span className="tile-name">{p.name}</span>
            <span className="tile-meta">
              {p.trackCount !== undefined ? pluralize(p.trackCount, 'song') : ''}
              {p.editable ? ' · yours' : p.owner ? ` · ${p.owner}` : ''}
            </span>
            {busy === p.id && <Loader2 size={18} className="spin tile-spin" />}
          </button>
        ))}
        {!shown.length && <p className="muted">No playlists found.</p>}
      </div>
    </>
  );
}

function SetupNote({ service }: { service: 'spotify' | 'apple' }) {
  return (
    <div className="setup-note">
      {service === 'spotify' ? (
        <>
          <p>
            <b>Spotify isn't set up on this server yet.</b> Create an app at developer.spotify.com, add the redirect URI <code>{spotify.redirectUri()}</code>, and put its client ID in{' '}
            <code>.env</code> as <code>SPOTIFY_CLIENT_ID</code>.
          </p>
          <p className="muted">Until then you can still paste public Spotify links in the “Paste a link” tab.</p>
        </>
      ) : (
        <>
          <p>
            <b>Apple Music isn't set up on this server yet.</b> It needs a MusicKit key from an Apple Developer account. Add <code>APPLE_TEAM_ID</code>, <code>APPLE_KEY_ID</code> and{' '}
            <code>APPLE_PRIVATE_KEY_PATH</code> to <code>.env</code>.
          </p>
          <p className="muted">Until then you can still paste public Apple Music links in the “Paste a link” tab.</p>
        </>
      )}
    </div>
  );
}

function SpotifyTab() {
  const config = useSession((s) => s.config);
  const user = useSession((s) => s.spotifyUser);
  const [items, setItems] = useState<PlaylistSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const { busy, error, run } = useLoad();

  useEffect(() => {
    if (!user) return;
    spotify
      .getMyPlaylists()
      .then(setItems)
      .catch((e: Error) => setListError(e.message));
  }, [user]);

  if (!config.spotifyClientId) return <SetupNote service="spotify" />;
  if (!user) {
    return (
      <div className="tab-body connect">
        <p>Connect Spotify to pick from your playlists, and to save your new order straight back to Spotify.</p>
        <button className="btn spotify" onClick={() => void useSession.getState().loginSpotify()}>
          <ServiceBadge service="spotify" /> Connect Spotify
        </button>
        <p className="muted small">You'll be sent to Spotify to sign in and brought straight back. Your current plan is kept.</p>
      </div>
    );
  }
  return (
    <div className="tab-body">
      <div className="account-row">
        <span>
          Signed in as <b>{user.display_name ?? user.id}</b>
        </span>
        <button className="btn small ghost" onClick={() => useSession.getState().logoutSpotify()}>
          <LogOut size={14} /> Disconnect
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {listError && <p className="form-error">{listError}</p>}
      {!items && !listError && (
        <p className="muted">
          <Loader2 size={15} className="spin" /> Loading your playlists…
        </p>
      )}
      {items && (
        <PlaylistPicker
          items={items}
          busy={busy}
          onPick={(p) =>
            void run(p.id, async () => {
              try {
                return await spotify.loadPlaylist(p.id);
              } catch (err) {
                // Followed playlists can't be read in dev mode: use the public reader.
                if (err instanceof spotify.SpotifyRestrictedError && config.server) {
                  return loadFromLink(`https://open.spotify.com/playlist/${p.id}`, { spotifyLoggedIn: false, server: true });
                }
                throw err;
              }
            })
          }
        />
      )}
    </div>
  );
}

function AppleTab() {
  const config = useSession((s) => s.config);
  const authorized = useSession((s) => s.appleAuthorized);
  const [items, setItems] = useState<PlaylistSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const { busy, error, run } = useLoad();

  useEffect(() => {
    if (!authorized) return;
    apple
      .getLibraryPlaylists()
      .then(setItems)
      .catch((e: Error) => setListError(e.message));
  }, [authorized]);

  if (!config.apple) return <SetupNote service="apple" />;
  if (!authorized) {
    return (
      <div className="tab-body connect">
        <p>Connect Apple Music to pick from your library playlists and save your order as a new playlist.</p>
        <button className="btn apple" onClick={() => void useSession.getState().loginApple()}>
          <ServiceBadge service="apple" /> Connect Apple Music
        </button>
      </div>
    );
  }
  return (
    <div className="tab-body">
      <div className="account-row">
        <span>Apple Music connected</span>
        <button className="btn small ghost" onClick={() => void useSession.getState().logoutApple()}>
          <LogOut size={14} /> Disconnect
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {listError && <p className="form-error">{listError}</p>}
      {!items && !listError && (
        <p className="muted">
          <Loader2 size={15} className="spin" /> Loading your playlists…
        </p>
      )}
      {items && <PlaylistPicker items={items} busy={busy} onPick={(p) => void run(p.id, () => apple.loadLibraryPlaylist(p.id))} />}
    </div>
  );
}

function DemoTab() {
  return (
    <div className="tab-body connect">
      <p>
        <Sparkles size={16} /> A {demoTracks().length}-song NYC mix planned for a 4:00 finish: Sinatra on the Verrazzano, the Beastie Boys into Brooklyn, Bon Jovi at halfway, Eminem on the silent
        Queensboro, Jay-Z onto First Avenue, Rocky up Fifth Avenue, and Queen across the finish line.
      </p>
      <button
        className="btn primary"
        onClick={() => {
          usePlan.getState().loadDemo();
          useUi.getState().close();
        }}
      >
        Load the demo playlist
      </button>
    </div>
  );
}
