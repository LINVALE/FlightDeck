/**
 * THE PUCK'S LINE-WORK — one icon set for the transport cluster and the menu.
 *
 * ⚖️ AN ICON ONLY REPLACES A WORD WHEN THE MEANING IS OBVIOUS (Peter, 08-26).
 * On this face it does more than that: a menu row is read inside a circle the
 * width of a thumb, and `My Live Radio` will never fit there. So the CIRCLE
 * carries the icon and the CENTRE reads the full name — navigate by the ring,
 * read by the middle. Where no icon is obvious the circle falls back to the
 * row's own artwork, and then to its initial, which is still a better token
 * than a title cropped to three letters.
 *
 * The matching is on Roon's own words, lowercased, and deliberately loose: the
 * Core says `Albums`, `My Live Radio`, `Play Album`, `Start Radio`, and a row it
 * does not recognise simply gets no icon rather than a wrong one.
 *
 * ES2018 floor, like every other shipped asset.
 */

var SVG_NS = 'http://www.w3.org/2000/svg';

/** Solid shapes: transport, where a filled mark reads faster than an outline. */
var FILLED = {
  minus: 'M5.5 10.9h13v2.2h-13z',
  plus: 'M10.9 5.5h2.2v13h-2.2zM5.5 10.9h13v2.2h-13z',
  prev: 'M7 6h2.2v12H7zm10 0v12l-8-6z',
  next: 'M17 6h-2.2v12H17zM7 6v12l8-6z',
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5.5h3.1v13H8zm5 0h3.1v13H13z',
};

/**
 * A filled cone with stroked waves: the one glyph that is both. The speaker is
 * the volume control's own face, and a level of nothing is the cone alone.
 */
var MIXED = {
  speaker: {
    fill: 'M4 9.5h3.4L12 5.4v13.2L7.4 14.5H4z',
    strokes: ['M15 9.4a3.7 3.7 0 0 1 0 5.2', 'M17.8 6.8a7.4 7.4 0 0 1 0 10.4'],
  },
  'speaker-muted': {
    fill: 'M4 9.5h3.4L12 5.4v13.2L7.4 14.5H4z',
    strokes: ['M15.2 9.2l5.6 5.6', 'M20.8 9.2l-5.6 5.6'],
  },
  'speaker-quiet': {
    fill: 'M4 9.5h3.4L12 5.4v13.2L7.4 14.5H4z',
    strokes: [],
  },
};

