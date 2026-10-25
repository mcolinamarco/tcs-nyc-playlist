import { getJson } from './http';

export interface AppConfig {
  spotifyClientId: string | null;
  /** The server can sign Apple Music developer tokens. */
  apple: boolean;
  /** The server can read public playlist links. */
  publicLinks: boolean;
  /** An API server is running (false on a static host). */
  server: boolean;
}

export async function loadConfig(): Promise<AppConfig> {
  const envClientId = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) || null;
  try {
    const c = await getJson<Omit<AppConfig, 'server'>>('/api/config');
    return { ...c, spotifyClientId: c.spotifyClientId || envClientId, server: true };
  } catch {
    return { spotifyClientId: envClientId, apple: false, publicLinks: false, server: false };
  }
}
