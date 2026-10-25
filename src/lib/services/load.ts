// Loads whatever the user pasted: Spotify / Apple Music playlist, album or song links.

import type { PublicPlaylist } from '../../../server/app';
import type { LoadedPlaylist, Track } from '../types';
import { getJson, jsonp, newUid, ServiceError } from './http';
import { parseMusicLink, type ParsedLink } from './links';
import * as spotify from './spotify';

function fromPublic(p: PublicPlaylist): LoadedPlaylist {
  const tracks: Track[] = p.tracks.map((t) => ({
    uid: newUid(),
    source: p.service,
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumKey: `${p.service}-album:${t.album ?? t.artworkUrl ?? t.id}`,
    durationMs: t.durationMs,
    artworkUrl: t.artworkUrl,
    previewUrl: t.previewUrl,
    explicit: t.explicit,
    spotifyUri: t.spotifyUri,
    appleId: t.appleId,
    isrc: t.isrc,
    colorHints: t.colorHints?.length ? t.colorHints : undefined,
  }));
  return {
    ref: { service: p.service, id: p.id, name: p.name, owner: p.owner, editable: false, url: p.url, imageUrl: p.imageUrl, storefront: p.storefront },
    tracks,
    warnings: p.warnings,
  };
}

async function viaServer(link: ParsedLink): Promise<LoadedPlaylist> {
  const body = await getJson<PublicPlaylist>(`/api/public?url=${encodeURIComponent(link.url)}`);
  return fromPublic(body);
}

/** Static-host fallback for Apple album/song links: the iTunes lookup API over JSONP. */
async function appleViaItunes(link: Extract<ParsedLink, { service: 'apple' }>): Promise<LoadedPlaylist> {
  if (link.kind === 'playlist') {
    throw new ServiceError('Apple Music playlists need the app server (npm run dev / npm start), or sign in to Apple Music');
  }
  interface R {
    wrapperType: string;
    trackId?: number;
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    collectionId?: number;
    trackTimeMillis?: number;
    artworkUrl100?: string;
    previewUrl?: string;
  }
  const res = await jsonp<{ results: R[] }>(
    `https://itunes.apple.com/lookup?id=${link.id}&country=${link.storefront}${link.kind === 'album' ? '&entity=song&limit=200' : ''}`,
  );
  const songs = res.results.filter((r) => r.wrapperType === 'track' && r.trackId);
  if (!songs.length) throw new ServiceError('Apple Music returned no songs for that link');
  const tracks: Track[] = songs.map((r) => ({
    uid: newUid(),
    source: 'apple',
    id: String(r.trackId),
    appleId: String(r.trackId),
    title: r.trackName ?? '',
    artist: r.artistName ?? '',
    album: r.collectionName,
    albumKey: `apple-album:${r.collectionId}`,
    durationMs: r.trackTimeMillis ?? 0,
    artworkUrl: r.artworkUrl100?.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/, '/600x600bb.jpg'),
    previewUrl: r.previewUrl,
  }));
  return {
    ref: { service: 'apple', id: link.id, name: songs[0].collectionName ?? tracks[0].title, owner: songs[0].artistName, url: link.url, editable: false },
    tracks,
  };
}

export async function loadFromLink(input: string, opts: { spotifyLoggedIn: boolean; server: boolean }): Promise<LoadedPlaylist> {
  const link = parseMusicLink(input);
  if (!link) throw new ServiceError('Paste a Spotify or Apple Music playlist, album or song link');

  if (link.service === 'spotify') {
    if (opts.spotifyLoggedIn) {
      try {
        if (link.kind === 'playlist') return await spotify.loadPlaylist(link.id);
        if (link.kind === 'album') return await spotify.loadAlbum(link.id);
        const track = await spotify.getTrack(link.id);
        return { ref: { service: 'spotify', name: track.title, owner: track.artist, editable: false, url: link.url }, tracks: [track] };
      } catch (err) {
        if (!opts.server) throw err;
        // Not the user's playlist (or not readable in dev mode): try the public reader.
      }
    }
    if (!opts.server) throw new ServiceError('Sign in to Spotify to load Spotify links on this deployment');
    if (link.kind === 'track') throw new ServiceError('Sign in to Spotify to add single songs from links — or use Search');
    return viaServer(link);
  }

  if (opts.server) {
    try {
      return await viaServer(link);
    } catch (err) {
      if (link.kind === 'playlist') throw err;
    }
  }
  return appleViaItunes(link);
}
