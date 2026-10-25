import type { Track } from '../lib/types';

// A ready-made playlist so the app works before anything is connected. Order
// is planned for a 4:00 finish: Sinatra on the Verrazzano, the Beastie Boys
// arriving in Brooklyn, Bon Jovi at halfway ("whoa, we're half way there"),
// Eminem on the silent Queensboro, Jay-Z & Alicia Keys onto First Avenue,
// Rocky up the Fifth Avenue hill, and Queen at the finish.
// Artwork and exact durations are filled in from Deezer/iTunes on first load.

type DemoSong = [title: string, artist: string, album: string, duration: string];

const SONGS: DemoSong[] = [
  // Staten Island & the Verrazzano
  ['Theme from New York, New York', 'Frank Sinatra', 'Trilogy: Past Present Future', '3:26'],
  ['Born to Run', 'Bruce Springsteen', 'Born to Run', '4:31'],
  ['Eye of the Tiger', 'Survivor', 'Eye of the Tiger', '4:04'],
  ['Mr. Brightside', 'The Killers', 'Hot Fuss', '3:42'],
  // Brooklyn
  ['No Sleep Till Brooklyn', 'Beastie Boys', 'Licensed to Ill', '4:07'],
  ['Sabotage', 'Beastie Boys', 'Ill Communication', '2:58'],
  ['Uptown Funk (feat. Bruno Mars)', 'Mark Ronson', 'Uptown Special', '4:30'],
  ['Shut Up and Dance', 'WALK THE MOON', 'TALKING IS HARD', '3:19'],
  ['Can\'t Hold Us (feat. Ray Dalton)', 'Macklemore & Ryan Lewis', 'The Heist', '4:18'],
  ['Levitating', 'Dua Lipa', 'Future Nostalgia', '3:23'],
  ['Don\'t Start Now', 'Dua Lipa', 'Future Nostalgia', '3:03'],
  ['Physical', 'Dua Lipa', 'Future Nostalgia', '3:13'],
  ['Heads Will Roll', 'Yeah Yeah Yeahs', 'It\'s Blitz!', '3:42'],
  ['Pompeii', 'Bastille', 'Bad Blood', '3:34'],
  ['Wake Me Up', 'Avicii', 'True', '4:07'],
  ['Titanium (feat. Sia)', 'David Guetta', 'Nothing but the Beat', '4:05'],
  ['Song 2', 'Blur', 'Blur', '2:02'],
  ['Run This Town', 'JAY-Z', 'The Blueprint 3', '4:27'],
  ['Blinding Lights', 'The Weeknd', 'After Hours', '3:20'],
  // Barclays Center
  ['Juicy', 'The Notorious B.I.G.', 'Ready to Die', '5:02'],
  ['Dancing in the Dark', 'Bruce Springsteen', 'Born in the U.S.A.', '4:01'],
  ['Run Boy Run', 'Woodkid', 'The Golden Age', '3:32'],
  ['Welcome To New York', 'Taylor Swift', '1989', '3:32'],
  ['Shake It Off', 'Taylor Swift', '1989', '3:39'],
  ['Blank Space', 'Taylor Swift', '1989', '3:51'],
  ['Stronger', 'Kanye West', 'Graduation', '5:11'],
  ['Hall of Fame (feat. will.i.am)', 'The Script', '#3', '3:22'],
  ['Kickstart My Heart', 'Mötley Crüe', 'Dr. Feelgood', '4:42'],
  ['Feel It Still', 'Portugal. The Man', 'Woodstock', '2:43'],
  ['Seven Nation Army', 'The White Stripes', 'Elephant', '3:51'],
  ['Power', 'Kanye West', 'My Beautiful Dark Twisted Fantasy', '4:52'],
  // Halfway, on the Pulaski Bridge ("whoa, we're half way there")
  ['Livin\' On A Prayer', 'Bon Jovi', 'Slippery When Wet', '4:09'],
  ['Believer', 'Imagine Dragons', 'Evolve', '3:24'],
  ['Rolling in the Deep', 'Adele', '21', '3:48'],
  ['Crazy In Love (feat. JAY-Z)', 'Beyoncé', 'Dangerously In Love', '3:56'],
  ['Run the World (Girls)', 'Beyoncé', '4', '3:56'],
  // The silent Queensboro Bridge, then First Avenue
  ['Lose Yourself', 'Eminem', '8 Mile', '5:26'],
  ['Empire State Of Mind (feat. Alicia Keys)', 'JAY-Z', 'The Blueprint 3', '4:36'],
  ['Happy', 'Pharrell Williams', 'G I R L', '3:53'],
  ['Don\'t You Worry Child (feat. John Martin)', 'Swedish House Mafia', 'Until Now', '3:32'],
  ['Levels', 'Avicii', 'Levels', '3:19'],
  ['Dog Days Are Over', 'Florence + The Machine', 'Lungs', '4:12'],
  ['Bad Romance', 'Lady Gaga', 'The Fame Monster', '4:54'],
  ['Thunderstruck', 'AC/DC', 'The Razors Edge', '4:52'],
  ['HUMBLE.', 'Kendrick Lamar', 'DAMN.', '2:57'],
  ['Harlem', 'New Politics', 'New Politics', '2:48'],
  // Mile 20, the Bronx
  ['Till I Collapse', 'Eminem', 'The Eminem Show', '4:57'],
  ['Jenny from the Block', 'Jennifer Lopez', 'This Is Me... Then', '3:08'],
  ['Mo Money Mo Problems (feat. Puff Daddy & Mase)', 'The Notorious B.I.G.', 'Life After Death', '4:17'],
  ['Hey Ya!', 'OutKast', 'Speakerboxxx/The Love Below', '3:55'],
  ['Remember the Name (feat. Styles of Beyond)', 'Fort Minor', 'The Rising Tied', '3:50'],
  ['Thunder', 'Imagine Dragons', 'Evolve', '3:07'],
  ['Sweet Child O\' Mine', 'Guns N\' Roses', 'Appetite for Destruction', '5:56'],
  // The Fifth Avenue hill
  ['Gonna Fly Now (Theme from "Rocky")', 'Bill Conti', 'Rocky (Original Motion Picture Score)', '2:48'],
  ['Since U Been Gone', 'Kelly Clarkson', 'Breakaway', '3:08'],
  ['Intergalactic', 'Beastie Boys', 'Hello Nasty', '3:51'],
  // Central Park
  ['Don\'t Stop Me Now', 'Queen', 'Jazz', '3:29'],
  ['Firework', 'Katy Perry', 'Teenage Dream', '3:47'],
  ['Feel Good Inc.', 'Gorillaz', 'Demon Days', '3:42'],
  ['Runnin\' Down a Dream', 'Tom Petty', 'Full Moon Fever', '4:23'],
  // The last mile
  ['The Final Countdown', 'Europe', 'The Final Countdown', '5:10'],
  ['We Are The Champions', 'Queen', 'News of the World', '2:59'],
  // After the finish
  ['I Gotta Feeling', 'Black Eyed Peas', 'The E.N.D.', '4:49'],
];

const toMs = (s: string) => {
  const [m, sec] = s.split(':').map(Number);
  return (m * 60 + sec) * 1000;
};

export function demoTracks(): Track[] {
  return SONGS.map(([title, artist, album, duration], i) => ({
    uid: `demo-${i}`,
    source: 'demo',
    id: `demo-${i}`,
    title,
    artist,
    album,
    albumKey: `demo-album:${album.toLowerCase()}|${artist.toLowerCase()}`,
    durationMs: toMs(duration),
  }));
}

export const DEMO_NAME = 'Five Borough Mixtape (demo)';
