export type Service = 'spotify' | 'apple';
export type TrackSource = Service | 'deezer' | 'itunes' | 'demo';

/** A song in the plan, normalised across services. */
export interface Track {
  /** Unique per entry in the plan (the same song can appear twice). */
  uid: string;
  source: TrackSource;
  /** Id in the source service. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** Grouping key for "same album": album id, artwork url or album name. */
  albumKey: string;
  durationMs: number;
  artworkUrl?: string;
  isrc?: string;
  spotifyUri?: string;
  /** Apple Music catalog song id (iTunes track ids are the same ids). */
  appleId?: string;
  /** Apple Music library song id, when the song isn't in the catalog. */
  appleLibraryId?: string;
  previewUrl?: string;
  explicit?: boolean;
  /** Colours a service already computed for the artwork (Apple Music does). */
  colorHints?: string[];
  /** Spotify local file — can be shown but not saved back through the API. */
  local?: boolean;
}

export interface PlaylistRef {
  service: Service | 'demo' | 'custom';
  id?: string;
  name: string;
  owner?: string;
  /** The signed-in user can overwrite this playlist in place. */
  editable?: boolean;
  url?: string;
  imageUrl?: string;
  storefront?: string;
}

export interface PlaylistSummary {
  service: Service;
  id: string;
  name: string;
  imageUrl?: string;
  trackCount?: number;
  owner?: string;
  editable: boolean;
}

export interface LoadedPlaylist {
  ref: PlaylistRef;
  tracks: Track[];
  /** Human-readable notes, e.g. "3 local files skipped". */
  warnings?: string[];
}

export interface Palette {
  primary: string;
  secondary: string;
}

export type Units = 'mi' | 'km';
