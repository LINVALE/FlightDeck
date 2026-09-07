/**
 * WHAT A ROW DOES, IN A SENTENCE (Peter, 09-07: "that makes sense, though not
 * immediately obvious — can we provide info in hover tags to show what they
 * do?"). Roon's Browse rows carry a hint — list, action_list, action — and a
 * title, and nothing else says what choosing one will do. Measured on the
 * Core: inside a genre, Artists and Albums are the genre's own lists and open
 * the thing itself; "Play Genre" is the one row that acts on the genre as a
 * whole (Shuffle · Start Radio); an album opens as "Play Album" plus its
 * tracks, each offering Play Now · Add Next · Queue · Start Radio. This is the
 * one reading of those hints, shared by the puck, the Face and the phone, as
 * a hover tag on a screen and a spoken label on a phone. DOM-free.
 */

var VERBS = {
  'play now': 'plays this now, in place of what is playing',
  'add next': 'plays this after the current track',
  'queue': 'adds this to the end of the queue',
  'start radio': 'starts a radio built from this',
  'shuffle': 'plays this in a random order',
  'play': 'plays this',
  'play from here': 'plays the queue from this row',
};

function lower(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

/** The kind of thing a level is about, from its title: "Jazz" → genre-ish words come from the caller. */
function within(level) {
  var title = level && level.title ? String(level.title) : '';
  return title === '' ? 'this' : title;
}

/** One sentence for a row, given the level it sits in: `{ title, hierarchy }`. */
export function hintFor(item, level) {
  if (item === null || item === undefined) return '';
  var title = String(item.title || '');
  var hint = item.hint || null;
  var key = lower(title);
  var where = within(level);
  var hierarchy = level && level.hierarchy ? level.hierarchy : '';
  if (hint === 'action') {
    if (VERBS[key] !== undefined) return title + ': ' + VERBS[key];
    return title + ': does it now';
  }
  if (hint === 'action_list') {
    if (/^\d+\.\s/.test(title)) return 'this track: play now, add next, queue, or start a radio from it';
    var whole = /^play (genre|artist|album|playlist|composer|track|all|now)/i.exec(title);
    if (whole !== null) {
      var thing = whole[1].toLowerCase();
      if (thing === 'genre') return 'the whole genre: shuffle it, or start a radio from it';
      if (thing === 'artist') return 'the whole artist: shuffle, or start a radio from them';
      return 'the whole ' + thing + ': play now, add next, queue, or start a radio from it';
    }
    return title + ': a choice of ways to play it';
  }
  if (hint === 'list') {
    if (key === 'artists') return 'the artists in ' + where + ' — choose one to open it, nothing plays yet';
    if (key === 'albums') return 'the albums in ' + where + ' — choose one to open it, nothing plays yet';
    if (key === 'tracks') return 'the tracks in ' + where + ' — choose one for its ways to play';
    if (key === 'composers') return 'the composers in ' + where + ' — choose one to open it';
    if (key === 'playlists') return 'your playlists — choose one to open it';
    if (key === 'search') return 'search Roon by spelling a name';
    if (key === 'genres') return 'the genres — choose one to open its artists, albums and subgenres';
    // A genre row is known by Roon's own subtitle ("143 Artists, 126 Albums");
    // inside the genres hierarchy an artist's albums carry no such line.
    var genreish = /\d+\s+artists?,\s*\d+\s+albums?/i.test(String(item.subtitle || ''));
    // Whether it is a genre or a subgenre is the LEVEL's business: on the
    // Genres level it is a genre; inside Jazz it is a subgenre of Jazz — by
    // whichever route (the genres hierarchy, or Genres off the browse root).
    if (genreish || (hierarchy === 'genres' && lower(where) === 'genres')) {
      return lower(where) === 'genres'
        ? 'a genre: opens its artists, albums and subgenres'
        : 'a subgenre of ' + where + ': opens its artists, albums and subgenres';
    }
    var sub = item.subtitle ? ' — ' + String(item.subtitle) : '';
    return 'opens ' + title + sub + '; nothing plays until you choose how';
  }
  return '';
}
