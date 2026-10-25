import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, exportPKCS8, decodeProtectedHeader, decodeJwt } from 'jose';
import { isoDurationMs, parseApplePage, parseSpotifyEmbed } from './scrape';
import { createApp } from './app';
import { parseMusicLink } from '../src/lib/services/links';

const spotifyEmbed = (entity: object) =>
  `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { state: { data: { entity } } } },
  })}</script></body></html>`;

const SPOTIFY_ENTITY = {
  type: 'playlist',
  name: 'Long Run',
  subtitle: 'miguel',
  coverArt: { sources: [{ url: 'https://image-cdn-ak.spotifycdn.com/cover', width: 300 }] },
  trackList: [
    { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', subtitle: 'Rick Astley', duration: 213573, isExplicit: false, audioPreview: { url: 'https://p.scdn.co/mp3-preview/a' } },
    { uri: 'spotify:episode:xxxxxxxxxxxxxxxxxxxxxx', title: 'A podcast', subtitle: 'Show', duration: 1000 },
    { uri: 'spotify:track:7ouMYWpwJ422jRcDASZB7P', title: 'Lose Yourself', subtitle: 'Eminem', duration: 326000, isExplicit: true },
  ],
};

describe('links', () => {
  it('parses Spotify links and URIs', () => {
    expect(parseMusicLink('https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP?si=abc')).toMatchObject({ service: 'spotify', kind: 'playlist', id: '37i9dQZF1DX76Wlfdnj7AP' });
    expect(parseMusicLink('open.spotify.com/intl-es/album/6dVIqQ8qmQ5GBnJ9shOYGE')).toMatchObject({ kind: 'album', id: '6dVIqQ8qmQ5GBnJ9shOYGE' });
    expect(parseMusicLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toMatchObject({ kind: 'track' });
    expect(parseMusicLink('https://open.spotify.com/user/x/playlist/37i9dQZF1DX76Wlfdnj7AP')).toMatchObject({ kind: 'playlist' });
  });

  it('parses Apple Music links', () => {
    expect(parseMusicLink('https://music.apple.com/us/playlist/run-nyc/pl.u-AkAmPlyUxzRyLB')).toMatchObject({ service: 'apple', kind: 'playlist', id: 'pl.u-AkAmPlyUxzRyLB', storefront: 'us' });
    expect(parseMusicLink('https://music.apple.com/gb/album/1989/1440935467')).toMatchObject({ kind: 'album', id: '1440935467', storefront: 'gb' });
    expect(parseMusicLink('https://music.apple.com/us/album/1989/1440935467?i=1440935808')).toMatchObject({ kind: 'song', id: '1440935808' });
  });

  it('rejects other links', () => {
    expect(parseMusicLink('https://youtube.com/watch?v=x')).toBeNull();
    expect(parseMusicLink('hello')).toBeNull();
    expect(parseMusicLink('')).toBeNull();
  });
});

describe('scrapers', () => {
  it('reads a Spotify embed page', () => {
    const p = parseSpotifyEmbed(spotifyEmbed(SPOTIFY_ENTITY));
    expect(p?.name).toBe('Long Run');
    expect(p?.imageUrl).toBe('https://image-cdn-ak.spotifycdn.com/cover');
    expect(p?.tracks).toHaveLength(2);
    expect(p?.tracks[0]).toMatchObject({ id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley', durationMs: 213573 });
    expect(p?.tracks[1].explicit).toBe(true);
    expect(parseSpotifyEmbed('<html></html>')).toBeNull();
  });

  it('reads Apple JSON-LD', () => {
    const html = `<meta property="og:title" content="Long Run on Apple Music">
      <script id="schema:music-playlist" type="application/ld+json">${JSON.stringify({
        '@type': 'MusicPlaylist',
        name: 'Long Run',
        track: [
          { '@type': 'MusicRecording', name: 'Song A', duration: 'PT3M45S', url: 'https://music.apple.com/us/song/song-a/1440857792' },
          { '@type': 'MusicRecording', name: 'Song B', duration: 'PT1H2M3S', url: 'https://music.apple.com/us/album/x/123?i=456' },
        ],
      })}</script>`;
    const p = parseApplePage(html);
    expect(p.name).toBe('Long Run');
    expect(p.tracks.map((t) => t.appleId)).toEqual(['1440857792', '456']);
    expect(p.tracks[0].durationMs).toBe(225000);
    expect(isoDurationMs('PT1H2M3S')).toBe(3723000);
  });

  it('reads Apple serialized page data', () => {
    const data = [
      {
        data: {
          sections: [
            {
              items: [
                { title: 'Song A', artistName: 'A', duration: 200000, artwork: { dictionary: { url: 'https://is1-ssl.mzstatic.com/x/{w}x{h}{c}.{f}', bgColor: 'ff0000' } }, contentDescriptor: { kind: 'song', identifiers: { storeAdamID: '111' } } },
                { title: 'Video', contentDescriptor: { kind: 'musicVideo', identifiers: { storeAdamID: '222' } } },
                { title: 'Song B', artistName: 'B', duration: 100000, contentDescriptor: { kind: 'song', identifiers: { storeAdamID: 333 } } },
              ],
            },
          ],
        },
      },
    ];
    const html = `<script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script>`;
    const p = parseApplePage(html);
    expect(p.tracks.map((t) => t.appleId)).toEqual(['111', '333']);
    expect(p.tracks[0].artworkUrl).toBe('https://is1-ssl.mzstatic.com/x/300x300bb.jpg');
    expect(p.tracks[0].colorHints).toEqual(['#ff0000']);
  });
});

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports config', async () => {
    const app = createApp({ SPOTIFY_CLIENT_ID: 'abc' });
    const res = await app.request('/api/config');
    expect(await res.json()).toEqual({ spotifyClientId: 'abc', apple: false, publicLinks: true });
  });

  it('signs an Apple developer token', async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const app = createApp({ APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: pem.replace(/\n/g, '\\n') });
    const res = await app.request('/api/apple/token');
    const { token } = (await res.json()) as { token: string };
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decodeJwt(token)).toMatchObject({ iss: 'TEAM123456' });
  });

  it('loads a public Spotify playlist from the embed page', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://open.spotify.com/embed/playlist/')) return new Response(spotifyEmbed(SPOTIFY_ENTITY));
      if (url.startsWith('https://open.spotify.com/oembed')) {
        return Response.json({ thumbnail_url: url.includes('4uLU6') ? 'https://i.scdn.co/image/rick' : 'https://i.scdn.co/image/em' });
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({});
    const res = await app.request(`/api/public?url=${encodeURIComponent('https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP')}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; tracks: { artworkUrl: string }[]; service: string };
    expect(body.service).toBe('spotify');
    expect(body.name).toBe('Long Run');
    expect(body.tracks.map((t) => t.artworkUrl)).toEqual(['https://i.scdn.co/image/rick', 'https://i.scdn.co/image/em']);
  });

  it('loads a public Apple playlist via the page + iTunes lookup', async () => {
    const page = `<meta property="og:title" content="NYC Long Run on Apple Music"><script type="application/ld+json">${JSON.stringify({
      '@type': 'MusicPlaylist',
      track: [{ name: 'Song A', url: 'https://music.apple.com/us/song/a/111' }, { name: 'Gone', url: 'https://music.apple.com/us/song/b/999' }],
    })}</script>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith('https://music.apple.com/')) return new Response(page);
        if (url.startsWith('https://itunes.apple.com/lookup')) {
          return Response.json({
            results: [{ wrapperType: 'track', kind: 'song', trackId: 111, trackName: 'Song A', artistName: 'Artist', collectionName: 'Album', trackTimeMillis: 180000, artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg' }],
          });
        }
        return new Response('nope', { status: 404 });
      }),
    );
    const app = createApp({});
    const res = await app.request(`/api/public?url=${encodeURIComponent('https://music.apple.com/us/playlist/nyc/pl.u-abc123')}`);
    const body = (await res.json()) as { name: string; tracks: { title: string; artworkUrl: string }[]; warnings: string[] };
    expect(body.name).toBe('NYC Long Run');
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].artworkUrl).toBe('https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg');
    expect(body.warnings[0]).toMatch(/1 songs/);
  });

  it('rejects bad links and foreign image hosts', async () => {
    const app = createApp({});
    expect((await app.request('/api/public?url=hello')).status).toBe(400);
    expect((await app.request(`/api/image?url=${encodeURIComponent('https://evil.example.com/x.png')}`)).status).toBe(403);
  });
});