var STROKED = {
  shuffle: [
    'M3.6 7.5h2.7c1.8 0 2.9 1.2 3.9 2.8l2.2 3.4c1 1.6 2.1 2.8 3.9 2.8h3.2',
    'M3.6 16.5h2.7c1.8 0 2.9-1.2 3.9-2.8l2.2-3.4c1-1.6 2.1-2.8 3.9-2.8h3.2',
    'M18.2 5.6 20.6 7.5 18.2 9.4',
    'M18.2 14.6 20.6 16.5 18.2 18.4',
  ],
  repeat: [
    'M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14',
    'M16 13.8 18 16 20 13.8',
    'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10',
    'M4 10.2 6 8 8 10.2',
  ],
  'repeat-one': [
    'M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14',
    'M16 13.8 18 16 20 13.8',
    'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10',
    'M4 10.2 6 8 8 10.2',
    'M11 11.2 12.6 10.2V14',
  ],
  /* ---- the menu ---- */
  search: ['M15.2 15.2 20 20', 'M10 4.8a5.2 5.2 0 1 1 0 10.4 5.2 5.2 0 0 1 0-10.4'],
  artist: ['M12 4.9a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8', 'M5.6 19.4c0-3.3 2.9-5.1 6.4-5.1s6.4 1.8 6.4 5.1'],
  album: ['M12 4.6a7.4 7.4 0 1 1 0 14.8 7.4 7.4 0 0 1 0-14.8', 'M12 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8'],
  track: ['M11.4 16.6V5.4l7-1.5v11.2', 'M8.8 14.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2', 'M15.8 12.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2'],
  composer: ['M4.8 19.2l1.6-4.4 8.8-8.8 2.8 2.8-8.8 8.8z', 'M14.4 5.2 16.6 3l4.4 4.4-2.2 2.2'],
  genre: ['M4.6 11.9 12.1 4.4h7.3v7.3l-7.5 7.5z', 'M15.6 7.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2'],
  playlist: ['M4.6 7.4h10', 'M4.6 12h10', 'M4.6 16.6h6.4', 'M15.6 12.4v6.2l5-3.1z'],
  radio: [
    'M12 9.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4',
    'M8.2 15.8a5.4 5.4 0 0 1 0-7.6', 'M15.8 8.2a5.4 5.4 0 0 1 0 7.6',
    'M5.4 18.6a9.4 9.4 0 0 1 0-13.2', 'M18.6 5.4a9.4 9.4 0 0 1 0 13.2',
  ],
  settings: [
    'M12 8.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4',
    'M12 3.6v2.6', 'M12 17.8v2.6', 'M3.6 12h2.6', 'M17.8 12h2.6',
    'M6.1 6.1 7.9 7.9', 'M16.1 16.1l1.8 1.8', 'M17.9 6.1 16.1 7.9', 'M7.9 16.1 6.1 17.9',
  ],
  cloud: ['M7.4 18.2h9.2a3.7 3.7 0 0 0 .4-7.4 5.3 5.3 0 0 0-10.1-1.3 3.8 3.8 0 0 0 .5 8.7z'],
  library: ['M4.8 5.6h4.6v12.8H4.8z', 'M11.6 5.6h6.8v12.8h-6.8z', 'M11.6 10.2h6.8'],
  explore: ['M12 4.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2', 'M15.4 8.6 13.4 13.4 8.6 15.4l2-4.8z'],
  queue: ['M4.6 7.4h10', 'M4.6 12h10', 'M4.6 16.6h6.4', 'M17.6 10.4v7.2', 'M14 14h7.2'],
  /* a return: out along the top, down, and curving back on itself (Peter, 09-04) */
  'return': ['M17.6 6v5.2a3.2 3.2 0 0 1-3.2 3.2H6.4', 'M9.6 11 6.4 14.4l3.2 3.4'],
  /* ---- the services' own shelves (Peter, 09-04: "icons for favorites, what's new, tidal rising") ---- */
  sparkle: ['M12 4.2v4.4', 'M12 15.4v4.4', 'M4.2 12h4.4', 'M15.4 12h4.4', 'M12 8.6a3.4 3.4 0 0 1 3.4 3.4 3.4 3.4 0 0 1-3.4 3.4 3.4 3.4 0 0 1-3.4-3.4A3.4 3.4 0 0 1 12 8.6z', 'M18.2 5.8l1.2 1.2', 'M4.6 18.2l1.2-1.2'],
  rising: ['M4.4 17.6 9.6 12.4l3.2 3.2 6.8-6.8', 'M14.6 8.8h5v5'],
  award: ['M12 4.6a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2', 'M9.2 13.2 8 20l4-2.2 4 2.2-1.2-6.8'],
  chart: ['M5.2 19.4V12.2', 'M10 19.4V7.4', 'M14.8 19.4V10.6', 'M19.6 19.4V4.6'],
  clock: ['M12 4.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2', 'M12 7.8V12l3 2'],
  bookmark: ['M7 4.6h10v14.8l-5-3.6-5 3.6z'],
  /* ---- the genres: one picture each, chosen to be recognised at the size of a thumb ---- */
  maracas: ['M8.4 4.8a3 3 0 1 1 0 6 3 3 0 0 1 0-6', 'M8.4 10.8 5.6 19.2', 'M15.6 4.8a3 3 0 1 1 0 6 3 3 0 0 1 0-6', 'M15.6 10.8l2.8 8.4'],
  hat: ['M9.2 5.4h5.6l1.4 6.6H7.8z', 'M4 12h16', 'M4 12c0 2.2 3.6 3.6 8 3.6s8-1.4 8-3.6'],
  trumpet: ['M4 10.2h8.4', 'M12.4 8.6 20 5.8v10.8l-7.6-2.8z', 'M6.6 10.2v4', 'M9 10.2v4', 'M11.4 10.2v4', 'M4 14.2h8.4'],
  clef: ['M12 20.6c-2.2 0-3.6-1.4-3.6-3.2 0-2 1.6-3.4 3.6-3.4 1.8 0 3 1.2 3 2.8 0 1.6-1.2 2.6-2.6 2.6', 'M12 16.8 10.4 5.4c-.4-2.2 1.4-3.4 2.4-2.2 1.2 1.4.4 3.4-1 4.8L9.2 10.6c-1.6 1.6-1.4 4 .4 5.2'],
  harmonica: ['M3.6 8.6h16.8v6.8H3.6z', 'M7.2 11.2v1.6', 'M10.4 11.2v1.6', 'M13.6 11.2v1.6', 'M16.8 11.2v1.6'],
  guitar: ['M9 20a4.2 4.2 0 0 1-3.6-6.2 3.4 3.4 0 0 1 2-4.8 3.2 3.2 0 0 1 4.8 2 4.2 4.2 0 0 1 -.4 9', 'M10.6 11 18.6 3', 'M17.2 4.4l2.4 2.4', 'M9.2 14.2a1.4 1.4 0 1 0 0 .01'],
  mic: ['M12 3.8a3 3 0 0 1 3 3v5.4a3 3 0 0 1-6 0V6.8a3 3 0 0 1 3-3z', 'M6.8 11.2a5.2 5.2 0 0 0 10.4 0', 'M12 16.4v3.8', 'M9 20.2h6'],
  heart: ['M12 19.4 5.4 12.8a3.8 3.8 0 0 1 5.4-5.4L12 8.6l1.2-1.2a3.8 3.8 0 0 1 5.4 5.4z'],
  globe: ['M12 4.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2', 'M4.4 12h15.2', 'M12 4.4c2.4 2.2 2.4 13 0 15.2', 'M12 4.4c-2.4 2.2-2.4 13 0 15.2'],
  wave: ['M3.6 12c2.1-4.6 4.2-4.6 6.3 0s4.2 4.6 6.3 0 4.2-4.6 4.2 0'],
  clapper: ['M4.4 9.6h15.2v9.4H4.4z', 'M4.4 9.6 6 5.2h13.6L18 9.6', 'M9.4 5.6 8 9.6', 'M13.4 5.6 12 9.6', 'M17.4 5.6 16 9.6'],
  bubble: ['M5 6.4h14v8.4H10.4L6.6 18.2v-3.4H5z'],
  star: ['M12 4.2l2.3 4.9 5.3.7-3.9 3.7.9 5.3L12 16.3l-4.6 2.5.9-5.3L4.4 9.8l5.3-.7z'],
  snowflake: ['M12 4v16', 'M5.1 8l13.8 8', 'M5.1 16l13.8-8', 'M12 4l-2 2M12 4l2 2', 'M12 20l-2-2M12 20l2-2'],
  bell: ['M7.4 15.8V11a4.6 4.6 0 0 1 9.2 0v4.8l1.6 1.8H5.8z', 'M10.2 19.4a1.8 1.8 0 0 0 3.6 0', 'M12 4.6v1.8'],
  balloon: ['M12 4.2a4.4 5.2 0 1 1 0 10.4 4.4 5.2 0 0 1 0-10.4', 'M12 14.6l-.8 1.6h1.6z', 'M12 16.2c-1.4 1.4 1.4 2.6 0 4'],
  leaf: ['M5.4 18.6C5.4 10.2 10.2 5.4 18.6 5.4c0 8.4-4.8 13.2-13.2 13.2z', 'M5.4 18.6 13.2 10.8'],
  tag: ['M4.6 11.9 12.1 4.4h7.3v7.3l-7.5 7.5z', 'M15.6 7.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2'],
};

