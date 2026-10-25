import { Modal } from './Modal';
import { course } from '../lib/course';

export function HelpDialog() {
  const bronx = course.landmarks.find((l) => l.id === 'bronx');
  return (
    <Modal title="How 26.2 Mixtape works" subtitle="Plan which song plays where on the 2026 TCS NYC Marathon course.">
      <div className="help">
        <ol>
          <li>
            <strong>Pick a playlist.</strong> Paste a Spotify or Apple Music link, connect your account to pick one of your playlists, or play with the demo.
          </li>
          <li>
            <strong>Set your finish time.</strong> Each song is laid end to end along the course at your pace, so every song becomes a coloured stretch of the route.
            “Hills” slows you on the bridges and the Fifth Avenue hill, and “Split” models a negative or a fading second half.
          </li>
          <li>
            <strong>Move songs.</strong> Drag a stretch of the course (long-press on touch screens), a block on the elevation strip, or a row in the list. The song snaps to the
            nearest song boundary and everything else shifts around it. Or select a song and send it straight to a landmark.
          </li>
          <li>
            <strong>Save it.</strong> Update your own Spotify playlist in place, or save the order as a new Spotify or Apple Music playlist. Apple Music only allows new playlists.
          </li>
        </ol>
        <h3>Colours</h3>
        <p>
          Each album gets a primary and a secondary colour from its cover art. When two songs in a row would look alike, for example two tracks from the same album, the second one
          switches to the secondary colour so you can always tell where one song ends.
        </p>
        <h3>The 2026 course</h3>
        <p>
          New for 2026, the Bronx section ({bronx ? `about mile ${(bronx.start / 1609.344).toFixed(1)}–${(bronx.end / 1609.344).toFixed(1)}` : 'mile 20–21'}) stays on Alexander Avenue
          past East 138th Street, then takes East 141st Street, Third Avenue and East 138th Street to the Madison Avenue Bridge. The rest of the course is unchanged. Distances are scaled
          to exactly 26.2 miles, so they can differ from the official mile markers by a few dozen metres.
        </p>
        <h3>Shortcuts</h3>
        <p>
          <kbd>⌘/Ctrl Z</kbd> undo · <kbd>⇧ ⌘/Ctrl Z</kbd> redo · <kbd>/</kbd> search songs · <kbd>Esc</kbd> deselect
        </p>
        <p className="muted small">
          Map © OpenStreetMap contributors, OpenFreeMap. Course line from a public 2024 route, adjusted for the 2026 Bronx change. Not affiliated with NYRR or TCS.
        </p>
      </div>
    </Modal>
  );
}
