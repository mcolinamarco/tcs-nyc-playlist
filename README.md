# 26.2 Mixtape — NYC Marathon playlist planner

Plan which song plays where on the **2026 TCS New York City Marathon** course (Sunday, November 1, 2026).

Load a Spotify or Apple Music playlist, set your predicted finish time, and every song becomes a coloured stretch of the course.
Drag songs along the route until the right song lands on the right bridge, then save the order back to your music service.

## Features

- **The 2026 course.** It includes the new Bronx routing: Alexander Ave → E 141st St → Third Ave → E 138th St. Bridge climbs are rebuilt, and the course is scaled to exactly 42.195 km. Mile markers, halfway, boroughs and 18 landmarks are marked.
- **Songs laid end to end at your pace.**
  - A finish-time slider (2:00–8:00), with presets, pace per mile and per km.
  - Optional *hills* model: you're slower on the Verrazzano, Queensboro and Fifth Avenue climbs, at the same finish time.
  - *Split* control for negative or fading second halves.
  - Crossfade setting, which shortens every song.
  - Minutes of music before you cross the start mat.
- **Colours from the album art.** Each cover yields a primary and a secondary colour (k-means in OKLab). When two neighbouring songs would look alike, such as songs from the same album, the second one uses its secondary colour, so you can always tell where one song ends.
- **Drag the snake.**
  - Grab a song's stretch of the course on the map (long-press on touch screens) and drop it elsewhere. It snaps to the nearest song boundary, and you see a live preview of everything shifting.
  - You can also drag blocks on the elevation timeline, or rows in the list. The timeline zooms (scroll, pinch or the +/− buttons) for precise placement.
  - Or select a song and send it to a landmark ("start this song at the Queensboro Bridge") or to any mile.
- **Load playlists.**
  - Paste any public Spotify or Apple Music playlist, album or song link.
  - Or connect your account and pick one of your playlists.
- **Search and add songs.** Searches Spotify or Apple Music when connected, or a keyless public catalog (Deezer, then iTunes).
- **Save back.**
  - Overwrite your own Spotify playlist in the new order, or save it as a new Spotify playlist.
  - Apple Music: save as a new library playlist. Apple's API can't reorder existing playlists.
  - Songs from another service are matched by ISRC, then by title and artist.
- **Take the plan with you.** Copy the race plan as text, or download a CSV: song → mile range → race clock → landmark.
- The map is locked to the course: you can zoom in freely but not out past the whole course or pan away from it.
- Undo/redo (⌘Z / ⇧⌘Z), light and dark map, miles or km, phone layout, and the plan is saved in the browser.

## Quick start

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

It works with no configuration:

- a demo playlist;
- keyless song search;
- pasting public Spotify and Apple Music links.

Open the app at **http://127.0.0.1:5173**, not `localhost`. Spotify only accepts loopback IPs for `http` redirect URIs.

### Connect Spotify (optional)

1. Create an app at <https://developer.spotify.com/dashboard> (Web API).
2. Add the redirect URI `http://127.0.0.1:5173/callback`, plus `https://your-domain/callback` for production.
3. `cp .env.example .env` and set `SPOTIFY_CLIENT_ID`.
4. Restart `npm run dev`.

Sign-in uses Authorization Code + PKCE in the browser, so no client secret is needed.

Spotify development-mode apps, as of February 2026:

- The app owner needs Spotify Premium.
- Up to 5 users, who you add under *User Management* in the dashboard.
- Apps can only read the songs of playlists the user owns or collaborates on. For anyone else's playlist, the app falls back to the public reader (below), and it can be saved as a new playlist.

### Connect Apple Music (optional)

This needs an Apple Developer Program membership.

1. In *Certificates, Identifiers & Profiles → Keys*, create a key with **MusicKit** enabled and download the `.p8`.
2. In `.env` set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and either `APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXX.p8` or `APPLE_PRIVATE_KEY`.

The server signs a developer token, and MusicKit JS handles the user sign-in.

## How it works

```
data/source/nyc-marathon-2024.geojson   2024 course line (Strava route via github.com/distanzrunning/gpx)
scripts/build-course.mjs                → src/data/course.json  (npm run course)
src/lib/course.ts                       distances, slicing, projection, landmarks
src/lib/pacing.ts                       finish time + hills + split → time(distance) and distance(time)
src/lib/schedule.ts                     songs → start/end time → stretch of course
src/lib/reorder.ts                      drop position → playlist index (nearest song boundary)
src/lib/colors.ts                       OKLab palette extraction + neighbour-aware colouring
src/lib/services/                       Spotify (PKCE), Apple Music (MusicKit), Deezer/iTunes, link parsing, save/export
src/components/                         MapLibre map, timeline, list, dialogs
server/app.ts                           Hono API: config, Apple token, public playlist reader, image proxy
```

The API runs inside the Vite dev server in development, and next to the built app in production (`server/node.ts`).

`GET /api/public?url=…` reads public links:

- **Spotify:** the public embed page, with artwork from oEmbed. Public albums use the Web API instead when `SPOTIFY_CLIENT_SECRET` is set.
- **Apple Music:** the catalog API when a developer token is configured. Otherwise the public page's track list plus the iTunes lookup API.

`GET /api/image` proxies album art from Spotify, Apple and Deezer CDNs, for colour extraction when an image isn't CORS-readable.

### About the course data

NYRR doesn't publish a GPX file.

- **Base line:** the public 2024 course line, which is the same route as every year from 2011 to 2025.
- **2026 Bronx change:** spliced in from NYRR's announcement. The new streets were placed by hand from the street geometry around them, so that 0.3-mile section may be off by a few dozen metres.
- **Elevation:** from a terrain model, which puts bridge decks at water level. The Verrazzano, Pulaski and Queensboro climbs are rebuilt from known deck heights.
- **Distances:** the line is scaled to exactly 26.2 miles. Song positions can differ from the official mile markers by roughly ±100 m.

To use an official 2026 GPX when one appears, convert it to GeoJSON in `data/source/` and run `npm run course`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with the API at http://127.0.0.1:5173 |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm start` | Serve `dist/` and the API (`PORT`, default 8787) |
| `npm test` | Unit tests: course, pacing, scheduling, reordering, colours, link parsing, scrapers, API routes |
| `npm run course` | Rebuild `src/data/course.json` from the source line |

## Deploying

Any Node 20+ host works (Render, Fly.io, Railway, a VPS):

1. `npm ci && npm run build`
2. `npm start`, with the environment variables from `.env.example`.
3. Add `https://your-domain/callback` to your Spotify app's redirect URIs.

The app also works as static files on a host without the API, with fewer features:

- Spotify sign-in needs `VITE_SPOTIFY_CLIENT_ID` at build time.
- Public links are limited to Spotify while signed in, and Apple albums.
- Apple Music sign-in doesn't work.

## Credits

- Map: © OpenStreetMap contributors, tiles by [OpenFreeMap](https://openfreemap.org). Change the style with `VITE_MAP_STYLE_DARK` / `VITE_MAP_STYLE_LIGHT`.
- Course line: 2024 TCS NYC Marathon route from [distanzrunning/gpx](https://github.com/distanzrunning/gpx).
- Not affiliated with New York Road Runners, TCS, Spotify or Apple.
