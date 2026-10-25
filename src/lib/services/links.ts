export type ParsedLink =
  | { service: 'spotify'; kind: 'playlist' | 'album' | 'track'; id: string; url: string }
  | { service: 'apple'; kind: 'playlist' | 'album' | 'song'; id: string; storefront: string; url: string };

/** Recognises Spotify / Apple Music share links and URIs. */
export function parseMusicLink(input: string): ParsedLink | null {
  const text = input.trim();
  if (!text) return null;

  const uri = text.match(/^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/);
  if (uri) {
    const kind = uri[1] as 'playlist' | 'album' | 'track';
    return { service: 'spotify', kind, id: uri[2], url: `https://open.spotify.com/${kind}/${uri[2]}` };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const rest = parts.filter((p) => !/^intl-[a-z-]+$/i.test(p) && p !== 'embed' && p !== 'user');
    for (let i = 0; i < rest.length - 1; i++) {
      const kind = rest[i] as 'playlist' | 'album' | 'track';
      if (['playlist', 'album', 'track'].includes(kind) && /^[A-Za-z0-9]{22}$/.test(rest[i + 1])) {
        return { service: 'spotify', kind, id: rest[i + 1], url: `https://open.spotify.com/${kind}/${rest[i + 1]}` };
      }
    }
    return null;
  }

  if (host === 'music.apple.com' || host === 'itunes.apple.com' || host === 'geo.music.apple.com') {
    const storefront = parts[0] && /^[a-z]{2}$/i.test(parts[0]) ? parts[0].toLowerCase() : 'us';
    const kindIdx = parts.findIndex((p) => p === 'playlist' || p === 'album' || p === 'song');
    if (kindIdx < 0) return null;
    const kind = parts[kindIdx] as 'playlist' | 'album' | 'song';
    const id = parts[parts.length - 1];
    if (kind === 'playlist' && /^pl\.[A-Za-z0-9-]+$/.test(id)) return { service: 'apple', kind, id, storefront, url: url.href };
    if (kind === 'album') {
      const songId = url.searchParams.get('i');
      if (songId && /^\d+$/.test(songId)) return { service: 'apple', kind: 'song', id: songId, storefront, url: url.href };
      const albumId = id.replace(/^id/, '');
      if (/^\d+$/.test(albumId)) return { service: 'apple', kind, id: albumId, storefront, url: url.href };
    }
    if (kind === 'song' && /^\d+$/.test(id)) return { service: 'apple', kind, id, storefront, url: url.href };
    return null;
  }
  return null;
}
