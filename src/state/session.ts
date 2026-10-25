import { create } from 'zustand';
import { loadConfig, type AppConfig } from '../lib/services/config';
import * as spotify from '../lib/services/spotify';
import * as apple from '../lib/services/apple';
import { ServiceError } from '../lib/services/http';

interface SessionState {
  ready: boolean;
  config: AppConfig;
  spotifyUser: spotify.SpotifyUser | null;
  appleAuthorized: boolean;
  toasts: { id: number; kind: 'info' | 'error' | 'success'; text: string }[];

  init(): Promise<void>;
  initNow(): Promise<void>;
  loginSpotify(): Promise<void>;
  logoutSpotify(): void;
  loginApple(): Promise<void>;
  logoutApple(): Promise<void>;
  toast(text: string, kind?: 'info' | 'error' | 'success'): void;
  dismiss(id: number): void;
}

let toastSeq = 0;
let initOnce: Promise<void> | null = null;

export const useSession = create<SessionState>()((set, get) => ({
  ready: false,
  config: { spotifyClientId: null, apple: false, publicLinks: false, server: false },
  spotifyUser: null,
  appleAuthorized: false,
  toasts: [],

  init() {
    initOnce ??= get().initNow();
    return initOnce;
  },

  async initNow() {
    const config = await loadConfig();
    set({ config });
    try {
      if (await spotify.completeLoginFromCallback()) get().toast('Connected to Spotify', 'success');
    } catch (err) {
      get().toast((err as Error).message, 'error');
    }
    if (spotify.isLoggedIn()) {
      try {
        set({ spotifyUser: await spotify.getMe() });
      } catch (err) {
        if (err instanceof ServiceError && err.status === 401) spotify.logout();
      }
    }
    set({ ready: true });
    if (config.apple) {
      // MusicKit remembers authorisation between visits.
      apple
        .isAuthorized()
        .then((ok) => set({ appleAuthorized: ok }))
        .catch(() => undefined);
    }
  },

  async loginSpotify() {
    const id = get().config.spotifyClientId;
    if (!id) {
      get().toast('Add SPOTIFY_CLIENT_ID to .env to connect Spotify (see README)', 'error');
      return;
    }
    await spotify.beginLogin(id);
  },

  logoutSpotify() {
    spotify.logout();
    set({ spotifyUser: null });
  },

  async loginApple() {
    try {
      await apple.login();
      set({ appleAuthorized: true });
      get().toast('Connected to Apple Music', 'success');
    } catch (err) {
      get().toast(`Apple Music: ${(err as Error).message}`, 'error');
    }
  },

  async logoutApple() {
    await apple.logout().catch(() => undefined);
    set({ appleAuthorized: false });
  },

  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : 4000);
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