export function glyph(name) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var mixed = MIXED[name];
  var filled = mixed !== undefined ? mixed.fill : FILLED[name];
  if (filled !== undefined) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', filled);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    if (mixed === undefined) return svg;
  }
  var strokes = mixed !== undefined ? mixed.strokes : (STROKED[name] || []);
  for (var i = 0; i < strokes.length; i += 1) {
    var line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', strokes[i]);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1.7');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);
  }
  return svg;
}

export function hasGlyph(name) {
  return name !== null && (FILLED[name] !== undefined || STROKED[name] !== undefined || MIXED[name] !== undefined);
}

/**
 * The icon a browse row deserves, or null when none is obvious. Order matters:
 * `Play Album` is an ACTION and must read as play, not as a disc — so Roon's own
 * hint is consulted before the noun in the title.
 */
/**
 * ⚖️ A PICTURE FOR EACH GENRE, CHOSEN WISELY (Peter, 09-03: "icon with name
 * underneath — choose wisely for Latin, Country, etc."). Only on a GENRE level:
 * an album called "Country Roads" must not wear a hat. Order matters — "Latin
 * Jazz" is Latin, "Folk/Rock" is folk — so the more specific words come first.
 */
var GENRES = [
  ['latin', 'maracas'], ['norte', 'maracas'], ['salsa', 'maracas'],
  ['country', 'hat'], ['americana', 'hat'],
  ['jazz', 'trumpet'],
  ['classical', 'clef'], ['symphon', 'clef'], ['orchestr', 'clef'], ['opera', 'clef'], ['chamber', 'clef'],
  ['blues', 'harmonica'],
  ['folk', 'guitar'], ['acoustic', 'guitar'], ['singer', 'guitar'],
  ['hip-hop', 'mic'], ['hip hop', 'mic'], ['rap', 'mic'], ['vocal', 'mic'], ['karaoke', 'mic'],
  ['soul', 'heart'], ['r&b', 'heart'], ['ballad', 'heart'], ['easy listening', 'heart'],
  ['reggae', 'globe'], ['world', 'globe'], ['international', 'globe'], ['african', 'globe'], ['celtic', 'globe'],
  ['electronic', 'wave'], ['dance', 'wave'], ['techno', 'wave'], ['house', 'wave'], ['ambient', 'wave'],
  ['soundtrack', 'clapper'], ['stage', 'clapper'], ['screen', 'clapper'], ['film', 'clapper'], ['score', 'clapper'],
  ['comedy', 'bubble'], ['spoken', 'bubble'],
  ['holiday', 'snowflake'], ['christmas', 'snowflake'],
  ['religious', 'bell'], ['gospel', 'bell'], ['sacred', 'bell'],
  ['children', 'balloon'], ['kids', 'balloon'],
  ['new age', 'leaf'], ['meditation', 'leaf'], ['relax', 'leaf'],
  ['pop', 'star'],
  ['rock', 'guitar'], ['punk', 'guitar'], ['metal', 'guitar'], ['alternative', 'guitar'], ['indie', 'guitar'], ['grunge', 'guitar'],
];

