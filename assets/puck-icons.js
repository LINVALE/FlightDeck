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
  prev: 'M7 6h2.2v12H7zm10 0v12l-8-6z',
  next: 'M17 6h-2.2v12H17zM7 6v12l8-6z',
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5.5h3.1v13H8zm5 0h3.1v13H13z',
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
  tag: ['M4.6 11.9 12.1 4.4h7.3v7.3l-7.5 7.5z', 'M15.6 7.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2'],
};

export function glyph(name) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var filled = FILLED[name];
  if (filled !== undefined) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', filled);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }
  var strokes = STROKED[name] || [];
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
  return name !== null && (FILLED[name] !== undefined || STROKED[name] !== undefined);
}

/**
 * The icon a browse row deserves, or null when none is obvious. Order matters:
 * `Play Album` is an ACTION and must read as play, not as a disc — so Roon's own
 * hint is consulted before the noun in the title.
 */
export function iconNameFor(title, hint) {
  var text = String(title === undefined || title === null ? '' : title).toLowerCase();
  if (text === '') return null;
  var has = function (word) { return text.indexOf(word) !== -1; };

  if (hint === 'action') {
    if (has('shuffle')) return 'shuffle';
    if (has('radio')) return 'radio';
    if (has('queue') || has('add ')) return 'queue';
    if (has('play')) return 'play';
    return null;
  }
  if (has('search')) return 'search';
  if (has('playlist')) return 'playlist';
  if (has('radio')) return 'radio';
  if (has('setting')) return 'settings';
  if (has('composer')) return 'composer';
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