export function genreIconFor(title) {
  var text = String(title === undefined || title === null ? '' : title).toLowerCase();
  for (var i = 0; i < GENRES.length; i += 1) {
    if (text.indexOf(GENRES[i][0]) !== -1) return GENRES[i][1];
  }
  return null;
}

export function iconNameFor(title, hint, onGenreLevel) {
  var text = String(title === undefined || title === null ? '' : title).toLowerCase();
  if (text === '') return null;
  var has = function (word) { return text.indexOf(word) !== -1; };
  if (onGenreLevel === true && hint !== 'action' && hint !== 'action_list' && text.indexOf('play ') !== 0) {
    // The nouns Roon puts on a genre level keep their own pictures.
    if (!has('artist') && !has('album') && !has('track') && !has('composer') && !has('playlist')) {
      var genre = genreIconFor(text);
      if (genre !== null) return genre;
    }
  }

  // A row that DOES something reads as what it does, never as its noun: Roon
  // hints `action` for a leaf and `action_list` for a row that opens its
  // actions (Play Genre, Play Artist…), and "Play …" is a verb whatever the hint.
  if (hint === 'action' || hint === 'action_list' || text.indexOf('play ') === 0) {
    if (has('shuffle')) return 'shuffle';
    if (has('radio')) return 'radio';
    if (has('queue') || has('add ')) return 'queue';
    if (has('play')) return 'play';
    return null;
  }
  if (has('search')) return 'search';
  if (has('radio')) return 'radio';   // before "my …": My Live Radio is a radio
  // The services' own shelves come before the nouns: "New Releases" is new,
  // not a release; "TIDAL Rising" is rising, not TIDAL.
  if (has('favorite') || has('favourite') || has('for you') || has('recommend') || text.indexOf('my ') === 0) return 'heart';
  if (has('taste of') || has('curated') || has('selection')) return 'award';
  if (has("what's new") || has('new release') || has('just added') || has('new ')) return 'sparkle';
  if (has('rising') || has('trending')) return 'rising';
  if (has('award') || has('editor') || has('press')) return 'award';
  if (has('chart') || has('top ') || has('popular')) return 'chart';
  if (has('history') || has('recent') || has('listened')) return 'clock';
  if (has('bookmark')) return 'bookmark';
  if (has('mood')) return 'leaf';
  if (has('podcast')) return 'mic';
  if (has('video')) return 'clapper';
  if (has('concert') || has('live ')) return 'radio';
  if (has('playlist')) return 'playlist';
  if (has('setting')) return 'settings';
  if (has('composer')) return 'composer';
  if (has('work')) return 'clef';
  if (has('artist') || has('performer') || has('conductor')) return 'artist';
  if (has('album') || has('discograph')) return 'album';
  if (has('track') || has('song')) return 'track';
  if (has('genre')) return 'genre';
  if (has('tag') || has('focus')) return 'tag';
  if (has('librar')) return 'library';
  if (has('explore') || has('browse') || has('discover')) return 'explore';
  if (has('queue')) return 'queue';
  // The streaming services are the one place a brand name is the whole meaning.
  if (has('tidal') || has('qobuz') || has('spotify') || has('deezer') || has('cloud')) return 'cloud';
  return null;
}
