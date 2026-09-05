/**
 * THE PUCK'S BROWSE — Roon's library, read around a clock face.
 *
 * ⚖️ THE TIER IS CHOSEN BEFORE THE ITEMS ARE LOADED. Roon reports `list.count`
 * with the level, so the dial knows how to present a list without fetching it
 * first. Measured on a real library: Explore 7, Genres 56, Albums 2295 — which
 * is exactly why all three tiers have to exist.
 *
 *   ≤ 7     RADIAL    the choices ring the face, all of them at once, named
 *   ≤ 200   PAGES     the whole level in hand, twelve circles at a time; the
 *                     wheel walks the highlight round them and a full circle
 *                     turns the page (Peter, 09-03: "the menus become vertical,
 *                     which will be hard on the puck")
 *   more    LETTERS   a ring of initials — IF the level is in order — then the
 *                     pages anchored where that letter starts
 *
 * ⚖️ THE LETTER RING BELONGS TO THE BIG LISTS (Peter, 09-03). It was designed
 * for the 13–200 band, and that band never needed it: two hundred rows is a
 * spin. Two thousand three hundred albums is not — an index is the only way
 * into them — and those are exactly the lists Roon does sort. So the ring moved
 * to where it earns its keep, and the middle band became a column.
 *
 * ⚠️ MEASURED 09-03 on the live Core, and it is why the ring is EARNED rather
 * than assumed: Genres came back 56 long and NOT alphabetical — `Pop/Rock,
 * Jazz, Classical, Rock, …`, ordered by size — so a ring over it offered 26
 * letters that led nowhere, and a bisection for "C" answered 0 because the very
 * first title already sorted past it. The count says how MANY; only the titles
 * say whether they are in ORDER.
 *
 * A level over 200 cannot be loaded whole to find out, so its order is SAMPLED:
 * the first page plus three quarter-points and the last row. Non-decreasing
 * buckets ⇒ the ring, and the bisection behind it is then sound because the
 * same evidence is what a bisection rests on. Anything else ⇒ the plain column.
 *
 * ⚖️ THE AXIS IS THE PUCK'S, NOT A LEVEL'S (Peter, 09-04). ↑ ↓ walk the three
 * faces — music, library, queue (see puck-axis.js) — so inside the library
 * `commit()` is a tap on the disc or a circle and `back()` is a tap on the
 * title, whatever the tier. The alphabet's letter jump is the one move that is
 * NOT a Roon level, so it is remembered separately and climbed back out of
 * without popping the Core's stack.
 *
 * ⚠️ Its OWN session key. Roon keeps one browse stack per `multi_session_key`,
 * so a puck sharing the default would drag every other screen's level around.
 *
 * ES2018 floor, like every other shipped asset.
 */

import { glyph, iconNameFor } from './puck-icons.js';
import { createCollages } from './collage.js';

var SVG_NS = 'http://www.w3.org/2000/svg';

/* Seven ring the face at once; more than seven are pages of seven, so every
   circle keeps its name beneath (Peter, 09-04: "collage with name under"). */
var RADIAL_MAX = 7;
/** Roon's own load cap, and therefore the largest level we can read whole. */
var WHOLE_MAX = 200;
var OPT_R = 33;           // where the choices ring the face
var PAGE = 40;            // one linear page; Roon caps a load at 200
var WINDOW = 2;           // rows drawn either side of the chosen one
var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/**
 * ⚖️ THE ALPHABET IS THE KEYBOARD (Peter, 09-03: "use an alphabet selector from
 * the puck"). Search wants typing and the device has a wheel, so the same ring
 * of letters that jumps into a big list spells a query: turn to a letter, tap
 * to add it, and three more stops — space, delete, search.
 */
var SPACE = '\u2423';
var DELETE = '\u232b';
var GO = '\u23ce';
/* The three verbs are BUTTONS under the query (see `keys`); the ring is letters only. */

/**
 * The tier a count ALLOWS. Over the whole-load band the ring is only a
 * candidate — `present` has to see the order before it is drawn.
 */
export function tierFor(count) {
  if (count <= RADIAL_MAX) return 'radial';
  if (count <= WHOLE_MAX) return 'linear';
  return 'alpha';
}

/**
 * Where to sample a level too big to read whole. The first row comes free with
 * the first page; the rest are quarter points and the last row, which is the
 * one that catches a list ordered by size rather than by name.
 */
export function sampleOffsets(total) {
  var wanted = [Math.floor(total / 4), Math.floor(total / 2), Math.floor((3 * total) / 4), total - 1];
  var out = [];
  for (var i = 0; i < wanted.length; i += 1) {
    if (wanted[i] > 0 && out.indexOf(wanted[i]) === -1) out.push(wanted[i]);
  }
  return out;
}

/**
 * The ring stop a title belongs to — bucketed the way the Core already ordered
 * it, because the ring navigates by the bucket and the bisection behind it is
 * only sound while our order and Roon's agree.
 *
 * ⚖️ MEASURED 09-03, against every row of three live hierarchies (albums 2302,
 * artists 1481, composers 6305 — 10,088 titles read whole and compared pairwise).
 * Roon's collation is not the obvious one, and guessing it cost two letters:
 *
 *   · A leading "THE" is dropped — `The Real McCoy` sits among the R's — but
 *     "A" and "AN" are NOT: `A Yuletide Offering` sorts immediately before
 *     `ABBA Gold`, and `An Oscar Peterson Christmas` before `Ancient Heart`.
 *   · The separator after it may be a UNICODE hyphen: `The‐Dream` (U+2010) is
 *     filed under D, between `DRC Music` and `Drew Holcomb`.
 *   · Leading QUOTES, APOSTROPHES and DOTS are ignored — `...But Seriously` is
 *     under B, `'Round About Midnight` under R, `The "V Discs"` under V — but
 *     BRACKETS and question marks are NOT: `(What's The Story) Morning Glory?`
 *     and `?uestlove` both sort at the very top of their levels.
 *   · Other scripts sort AFTER Z: albums end `思い出のパリ`, composers `陈瑞祯`.
 *
 * 🔬 Under the rule below those three levels contain ZERO inversions; under the
 * obvious one (strip THE/A/AN, take the first character) they contain eleven,
 * and seven of them were enough to make the bisection refuse T, U and Z on a
 * library that has all three.
 *
 * The two outer bands are `#` (0x23, below `A`) and `~` (0x7E, above `Z`), so a
 * plain string compare of two stops is already Roon's own order.
 */
/** The title as Roon files it: accents folded, a leading THE dropped, leading quotes and dots ignored, upper case. */
export function keyOf(title) {
  var text = String(title === undefined || title === null ? '' : title);
  // Accents fold: Roon files `Édith Piaf` under E, and a bare code-point
  // comparison would exile her past Z with the CJK.
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  text = text.toUpperCase().replace(/^THE[\s\u2010-\u2015-]+/, '');
  return text.replace(/^[\u0022\u0027\u2018\u2019\u201c\u201d.\s]+/, '');
}

export function letterOf(title) {
  var first = keyOf(title).charAt(0);
  if (first >= 'A' && first <= 'Z') return first;
  // ASCII digits and the marks Roon does sort on, plus the general-punctuation
  // block (… – « ‘): a Latin title that merely opens with one.
  var code = first.charCodeAt(0);
  if (isNaN(code) || code < 0x80) return '#';
  /**
   * Latin-1 punctuation and symbols (¡ ¿ « » § …), the general-punctuation
   * block (… – ‘) and the symbol blocks up to the dingbats (★ ♪ →): Roon files
   * a title that merely opens with one of these AHEAD of A. Measured 09-05:
   * Tracks begins "¡Buenos Días, Marco!", which the old rule exiled past Z —
   * and that one row cost 28,390 tracks their ring.
   */
  if (code >= 0xa1 && code <= 0xbf) return '#';
  if (code >= 0x2000 && code <= 0x2bff) return '#';
  return '~';
}

/**
 * Is this level in alphabetical order? Roon never says, and it is not always
 * true — so it is read off the titles rather than assumed from the hierarchy.
 * The bucket, not the title, is what the ring navigates by, so that is what has
 * to be non-decreasing.
 */
/**
 * Where a title stands against something SPELT — "MAR" — in Roon's order: the
 * ring's band first, so `#` and the other scripts keep their ends, then the
 * rest of the key letter by letter. Zero means the title is under the prefix.
 */
export function prefixCompare(title, prefix) {
  var band = letterOf(title);
  var head = prefix.charAt(0);
  if (band !== head) return band < head ? -1 : 1;
  if (prefix.length === 1) return 0;
  var rest = keyOf(title).slice(1, prefix.length);
  var want = prefix.slice(1);
  if (rest === want) return 0;
  return rest < want ? -1 : 1;
}

export function isAlphabetical(items) {
  for (var i = 1; i < items.length; i += 1) {
    if (letterOf(items[i].title) < letterOf(items[i - 1].title)) return false;
  }
  return items.length > 0;
}

/**
 * A row carrying Roon's `action` hint is the leaf a listener deliberately chose:
 * Play Now, Add Next, Queue, Start Radio, a station. Some Core builds return a
 * useful message and some return only `none`; the item hint is the stable part.
 */
export function selectionComplete(item, result) {
  if (result.isError === true) return false;
  return item.hint === 'action' || result.action === 'none' || result.action === 'message';
}

/**
 * Roon's queue rows in the shape every other level is drawn in. Row zero is
 * what is PLAYING — Roon's window has no history — so it is marked as such;
 * the hub says "now" for it and "n / total" for the rest (see queueSub).
 */
export function queueRows(data) {
  var items = data !== null && data !== undefined && Array.isArray(data.items) ? data.items : [];
  var rows = [];
  for (var i = 0; i < items.length; i += 1) {
    var item = items[i];
    rows.push({
      title: item.title || '(untitled)',
      // The artist alone: a jazz credit runs to five names before the album
      // would even start, and the hub has room for one line of it.
      subtitle: item.artist || item.album || '',
      art: item.art || null,
      hint: 'queue',
      queueId: String(item.id === undefined || item.id === null ? '' : item.id),
      now: i === 0,
    });
  }
  return rows;
}

/**
 * ⚖️ RECENT AND TOP COME FROM THE DECK'S OWN LEDGER (Peter, 09-05: "we
 * maintain recent and other items in other views"). Roon's API has no
 * history and no sort, but FlightDeck sees every zone and keeps what it saw:
 * title, artist, album (since 09-05) and when. Folded per level kind —
 * tracks by title and artist, albums by album and artist, artists by the first
 * name on the credit — newest first for RECENT, most played first for TOP.
 */
export function firstArtist(line2) {
  var text = String(line2 === undefined || line2 === null ? '' : line2);
  var cut = text.indexOf(' / ');
  return (cut === -1 ? text : text.slice(0, cut)).trim();
}

export function ledgerRows(tracks, kind, mode, now) {
  var at = typeof now === 'number' ? now : Date.now();
  var folded = {};
  var order = [];
  for (var i = 0; i < tracks.length; i += 1) {
    var t = tracks[i];
    var artist = firstArtist(t.line2);
    var name;
    if (kind === 'artists') name = artist;
    else if (kind === 'albums') name = String(t.line3 || '');
    else name = String(t.title || '');
    if (name === '') continue;
    var key = kind === 'artists' ? keyOf(name) : keyOf(name) + '|' + keyOf(artist);
    var row = folded[key];
    if (row === undefined) {
      row = { kind: kind, name: name, artist: artist, plays: 0, last: '', zone: '', artKey: t.artKey || null };
      folded[key] = row;
      order.push(row);
    }
    row.plays += 1;
    if (typeof t.at === 'string' && t.at > row.last) { row.last = t.at; row.zone = t.zoneName || ''; }
  }
  order.sort(mode === 'top'
    ? function (x, y) { return y.plays - x.plays || (y.last > x.last ? 1 : (y.last < x.last ? -1 : 0)); }
    : function (x, y) { return y.last > x.last ? 1 : (y.last < x.last ? -1 : 0); });
  var rows = [];
  for (var r = 0; r < order.length && r < 60; r += 1) {
    var o = order[r];
    rows.push({
      title: o.name, kind: o.kind, name: o.name, artist: o.artist, plays: o.plays, hint: 'local',
      subtitle: mode === 'top'
        ? String(o.plays) + (o.plays === 1 ? ' play' : ' plays') + (kind === 'artists' || o.artist === '' ? '' : ' · ' + o.artist)
        : ago(o.last, at) + (o.zone === '' ? '' : ' · ' + o.zone),
      art: null,
    });
  }
  return rows;
}

/** "3 min ago", "2 h ago", "4 d ago" — the ledger's stamp, read for a glance. */
export function ago(iso, now) {
  var then = Date.parse(iso);
  if (isNaN(then)) return '';
  var s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return String(Math.round(s / 60)) + ' min ago';
  if (s < 86400) return String(Math.round(s / 3600)) + ' h ago';
  return String(Math.round(s / 86400)) + ' d ago';
}

export function createBrowse(options) {
  var host = options.host;
  var root = options.root;
  var el = options.el;
  var zoneId = options.zoneId;
  var flash = options.flash;
  var tick = options.tick || function () {};
  var onChange = options.onChange || function () {};
  var onAxis = options.onAxis || function () {};
  var zones = options.zones || function () { return []; };
  var outputId = options.outputId || function () { return null; };
  var fence = options.fence || function () { return null; };
  var act = options.act || function () { return Promise.resolve(false); };
  var onSwitch = options.onSwitch || function () {};
  var session = 'puck-' + String(Math.floor(Math.random() * 1e6));

  /* ---------- the layer ---------- */

  var layer = el('div', 'browse');
  var veil = el('div', 'browse-veil');
  /**
   * ⚖️ THE LEVEL'S TITLE IS THE WAY BACK (Peter, 09-03: "back to previous menu
   * available on clicking"). It is the one thing in browse that is always at
   * the top and never under a circle, and a title that reads "‹ GENRES" says
   * where a tap on it goes. It also carries the depth: the breadcrumb arcs
   * that used to are gone — in browse they read as a progress circle.
   */
  var level = el('div', 'level');
  /**
   * ⚖️ THE LABEL ROTATES THE MODE (Peter, 09-05: "each of these views should
   * present options for recently played, random or most frequently played,
   * controlled by clicking on the label and rotating"). So the label is two
   * things now: the ‹ at its left is the way up a level, as the whole title
   * was; the NAME cycles the level's mode where it has modes — A–Z, RECENT,
   * TOP, RANDOM — and is the way up where it has none.
   */
  var levelBack = el('span', 'level-back', '‹');
  var levelName = el('span', 'level-name');
  level.appendChild(levelBack);
  level.appendChild(levelName);
  levelBack.addEventListener('click', function (event) { event.stopPropagation(); back(); });
  levelName.addEventListener('click', function (event) { event.stopPropagation(); cycleMode(); });
  level.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
  level.addEventListener('pointerup', function (event) { event.stopPropagation(); });
  var optWrap = el('div', 'opt-wrap');
  var chosen = el('div', 'chosen');
  var chosenArt = document.createElement('img');
  chosenArt.className = 'chosen-art';
  chosenArt.alt = '';
  chosenArt.style.display = 'none';
  var chosenTitle = el('div', 'chosen-title');
  var chosenSub = el('div', 'chosen-sub');
  chosen.appendChild(chosenArt);
  // In the queue the hub is PLAY (Peter, 09-04): a ▶ above the chosen title.
  var chosenPlay = el('div', 'chosen-play');
  chosenPlay.appendChild(glyph('play'));
  chosen.appendChild(chosenPlay);
  chosen.appendChild(chosenTitle);
  chosen.appendChild(chosenSub);
  var linsub = el('div', 'linsub');
  var count = el('div', 'count');
  /**
   * ⚖️ A CLEAR SET OF KEYS FOR INPUT (Peter, 09-03: "on alphabet entry we need
   * an enter and back/clear set of buttons"). Enter, space, delete and clear
   * were stops on the ring, found by spinning to them; now they are buttons
   * under the query — the same circles as the transport cluster — and the ring
   * keeps only the letters, larger for it.
   */
  var keys = el('div', 'spell-keys');
  function key(symbol, label, act) {
    var node = el('div', 'key', symbol);
    node.setAttribute('title', label);
    node.addEventListener('click', function (event) { event.stopPropagation(); act(); });
    node.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    node.addEventListener('pointerup', function (event) { event.stopPropagation(); });
    return node;
  }
  /**
   * ⚖️ THE VERBS, IN THE CENTRE (Peter, 09-03: "a click on a next arrow in the
   * centre — next/prev for the menu, select to choose, up/back for the previous
   * level"). ‹ and › either side of the name, and the disc itself the select.
   *
   * ⚖️ ↑ ↓ ON THE DISC ARE THE AXIS, NOT THE LEVEL (Peter, 09-04: "an up and a
   * down arrow on that centre circle, rather than the single return arrow, that
   * indicates a swipe up or down — and those navigate between control, browse
   * and queue"). The two arrows say what a swipe does here: up and down walk
   * the puck's three faces. Climbing a LEVEL is the title's job — "‹ GENRES" at
   * the top has always been the way back — so the return arrow the disc wore
   * is gone. Circles, like everything else pressable.
   */
  var nav = el('div', 'nav-keys');
  var prevKey = key('\u2039', 'previous', function () { move(-1); });
  var nextKey = key('\u203a', 'next', function () { move(1); });
  var upKey = key('', 'swipe up: the face above', function () { onAxis(-1); });
  var downKey = key('', 'swipe down: the face below', function () { onAxis(1); });
  upKey.appendChild(glyph('up'));       // the same line-work as the music face's ↑ ↓: one idiom
  downKey.appendChild(glyph('down'));
  prevKey.className = 'key key-prev';
  nextKey.className = 'key key-next';
  upKey.className = 'key key-up';
  downKey.className = 'key key-down';
  nav.appendChild(upKey);
  nav.appendChild(downKey);
  nav.appendChild(prevKey);
  nav.appendChild(nextKey);
  /**
   * ⚖️ THE NAME AND THE SELECT ARE ONE THING (Peter, 09-04: "make the centre
   * select text and the button one item in a larger bolder circle, e.g. 'Play
   * now'"). The centre circle reads the highlighted item, subtitle inside, and
   * a tap on it selects; the ● key it replaces is gone.
   */
  chosen.addEventListener('click', function (event) { event.stopPropagation(); commit(); });
  chosen.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
  chosen.addEventListener('pointerup', function (event) { event.stopPropagation(); });
  /**
   * ⚖️ ROOMS: PULL FROM · SHIFT TO (Peter, 09-05: "incorporating pull from and
   * shift to on the puck could be useful if a simple interface is possible").
   * The other rooms ring the face as the queue does — the name in each circle,
   * the playing ones white-rimmed — and the hub carries the two verbs as two
   * keys under the chosen room's name: PULL brings what that room plays here,
   * SHIFT sends what plays here to it. Each is lit only when it can act.
   */
  var roomKeys = el('div', 'room-keys');
  var pullKey = key('', 'pull from: bring what that room plays here', function () { if (view !== null && view.rooms) pullFrom(); });
  pullKey.appendChild(glyph('pull'));
  pullKey.className = 'key key-pull';
  var shiftKey = key('', 'shift to: send what plays here to that room', function () { if (view !== null && view.rooms) shiftTo(); });
  shiftKey.appendChild(glyph('shift'));
  shiftKey.className = 'key key-shift';
  roomKeys.appendChild(pullKey);
  roomKeys.appendChild(shiftKey);
  chosen.appendChild(roomKeys);

  keys.appendChild(key('\u232b', 'delete the last letter', function () { if (view && view.spell) spellStop(DELETE); }));
  keys.appendChild(key('\u2715', 'clear', function () { if (view && view.spell) { view.spell.query = ''; tick(); draw(); } }));
  keys.appendChild(key('\u2423', 'space', function () { if (view && view.spell) spellStop(SPACE); }));
  keys.appendChild(key('\u21b5', 'search', function () { if (view && view.spell) spellStop(GO); }));
  layer.appendChild(veil);
  layer.appendChild(level);
  layer.appendChild(optWrap);
  layer.appendChild(chosen);
  layer.appendChild(linsub);
  layer.appendChild(count);
  layer.appendChild(nav);
  layer.appendChild(keys);
  host.appendChild(layer);

  /* ---------- what is on the face ---------- */

  var SLOTS = 7;     // circles a page (see drawPaged)
  var view = null;   // null when closed
  var epoch = 0;
  var busy = false;
  var spellReturn = null;   // { speller, depth } while search results are up
  var parked = null;        // { view, spellReturn } — a library level set aside by the axis

  function current(mine) { return mine === epoch && view !== null; }

  function ask(body, sessionKey) {
    body.sessionKey = sessionKey || session;
    var zone = zoneId();
    if (zone !== null && body.load !== true) body.zoneId = zone;
    return fetch('/api/v1/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || ('browse failed ' + String(response.status)));
        return data;
      });
    });
  }

  /* ---------- the queue: Roon's forward window, read as a level ---------- */

  /**
   * ⚖️ THE QUEUE IS A LEVEL OF THIS FACE (Peter, 09-04: "an option to expose
   * and select from the queue"). Roon's forward window — what is playing and
   * what comes next, fifty at most — drawn as the pages of seven every other
   * list is drawn as: each circle the track's own sleeve, its title beneath,
   * the centre reading title over artist, and a tap on a row PLAYS FROM THERE.
   * It is not a Roon browse level: it comes from the deck's own queue mirror
   * (/api/v1/queue) and a row is `play_from_here`, not an item key. Everything
   * else — tier, pages, highlight, count — is the machinery the library uses.
   */
  function queueLoad(zone, attempt) {
    return fetch('/api/v1/queue?zone=' + encodeURIComponent(zone), { cache: 'no-store' })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || ('queue unavailable (' + String(response.status) + ')'));
          return data;
        });
      })
      .then(function (data) {
        // The mirror fills as zones arrive; for its first moments it may honestly
        // still be loading. Wait in place — never by asking twice at once.
        if (data.ready !== true && attempt < 8) {
          return new Promise(function (resolve) { setTimeout(resolve, 250); })
            .then(function () { return queueLoad(zone, attempt + 1); });
        }
        return data;
      });
  }

  function presentQueue(zone, data) {
    var rows = queueRows(data);
    var was = view !== null && view.queue ? view : null;
    view = {
      // A ring of titled circles, the whole queue at once (see drawQueueRing).
      hierarchy: 'queue', tier: 'queue',
      title: 'Queue', total: rows.length,
      // Row zero is what is playing; the highlight opens on the first row still to come.
      items: rows, base: 0, sel: rows.length > 1 ? 1 : 0, depth: 0, letter: null, paging: false,
      letters: null, probes: {}, plain: true,
      queue: { zone: zone, generation: data.generation || '', revision: data.revision },
    };
    // A queue redrawn under a hand keeps the row the hand was on, if it is still there.
    if (was !== null && was.items[was.sel] !== undefined) {
      var held = was.items[was.sel].queueId;
      for (var i = 0; i < rows.length; i += 1) if (rows[i].queueId === held) { view.sel = i; break; }
    }
    draw();
    onChange(true);
  }

  function openQueue() {
    var zone = zoneId();
    if (zone === null) { flash('no room to read a queue for'); return; }
    busy = true;
    epoch += 1;
    var mine = epoch;
    view = null;
    queueLoad(zone, 0)
      .then(function (data) {
        busy = false;
        if (mine !== epoch) return;
        presentQueue(zone, data);
      })
      .catch(function (error) {
        busy = false;
        if (mine !== epoch) return;
        view = null;
        onChange(false);
        flash(String(error.message || error).slice(0, 80));
      });
  }

  /** The queue moved under the face — a track ended, a row was added: read it again, in place. */
  function reloadQueue() {
    if (view === null || !view.queue) return;
    var mine = epoch;
    var zone = view.queue.zone;
    queueLoad(zone, 0)
      .then(function (data) { if (current(mine) && view.queue) presentQueue(zone, data); })
      .catch(function () {});
  }

  /**
   * ⚖️ A ROW IN THE QUEUE PLAYS FROM THERE — Roon's own `play_from_here`, through
   * the deck, fenced by the screen generation and the queue revision the rows
   * were read at: a queue that moved under the hand is read again, never
   * guessed at. The playing row is refused here, as the deck refuses it.
   */
  function playFrom(item) {
    if (item.now) { flash('already playing'); return; }
    var fence = view.queue;
    var mine = epoch;
    busy = true;
    tick();
    fetch('/api/v1/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: fence.zone, itemId: item.queueId, generation: fence.generation, queueRevision: fence.revision }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        busy = false;
        if (!current(mine)) return;
        if (response.ok) { flash('playing ' + item.title); close(); return; }
        if (data.code === 'stale' || data.code === 'current') { flash(data.error || 'the queue moved'); reloadQueue(); return; }
        flash(data.error || ('could not play from the queue (' + String(response.status) + ')'));
      });
    }).catch(function () {
      busy = false;
      if (current(mine)) flash('could not reach FlightDeck');
    });
  }

  /* ---------- drawing ---------- */

  function itemAt(index) {
    var at = index - view.base;
    return at >= 0 && at < view.items.length ? view.items[at] : null;
  }

  function place(node, leftPercent, topPercent) {
    node.style.left = String(leftPercent) + '%';
    node.style.top = String(topPercent) + '%';
  }

  function draw() {
    if (view === null) return;
    root.setAttribute('data-browse', view.tier);
    root.setAttribute('data-tier', view.tier);
    if (view.tier !== 'linear') root.removeAttribute('data-lettered');
    if (view.spell) root.setAttribute('data-spell', '1'); else root.removeAttribute('data-spell');
    paintLevel();
    while (optWrap.firstChild) optWrap.removeChild(optWrap.firstChild);

    if (view.tier === 'linear') drawPaged();
    else if (view.tier === 'queue') drawQueueRing();
    else if (view.tier === 'rooms') drawRooms();
    else if (view.tier === 'local') drawLocalRing();
    else drawRing();

  }

  function label(index) {
    if (view.tier === 'alpha') return view.letters[index];
    var item = itemAt(index);
    return item === null ? '' : item.title;
  }

  /** The name under a circle: the title, and a ▶ before the row that is playing. */
  function nameOf(item) {
    return item === null ? '' : (item.now === true ? '\u25b6 ' : '') + item.title;
  }

  /** Under a queue row's title in the hub: "now", or its place in the queue, then the artist. */
  function queueSub(pick) {
    var where = pick.now === true ? 'now' : String(view.sel + 1) + ' / ' + String(view.total);
    return where + (pick.subtitle ? ' \u00b7 ' + pick.subtitle : '');
  }

  /* ---------- modes: A–Z · recent · top · random, rotated on the label ---------- */

  /**
   * ⚖️ AND SEARCH (Peter, 09-05: "an option to search should bring up the
   * search function and alphabet wheel"): the last stop on the label opens the
   * speller for this kind, and its results open straight into the matching
   * category — tracks for Tracks, albums for Albums, artists for Artists.
   */
  var MODES = ['az', 'recent', 'top', 'random', 'search'];
  var MODE_WORD = { az: '', recent: 'RECENT ', top: 'TOP ', random: 'RANDOM ', search: 'SEARCH ' };

  /** The three library lists that have modes; Roon names them, so the name is the key. */
  function levelKind(title) {
    var t = String(title === undefined || title === null ? '' : title).toLowerCase();
    return t === 'artists' || t === 'albums' || t === 'tracks' ? t : null;
  }

  /**
   * The level that owns the mode, if THIS view is in its territory: the list
   * itself, a page hung under it (a letter's, or RANDOM's), or its ledger ring.
   * A level reached from a ledger row by the search hop is Roon's own again —
   * it wears its own name, and its label is the way up, not a mode.
   */
  function modeBase(v) {
    if (!v) return null;
    if (v.kind) return v;
    if (v.parent && v.parent.kind && (v.local || v.letters !== null)) return v.parent;
    return null;
  }

  function paintLevel() {
    var base = modeBase(view);
    var mode = base === null ? 'az' : (base.mode || 'az');
    levelName.textContent = (base !== null && mode !== 'az' ? MODE_WORD[mode] : '') + (base !== null ? base.title : view.title);
    if (base !== null && mode !== 'az') root.setAttribute('data-mode', mode); else root.removeAttribute('data-mode');
  }

  function cycleMode() {
    if (view === null || busy) return;
    var base = modeBase(view);
    if (base === null) { back(); return; }
    var next = MODES[(MODES.indexOf(base.mode || 'az') + 1) % MODES.length];
    base.mode = next;
    tick();
    if (next === 'az') { view = base; draw(); return; }
    if (next === 'random') { view = base; randomPage(); return; }
    if (next === 'search') { view = base; spell({ title: 'Search', input: { prompt: 'search ' + base.title.toLowerCase() } }, base.kind); return; }
    openLocal(base, next);
  }

  /** RANDOM: a page at a random offset of the big list, or a random row of a small one. */
  function randomPage() {
    var base = modeBase(view);
    if (base === null) return;
    var offset = Math.floor(Math.random() * Math.max(1, base.total));
    if (base.tier === 'linear') { view = base; base.sel = offset; fill(); fillBack(); draw(); return; }
    landAt(base, offset);
  }

  /** RECENT and TOP: the deck's ledger, folded for this level, as a ring of titled circles. */
  function openLocal(base, mode) {
    var mine = epoch;
    busy = true;
    levelName.textContent = 'reading…';
    fetch('/api/v1/recent?limit=2000', { cache: 'no-store' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        busy = false;
        if (!current(mine)) return;
        var rows = ledgerRows(data.tracks || [], base.kind, mode);
        view = {
          hierarchy: base.hierarchy, tier: 'local', title: base.title, total: rows.length,
          items: rows, base: 0, sel: 0, depth: base.depth, letter: null, paging: false,
          letters: null, probes: {}, plain: true, local: true, parent: base, roonLevel: false, spelt: null,
        };
        draw();
      })
      .catch(function () {
        busy = false;
        if (!current(mine)) return;
        base.mode = 'az';
        view = base;
        draw();
        flash('the deck has no history to show');
      });
  }

  var LOCAL_PAGE = 12;

  function drawLocalRing() {
    var n = view.total;
    var first = Math.floor(view.sel / LOCAL_PAGE) * LOCAL_PAGE;
    var m = Math.max(0, Math.min(LOCAL_PAGE, n - first));
    var size = tokenSize(m);
    named = false;
    for (var k = 0; k < m; k += 1) {
      var index = first + k;
      var item = view.items[index];
      var angle = (k / m) * 2 * Math.PI - Math.PI / 2;
      var node = el('div', index === view.sel ? 'opt opt-on' : 'opt');
      var mine = index === view.sel ? size * 1.3 : size;
      node.appendChild(titledToken(item.title, size, mine));
      place(node, 50 + OPT_R * Math.cos(angle), 50 + OPT_R * Math.sin(angle));
      bindPick(node, index);
      optWrap.appendChild(node);
    }
    var pick = itemAt(view.sel);
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    chosenTitle.textContent = pick !== null ? pick.title : 'Nothing played yet';
    chosenSub.textContent = pick === null ? '' : pick.subtitle;
    root.setAttribute('data-named', '0');
    linsub.textContent = '';
    count.textContent = n > LOCAL_PAGE ? String(first + 1) + '–' + String(first + m) + ' of ' + String(n) : '';
  }

  /**
   * ⚖️ A LEDGER ROW HOPS INTO ROON BY SEARCH. The deck's history has names, not
   * item keys, so choosing a recent album asks Roon's own search for it, opens
   * the matching category, picks the row whose name (and artist) agree, and
   * presents THAT level — an album's tracks and Play Album, an artist's page, a
   * track's Play Now / Add Next / Queue. ‹ from there is the ledger ring again.
   */
  function hop(row) {
    var from = view;
    var mine = epoch;
    var want = { tracks: 'Tracks', albums: 'Albums', artists: 'Artists' }[row.kind];
    var query = row.kind === 'artists' ? row.name : row.title;
    var wantKey = keyOf(query);
    busy = true;
    levelName.textContent = 'finding…';
    ask({ hierarchy: 'search', popAll: true, input: query })
      .then(function () { return ask({ hierarchy: 'search', load: true, count: 20, offset: 0 }); })
      .then(function (head) {
        var items = head.items || [];
        var category = null;
        for (var i = 0; i < items.length; i += 1) if (items[i].title === want) category = items[i];
        if (category === null) throw new Error('not in Roon');
        return ask({ hierarchy: 'search', itemKey: category.itemKey })
          .then(function () { return ask({ hierarchy: 'search', load: true, count: 40, offset: 0 }); });
      })
      .then(function (page) {
        var items = page.items || [];
        var artistKey = keyOf(row.artist || '').split(' ')[0];
        var pick = null;
        for (var i = 0; i < items.length; i += 1) {
          if (keyOf(items[i].title) !== wantKey) continue;
          if (row.kind !== 'artists' && artistKey !== '' && items[i].subtitle && keyOf(items[i].subtitle).indexOf(artistKey) === -1) continue;
          pick = items[i];
          break;
        }
        if (pick === null && items.length > 0) pick = items[0];
        if (pick === null) throw new Error('not in Roon');
        return ask({ hierarchy: 'search', itemKey: pick.itemKey });
      })
      .then(function (result) {
        busy = false;
        if (!current(mine)) return;
        if (result.isError === true) { flash(result.message || 'could not open that'); draw(); return; }
        return present(result, from.depth + 1, mine, 'search').then(function () {
          if (!current(mine)) return;
          view.parent = from;
          view.roonLevel = false;
          // Roon's search nests a track (and an album) one level deep: a level
          // holding just the row itself. Pass straight through to its actions
          // — a list or an action LIST opens; a bare action would play, and
          // is never taken here.
          var only = view.total === 1 && view.items.length === 1 ? view.items[0] : null;
          if (only === null || keyOf(only.title) !== wantKey || (only.hint !== 'list' && only.hint !== 'action_list')) return;
          busy = true;
          return ask({ hierarchy: 'search', itemKey: only.itemKey })
            .then(function (inner) {
              busy = false;
              if (!current(mine)) return;
              if (inner.isError === true) return;
              return present(inner, from.depth + 1, mine, 'search').then(function () {
                // Hung straight under the ledger ring: ‹ never shows the one-row shell.
                if (current(mine)) { view.parent = from; view.roonLevel = false; }
              });
            });
        });
      })
      .catch(function (error) {
        busy = false;
        if (!current(mine)) return;
        draw();
        flash(String(error.message || error).slice(0, 80));
      });
  }

  /* ---------- rooms: the other rooms, pull from · shift to ---------- */

  /** This puck's own zone, as the house last reported it. */
  function hereZone() {
    var mine = zoneId();
    var all = zones();
    for (var i = 0; i < all.length; i += 1) if (all[i].id === mine) return all[i];
    return null;
  }

  /** The other rooms as rows: the playing ones first, then by name. */
  function roomRows() {
    var mine = zoneId();
    var all = zones();
    var rows = [];
    for (var i = 0; i < all.length; i += 1) {
      var zone = all[i];
      if (zone.id === mine || !zone.outputs || zone.outputs.length === 0) continue;
      // LIVE has something to pull — a paused queue is still a queue (the
      // deck's own rule); PLAYING is what earns the white rim and the front.
      var live = zone.nowPlaying !== null && zone.nowPlaying !== undefined;
      var playing = live && zone.state === 'playing';
      var what = live ? zone.nowPlaying.title + (zone.nowPlaying.line2 ? ' · ' + zone.nowPlaying.line2 : '') : '';
      rows.push({
        title: zone.name, zoneId: zone.id, outputId: zone.outputs[0].id, hint: 'room',
        subtitle: !live ? 'quiet' : (playing ? what : 'paused · ' + what),
        live: live, playing: playing,
      });
    }
    rows.sort(function (a, b) {
      if (a.playing !== b.playing) return a.playing ? -1 : 1;
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
    });
    return rows;
  }

  /** What the ring shows, as one string, so a snapshot that changes none of it redraws nothing. */
  function roomsKey(rows) {
    var parts = [];
    for (var i = 0; i < rows.length; i += 1) parts.push(rows[i].zoneId + ':' + rows[i].title + ':' + rows[i].subtitle);
    return parts.join('|');
  }

  function openRooms() {
    var rows = roomRows();
    epoch += 1;
    view = {
      hierarchy: 'rooms', tier: 'rooms', title: 'Rooms', total: rows.length,
      items: rows, base: 0, sel: 0, depth: 0, letter: null, paging: false,
      letters: null, probes: {}, plain: true, rooms: true, key: roomsKey(rows),
    };
    draw();
    onChange(true);
  }

  /** The house moved — a room started, stopped or was grouped: redraw in place, keeping the chosen room. */
  function refreshRooms() {
    if (view === null || !view.rooms) return;
    var rows = roomRows();
    var key = roomsKey(rows);
    if (key === view.key) return;
    var held = view.items[view.sel] ? view.items[view.sel].zoneId : null;
    view.items = rows;
    view.total = rows.length;
    view.key = key;
    view.sel = 0;
    for (var i = 0; i < rows.length; i += 1) if (rows[i].zoneId === held) { view.sel = i; break; }
    draw();
  }

  function drawRooms() {
    var n = view.total;
    var size = tokenSize(n);
    named = false;
    for (var k = 0; k < n; k += 1) {
      var item = view.items[k];
      var angle = (k / n) * 2 * Math.PI - Math.PI / 2;
      var node = el('div', (k === view.sel ? 'opt opt-on' : 'opt') + (item.playing ? ' opt-now' : ''));
      var mine = k === view.sel ? size * 1.3 : size;
      node.appendChild(titledToken(item.title, size, mine));
      place(node, 50 + OPT_R * Math.cos(angle), 50 + OPT_R * Math.sin(angle));
      bindChoose(node, k);
      optWrap.appendChild(node);
    }
    var pick = itemAt(view.sel);
    var here = hereZone();
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    chosenTitle.textContent = pick !== null ? pick.title : 'No other rooms';
    chosenSub.textContent = pick === null ? '' : pick.subtitle;
    chosen.setAttribute('title', pick === null ? '' : 'control ' + pick.title + ' with this puck');
    // PULL needs that room playing; SHIFT needs this one playing.
    pullKey.setAttribute('data-off', pick !== null && pick.live ? '0' : '1');
    shiftKey.setAttribute('data-off', pick !== null && here !== null && here.nowPlaying ? '0' : '1');
    root.setAttribute('data-named', '0');
    linsub.textContent = '';
    count.textContent = '';
  }

  /** Bring what the chosen room plays here — FlightDeck's pull, fenced by the snapshot it was chosen from. */
  function pullFrom() {
    var room = itemAt(view.sel);
    var output = outputId();
    var fenced = fence();
    if (room === null || output === null || fenced === null) { flash('no room to pull into'); return; }
    if (!room.live) { flash(room.title + ' is quiet'); return; }
    var mine = epoch;
    busy = true;
    tick();
    act({ action: 'pull', from: room.zoneId, output: output, generation: fenced.generation, revision: fenced.revision })
      .then(function (ok) {
        busy = false;
        if (!current(mine)) return;
        if (ok) { flash('pulling from ' + room.title); close(); }
      });
  }

  /** Send what plays here to the chosen room — FlightDeck's transfer, to that room's durable output. */
  function shiftTo() {
    var room = itemAt(view.sel);
    var here = hereZone();
    if (room === null || here === null) return;
    if (!here.nowPlaying) { flash('nothing playing here to shift'); return; }
    var mine = epoch;
    busy = true;
    tick();
    act({ action: 'transfer', zone: here.id, output: room.outputId })
      .then(function (ok) {
        busy = false;
        if (!current(mine)) return;
        if (ok) { flash('shifted to ' + room.title); close(); }
      });
  }

  /* ---------- the queue: a ring of circles, the title in each ---------- */

  /** A circle carrying a title, set at the RING's type size whatever the circle's own. */
  function titledToken(title, size, mine) {
    var mark = el('div', 'tok tok-titled');
    mark.appendChild(el('div', 'tok-title', title));
    sizeToken(mark, mine);
    // sizeToken's type is sized for an initial; a title is set much smaller —
    // and at the ring's size in every circle, so the chosen one, a third
    // larger, gains room for its words rather than larger words (measured:
    // scaled with the circle, "I Miss You" ran to its rim).
    mark.style.fontSize = 'calc(var(--u) * ' + String(size * 0.18) + ')';
    return mark;
  }

  /**
   * ⚖️ THE QUEUE IS CIRCLES, THE TITLE IN EACH (Peter, 09-04: "circles for each
   * track distributed as with the other menus, the title in each circle" — the
   * spokes tried before it were "not so good with just a few items"). Up to
   * twelve ring the face at once, evenly spread; a longer queue is pages of
   * twelve, each page spread round the whole face. The circle carries the
   * TITLE, not the sleeve — one album's tracks all wear the same sleeve, which
   * told nobody anything — white-rimmed for the playing row, the accent for
   * the chosen. The hub is ▶ over the chosen title and its place in the queue,
   * and it is the one place that plays; a tap on a circle chooses.
   */
  var QUEUE_PAGE = 12;

  function drawQueueRing() {
    var n = view.total;
    var first = Math.floor(view.sel / QUEUE_PAGE) * QUEUE_PAGE;
    var m = Math.max(0, Math.min(QUEUE_PAGE, n - first));
    var size = tokenSize(m);
    named = false;
    for (var k = 0; k < m; k += 1) {
      var index = first + k;
      var item = view.items[index];
      var angle = (k / m) * 2 * Math.PI - Math.PI / 2;   // twelve o'clock, clockwise: the playing row first
      var node = el('div', (index === view.sel ? 'opt opt-on' : 'opt') + (item.now === true ? ' opt-now' : ''));
      var mine = index === view.sel ? size * 1.3 : size;
      node.appendChild(titledToken(item.title, size, mine));
      place(node, 50 + OPT_R * Math.cos(angle), 50 + OPT_R * Math.sin(angle));
      bindChoose(node, index);
      optWrap.appendChild(node);
    }
    var pick = itemAt(view.sel);
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    chosenTitle.textContent = pick !== null ? pick.title : 'Nothing queued';
    chosenSub.textContent = pick === null ? '' : queueSub(pick);
    root.setAttribute('data-named', '0');
    linsub.textContent = '';
    count.textContent = '';
  }

  /**
   * A tap on a queue circle CHOOSES it; only the hub plays (Peter, 09-04: "play
   * being the hub"). In the library one tap on a circle goes, but a queue row
   * changes what the room is playing, so the choice and the act are two
   * touches, the second on the one place that says ▶.
   */
  function bindChoose(node, index) {
    node.addEventListener('click', function (event) {
      event.stopPropagation();
      if (view === null || view.sel === index) return;
      view.sel = index;
      tick();
      draw();
    });
    node.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    node.addEventListener('pointerup', function (event) { event.stopPropagation(); });
  }

  /**
   * ⚖️ A CHOICE IS A TOKEN IN A CIRCLE (Peter, 09-03). `My Live Radio` will never
   * fit inside a thumb-wide disc, so the circle carries an ICON where one is
   * obvious, the row's own SLEEVE where it has one, and its initial otherwise —
   * and the full name is read large in the middle. Navigate by the ring, read by
   * the centre, which is the rule this face was built on.
   */
  /** A genre level: Roon's own Genres hierarchy, or any level whose title says so. */
  function onGenreLevel() {
    return view !== null && (view.hierarchy === 'genres' || /genre/i.test(view.title || '')
      || (view.parentTitle !== undefined && /genre/i.test(view.parentTitle)));
  }

  /** Playlists have no sleeve of their own; their tracks do. */
  var collages = createCollages(ask, { size: 96, want: 4 });

  function onPlaylistsLevel() {
    return view !== null && (view.hierarchy === 'playlists' || /playlist/i.test(view.title || ''));
  }

  function token(item, text) {
    var node = el('div', 'tok');
    /**
     * ⚖️ A PLAYLIST'S CIRCLE IS A COLLAGE OF ITS COVERS (Peter, 09-04). The
     * initial stands in while it is built; the sleeves replace it when they
     * arrive, and only if this circle is still the one on the face. The
     * collage comes BEFORE the shelf icons: a playlist called "dCS Favourites"
     * is a playlist, not the Favorites shelf, and wore a heart until it did.
     */
    var playlist = item !== null && !item.art && onPlaylistsLevel() && item.hint !== 'action' && item.hint !== 'action_list';
    // A plain level (the queue) is tracks: a track called "Radio Song" is not a radio.
    var name = item === null || playlist || view.plain === true ? null : iconNameFor(item.title, item.hint, onGenreLevel());
    if (playlist) {
      var ready = collages.known(item.title);
      if (typeof ready === 'string') {
        var art = document.createElement('img');
        art.className = 'tok-art';
        art.alt = '';
        art.src = ready;
        node.appendChild(art);
        return node;
      }
      // Always Roon's own `playlists` hierarchy, whichever way this level was
      // reached: via Explore it lives in `browse`, whose root has no playlists.
      collages.request('playlists', item.title, function (url) {
        if (url === null || node.parentNode === null) return;
        var late = document.createElement('img');
        late.className = 'tok-art';
        late.alt = '';
        late.src = url;
        while (node.firstChild) node.removeChild(node.firstChild);
        node.appendChild(late);
      });
    }
    if (name !== null) {
      node.appendChild(glyph(name));
      return node;
    }
    if (item !== null && item.art) {
      var art = document.createElement('img');
      art.className = 'tok-art';
      art.alt = '';
      art.src = item.art;
      node.appendChild(art);
      return node;
    }
    node.appendChild(el('span', 'tok-text', text));
    return node;
  }

  /** Symbol stops are drawn as the plain word their symbol stands for. */

  /** How wide a token may be before its neighbours touch it, in glass units. */
  function tokenSize(n) {
    var gap = (2 * Math.PI * OPT_R) / Math.max(1, n);
    return Math.max(5, Math.min(14, gap * 0.74));
  }

  /**
   * Sized in `--u`, never in percent: `.opt` is a zero-size ANCHOR so the token
   * can hang off it symmetrically, and a percentage against a zero box is zero.
   * The chosen one grows rather than scaling — a transform anywhere inside the
   * glass is the one thing this face does not do.
   */
  function sizeToken(node, units) {
    node.style.width = 'calc(var(--u) * ' + String(units) + ')';
    node.style.height = 'calc(var(--u) * ' + String(units) + ')';
    node.style.marginLeft = 'calc(var(--u) * ' + String(-units / 2) + ')';
    node.style.marginTop = 'calc(var(--u) * ' + String(-units / 2) + ')';
    node.style.fontSize = 'calc(var(--u) * ' + String(units * 0.5) + ')';
  }

  var named = false;   // whether the ring on the face carries labels

  function drawRing() {
    var n = view.tier === 'alpha' ? view.letters.length : view.items.length;
    var size = tokenSize(n);
    // Up to seven choices there is room to name each one under its circle; past
    // that the labels collide, and the centre is where the name is read anyway.
    named = n <= 7;
    for (var i = 0; i < n; i += 1) {
      var angle = (i / n) * 2 * Math.PI - Math.PI / 2;   // twelve o'clock, clockwise
      var node = el('div', i === view.sel ? 'opt opt-on' : 'opt');
      var item = view.tier === 'alpha' ? null : itemAt(i);
      var mark = view.tier === 'alpha'
        ? token(null, view.letters[i])
        : token(item, label(i).charAt(0).toUpperCase());
      var mine = i === view.sel ? size * 1.3 : size;
      sizeToken(mark, mine);
      node.appendChild(mark);
      if (named && view.tier !== 'alpha') {
        var name = el('div', 'opt-name', nameOf(itemAt(i)));
        /**
         * The label sits OUTSIDE the ring on the top half and INSIDE it on the
         * bottom half. Hung below the token everywhere, the six o'clock choices
         * ran off the bottom of the glass and into the count line — a circle has
         * no room at its foot, so the label goes wherever there is any.
         */
        var below = Math.sin(angle) <= 1e-9;   // sin(π) is +1e-16: nine o'clock must side with three
        name.style.marginTop = below
          ? 'calc(var(--u) * ' + String(mine / 2 + 1.4) + ')'
          : 'calc(var(--u) * ' + String(-(mine / 2 + 5.1)) + ')';
        node.appendChild(name);
      }
      place(node, 50 + OPT_R * Math.cos(angle), 50 + OPT_R * Math.sin(angle));
      bindPick(node, i);
      optWrap.appendChild(node);
    }
    var pick = view.tier === 'alpha' ? null : itemAt(view.sel);
    if (view.spell) {
      // The middle is the query so far; the ring is the keyboard.
      chosenTitle.textContent = view.spell.query === '' ? view.spell.prompt : view.spell.query;
      chosenSub.textContent = view.spell.query === '' ? 'turn to a letter, tap to add it' : view.letters[view.sel];
    } else {
      chosenTitle.textContent = view.tier === 'alpha' ? view.letters[view.sel]
        : (pick !== null ? pick.title : (view.queue ? 'Nothing queued' : ''));
      chosenSub.textContent = pick !== null && pick.subtitle ? pick.subtitle : '';
    }
    // The chosen row's sleeve is already on the ring, in its own circle; drawing
    // it again in the middle put Eric Clapton on the face twice and his second
    // portrait across the name. The centre reads the NAME; the ring shows the art.
    chosenArt.removeAttribute('src');
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    root.setAttribute('data-named', named && view.tier !== 'alpha' ? '1' : '0');
    linsub.textContent = '';
    if (view.spell) count.textContent = '';
    else if (view.tier === 'alpha') count.textContent = String(view.total) + ' — pick a letter';
    else count.textContent = String(view.sel + 1) + ' / ' + String(view.total);
  }

  /**
   * ⚖️ THE HIGHLIGHT WALKS THE RING; A FULL CIRCLE TURNS THE PAGE (Peter, 09-03:
   * "a turn of the wheel advances around the selection, 360 brings up the
   * next"). The middle tier and the list under a letter are PAGES of up to
   * twelve circles that stay put, exactly like the small ring; the wheel moves
   * the highlight round them, and stepping past the last brings up the next
   * twelve with the highlight back at twelve o'clock. The centre reads the
   * name; the count says where in the whole list this is.
   */
  /* Seven a page, not twelve: with a name under every circle, seven is what a
     ring has room for (Peter, 09-03: "icon with name underneath would be good").
     Eight puts circles at exactly three and nine o'clock, whose names land on
     the half-past-seven and half-past-four ones — measured, not guessed. */

  function drawPaged() {
    var first = Math.floor(view.sel / SLOTS) * SLOTS;
    var n = Math.max(1, Math.min(SLOTS, view.total - first));
    // With the alphabet round the outside, the ring pulls in and its circles
    // and names shrink, so the letters keep an orbit of their own (measured:
    // at 33 the names reached the letters and the chosen circle touched them).
    var lettered = view.letters !== null && view.letter !== null;
    var radius = lettered ? 29 : OPT_R;
    var size = lettered ? 12 : tokenSize(SLOTS);
    named = true;
    for (var k = 0; k < n; k += 1) {
      var index = first + k;
      var item = itemAt(index);
      // The seven SLOTS, whatever the page holds: a last page of four spread
      // round the whole face put a circle at six o'clock, on the count
      // (measured, the queue's second page) — and made every page a new shape.
      var angle = (k / SLOTS) * 2 * Math.PI - Math.PI / 2;
      var node = el('div', index === view.sel ? 'opt opt-on' : 'opt');
      var mark = token(item, item === null ? '\u2026' : item.title.charAt(0).toUpperCase());
      var mine = index === view.sel ? size * 1.3 : size;
      sizeToken(mark, mine);
      node.appendChild(mark);
      var name = el('div', 'opt-name', item === null ? '\u2026' : nameOf(item));
      var below = Math.sin(angle) <= 1e-9;   // sin(π) is +1e-16: nine o'clock must side with three
      name.style.marginTop = below
        ? 'calc(var(--u) * ' + String(mine / 2 + 1.2) + ')'
        : 'calc(var(--u) * ' + String(-(mine / 2 + (lettered ? 4.4 : 5.1))) + ')';
      node.appendChild(name);
      place(node, 50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle));
      bindPick(node, index);
      optWrap.appendChild(node);
    }
    var pick = itemAt(view.sel);
    // Walking ‹ › across a letter boundary moves the outer highlight with it.
    if (view.letters !== null && pick !== null) view.letter = letterOf(pick.title);
    // What is spelt stays only while the highlight is still under it.
    if (view.spelt && pick !== null && prefixCompare(pick.title, view.spelt.prefix) !== 0) view.spelt = null;
    if (view.letters !== null && view.letter !== null) {
      drawAlphabetOutside();
      root.setAttribute('data-lettered', '1');
    } else {
      root.removeAttribute('data-lettered');
    }
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    chosenTitle.textContent = pick === null ? '\u2026' : pick.title;
    chosenSub.textContent = pick !== null && pick.subtitle ? pick.subtitle : '';
    linsub.textContent = '';
    root.setAttribute('data-named', '1');
    count.textContent = String(view.sel + 1) + ' / ' + String(view.total)
      + (view.letter === null ? '' : '  \u00b7  ' + (view.spelt ? view.spelt.prefix : view.letter));
  }

  /**
   * The alphabet, small, just inside the glass's edge: the wheel's own scale
   * here. It leaves a GAP at the top for the level's title — a first cut put
   * "#" at twelve o'clock, on the title, and a tap meant as up became a jump.
   */
  var LETTER_R = 44;
  var LETTER_GAP = 44 * Math.PI / 180;   // ±22° free at twelve

  function drawAlphabetOutside() {
    var letters = view.letters;
    var span = 2 * Math.PI - 2 * LETTER_GAP;
    for (var i = 0; i < letters.length; i += 1) {
      var angle = -Math.PI / 2 + LETTER_GAP + (i / (letters.length - 1)) * span;
      var node = el('div', letters[i] === view.letter ? 'lt lt-on' : 'lt', letters[i]);
      place(node, 50 + LETTER_R * Math.cos(angle), 50 + LETTER_R * Math.sin(angle));
      (function (letter) {
        node.addEventListener('click', function (event) { event.stopPropagation(); jumpWithin(letter); });
        node.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
        node.addEventListener('pointerup', function (event) { event.stopPropagation(); });
      }(letters[i]));
      optWrap.appendChild(node);
    }
  }

  function bindPick(node, index) {
    node.addEventListener('click', function (event) {
      event.stopPropagation();
      if (view === null) return;
      /**
       * ⚖️ ONE TAP ON A CIRCLE GOES (Peter, 09-03: "clicking on a selection
       * should bring up the next browse for that — Genres, then Jazz,
       * Classical…"). A first cut made the first tap only highlight and the
       * second commit; that is the wheel's job now — turn to highlight, then
       * the centre or the highlighted circle commits — and a finger on a
       * circle means that circle.
       */
      if (view.sel !== index) { view.sel = index; draw(); }
      commit();
    });
    /**
     * ⚠️ And the tap must not ALSO reach the glass. A circle stopped its click
     * from bubbling but not its pointerup, so the glass read every tap on a
     * circle as a centre tap and committed the HIGHLIGHTED item first — a tap
     * on Genres opened Library. Found by a probe that clicked a circle for real.
     */
    node.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    node.addEventListener('pointerup', function (event) { event.stopPropagation(); });
  }

  /* ---------- moving ---------- */

  function move(step) {
    if (view === null || busy) return;
    var n = view.tier === 'alpha' ? view.letters.length : view.total;
    if (n === 0) return;
    if (view.tier === 'linear') {
      var next = view.sel + step;
      // A library has ends; a ring does not.
      if (next < 0 || next >= n) return;
      // In RANDOM, stepping off the page deals another random page.
      var base = modeBase(view);
      if (base !== null && base.mode === 'random' && Math.floor(next / SLOTS) !== Math.floor(view.sel / SLOTS)) { randomPage(); return; }
      view.sel = next;
      fill();
      fillBack();
    } else {
      view.sel = ((view.sel + step) % n + n) % n;
    }
    tick();
    draw();
  }

  /** Keep the loaded window ahead of the thumb. */
  function fill() {
    if (view === null || view.tier !== 'linear' || view.paging) return;
    var have = view.base + view.items.length;
    // Keep a whole page in hand past the highlight, so the next twelve are
    // drawn the moment the wheel steps onto them.
    if (view.sel + SLOTS < have || have >= view.total) return;
    var mine = epoch;
    view.paging = true;
    ask({ hierarchy: view.hierarchy, load: true, count: PAGE, offset: have })
      .then(function (data) {
        if (!current(mine)) return;
        view.paging = false;
        var items = data.items || [];
        for (var i = 0; i < items.length; i += 1) view.items.push(items[i]);
        // A short page means the list is exhausted whatever the count claimed.
        if (items.length === 0) view.total = view.base + view.items.length;
        draw();
      })
      .catch(function () { if (current(mine)) view.paging = false; });
  }

  /** And behind it: ‹ from the first loaded row loads the page before. */
  function fillBack() {
    if (view === null || view.tier !== 'linear' || view.paging || view.base === 0) return;
    if (view.sel > view.base + 1) return;
    var mine = epoch;
    var page = view;
    var from = Math.max(0, page.base - PAGE);
    page.paging = true;
    ask({ hierarchy: page.hierarchy, load: true, count: page.base - from, offset: from })
      .then(function (data) {
        if (!current(mine) || view !== page) return;
        page.paging = false;
        var items = data.items || [];
        page.items = items.concat(page.items);
        page.base = from;
        draw();
      })
      .catch(function () { if (current(mine)) page.paging = false; });
  }

  /* ---------- opening a level ---------- */

  /**
   * Is a level too big to read whole nonetheless in order? Sample it — the first
   * page is already in hand, so this costs the quarter points and the last row.
   * Non-decreasing buckets is exactly the property a bisection rests on, so
   * proving it here is what makes the jump behind the ring sound.
   *
   * Returns the ring's stops, or null for "no index; spin the column". `#`
   * appears only when the library actually has titles that sort ahead of A —
   * offering a stop that leads nowhere is the fault this whole check exists for.
   */
  function ringFor(hierarchy, total, first, mine, probes) {
    if (first.length === 0) return Promise.resolve(null);
    /**
     * ⚠️ The sampled TITLES are kept, never their letters. Handing buckets to
     * `isAlphabetical` runs them through `letterOf` a second time, and `~`
     * (0x7E, an ASCII character) folds straight back to `#` — which read every
     * library whose last row is Japanese as unordered and cost it the ring.
     */
    var seen = [{ title: first[0].title }];
    var offsets = sampleOffsets(total);
    var next = function (at) {
      if (at >= offsets.length) {
        if (!isAlphabetical(seen)) return null;
        return (letterOf(seen[0].title) === '#' ? ['#'] : []).concat(ALPHABET);
      }
      return probe(hierarchy, offsets[at], probes).then(function (title) {
        if (!current(mine)) return null;
        if (title === null) return null;
        seen.push({ title: title });
        return next(at + 1);
      });
    };
    return Promise.resolve(next(0));
  }

  function present(head, depth, mine, hierarchy) {
    var list = head.list;
    if (list === null || list === undefined) throw new Error('that level has no list');
    var total = list.count;
    var wanted = tierFor(total);
    var parentTitle = view !== null ? view.title : undefined;
    view = {
      hierarchy: hierarchy, tier: wanted === 'alpha' ? 'linear' : wanted,
      title: list.title || 'Browse', total: total, parentTitle: parentTitle,
      items: [], base: 0, sel: 0, depth: depth, letter: null, paging: false,
      letters: null, probes: {}, spelt: null,
      kind: levelKind(list.title), mode: 'az',
    };
    // The two small tiers are read WHOLE; a big one takes a page and is sampled.
    var take = wanted === 'radial' ? RADIAL_MAX : (wanted === 'linear' ? WHOLE_MAX : PAGE);
    return ask({ hierarchy: hierarchy, load: true, count: take, offset: 0 })
      .then(function (page) {
        if (!current(mine)) return null;
        view.items = page.items || [];
        // A short page means the level is smaller than it claimed, whatever the
        // count said — and for a level read whole that IS the real total.
        if (wanted !== 'alpha' && view.items.length < view.total) view.total = view.items.length;
        if (wanted !== 'alpha') return null;
        view.probes[0] = view.items.length > 0 ? view.items[0].title : null;
        return ringFor(hierarchy, view.total, view.items, mine, view.probes);
      })
      .then(function (letters) {
        if (!current(mine)) return;
        if (letters !== null && letters !== undefined) {
          view.tier = 'alpha';
          view.letters = letters;
          view.sel = 0;
        }
        draw();
        onChange(true);
      });
  }

  function open(hierarchy) {
    if (busy) return;
    if (hierarchy === 'queue') { if (view !== null && view.queue) return; park(); openQueue(); return; }
    if (hierarchy === 'rooms') { if (view !== null && view.rooms) return; park(); openRooms(); return; }
    /**
     * ⚖️ THE LIBRARY KEEPS ITS PLACE ACROSS THE AXIS. A swipe from three levels
     * down in Genres to the queue and back should land on those three levels,
     * not on Explore: the Core's stack for this session is still exactly
     * there, so the view was set aside, not thrown away. Only closing forgets.
     */
    if (hierarchy === 'browse' && parked !== null) {
      if (view !== null && !view.queue) return;
      epoch += 1;
      view = parked.view;
      spellReturn = parked.spellReturn;
      parked = null;
      draw();
      onChange(true);
      return;
    }
    busy = true;
    epoch += 1;
    var mine = epoch;
    view = null;
    ask({ hierarchy: hierarchy, popAll: true })
      .then(function (head) {
        if (mine !== epoch) return;
        return present(head, 0, mine, hierarchy);
      })
      .then(function () { busy = false; })
      .catch(function (error) {
        busy = false;
        if (mine !== epoch) return;
        view = null;
        onChange(false);
        flash(String(error.message || error).slice(0, 80));
      });
  }

  /** Off the face, whatever was on it. */
  function leave() {
    epoch += 1;
    view = null;
    spellReturn = null;
    busy = false;
    root.removeAttribute('data-browse');
    root.removeAttribute('data-tier');
    root.removeAttribute('data-spell');
    root.removeAttribute('data-lettered');
    root.removeAttribute('data-mode');
    onChange(false);
  }

  /** Done with it: a choice was played, or the title was climbed out of the top. */
  function close() {
    parked = null;
    leave();
  }

  /** The axis leaving a library level: set it aside to come back to. The queue is never kept. */
  function park() {
    if (view !== null && !view.queue && !view.rooms) parked = { view: view, spellReturn: spellReturn };
    leave();
  }

  /* ---------- ↓ commit ---------- */

  function commit() {
    if (view === null || busy) return;
    // The ring's stops, not the bare alphabet: `#` is prepended when the library
    // has titles that sort ahead of A, and every index after it shifts with it.
    if (view.spell) { spellStop(view.letters[view.sel]); return; }
    if (view.tier === 'alpha') { jump(view.letters[view.sel]); return; }
    var item = itemAt(view.sel);
    if (item === null) return;
    // The rooms' hub is the ZONE PICKER (Peter, 09-05): a tap on it makes this
    // puck that room's. Pull and shift are the two keys under it.
    if (view.rooms) { onSwitch(item); return; }
    if (view.local) { hop(item); return; }
    if (view.queue) { playFrom(item); return; }
    if (item.input !== null && item.input !== undefined) { spell(item); return; }
    var mine = epoch;
    var hierarchy = view.hierarchy;
    var depth = view.depth;
    busy = true;
    tick();
    ask({ hierarchy: hierarchy, itemKey: item.itemKey })
      .then(function (result) {
        busy = false;
        if (!current(mine)) return;
        if (selectionComplete(item, result)) {
          flash(result.message || (item.title + ' ✓'));
          close();
          return;
        }
        if (result.isError === true) { flash(result.message || 'could not open that'); return; }
        var from = view;
        return present(result, depth + 1, mine, hierarchy).then(function () {
          // The child remembers the view it came from, AS IT WAS — page, place
          // and all — so ↑ lands back on it rather than on a fresh copy.
          if (current(mine)) { view.parent = from; view.roonLevel = true; }
        });
      })
      .catch(function (error) {
        busy = false;
        if (!current(mine)) return;
        flash(String(error.message || error).slice(0, 80));
      });
  }

  /* ---------- ↑ climb ---------- */

  function back() {
    if (view === null || busy) return;
    // ↑ from the speller is the row it came from; ↑ from the first page of
    // results is the speller again, with the query still there to be edited.
    if (view.spell) { view = view.spell.parent; tick(); draw(); return; }
    if (spellReturn !== null && view.hierarchy === 'search' && view.depth === spellReturn.depth) {
      view = spellReturn.speller;
      spellReturn = null;
      tick();
      draw();
      return;
    }
    // A letter jump is not a Roon level: climb back to the alphabet without
    // popping the Core's stack, or the list under the letter would be lost too.
    /**
     * ⚖️ UP CLIMBS ONE LEVEL, TO THE VIEW AS IT WAS (Peter, 09-03: "x → artists →
     * genres … forward and back in the A's, and an up to return to Artists").
     * A first cut re-presented the parent fresh, so ↑ from an artist reached by
     * "M" landed on the alphabet at "#". Now each view keeps the one it came
     * from — page, place and highlight — and ↑ restores it. Roon's own stack is
     * popped only when the child was a Roon level; a letter's page is not.
     */
    if (view.parent !== undefined && view.parent !== null) {
      var parent = view.parent;
      if (view.roonLevel !== true) { view = parent; tick(); draw(); return; }
      var mine = epoch;
      busy = true;
      ask({ hierarchy: view.hierarchy, popLevels: 1 })
        .then(function () {
          busy = false;
          if (!current(mine)) return;
          view = parent;
          tick();
          draw();
        })
        .catch(function () { busy = false; if (current(mine)) close(); });
      return;
    }
    // The queue's or the rooms' title leaves it; it must not forget the library parked behind it.
    if (view.queue || view.rooms) park(); else close();
  }

  /* ---------- the speller: Search, spelt on the ring ---------- */

  function spell(item, kind) {
    var parent = view;
    view = {
      hierarchy: parent.hierarchy, tier: 'alpha', title: item.title || 'Search', total: 0,
      items: [], base: 0, sel: 0, depth: parent.depth, letter: null, paging: false,
      letters: ALPHABET, probes: {},
      // `kind` (tracks · albums · artists) when the speller was opened from a
      // list's label: the results then open straight into that category — and
      // the speller then sits in that list's territory, so its label says so.
      spell: { query: '', prompt: (item.input && item.input.prompt) || 'Search', parent: parent, kind: kind || null },
      parent: parent,
    };
    tick();
    draw();
  }

  function spellStop(stop) {
    var q = view.spell.query;
    if (stop === GO) { search(); return; }
    if (stop === DELETE) { if (q === '') return; view.spell.query = q.slice(0, -1); }
    else if (stop === SPACE) { if (q !== '' && q.charAt(q.length - 1) !== ' ') view.spell.query = q + ' '; }
    else view.spell.query = q + stop;
    tick();
    draw();
  }

  /**
   * Roon's Search is its own hierarchy with its own stack, exactly as the Face
   * asks it (face.js searchQuery): pop it, hand it the words, present the
   * categories it answers with. The speller is kept so ↑ returns to the query.
   */
  function search() {
    var query = view.spell.query.replace(/^\s+|\s+$/g, '');
    if (query === '') { flash('spell something first'); return; }
    var speller = view;
    var mine = epoch;
    busy = true;
    levelName.textContent = 'searching\u2026';
    ask({ hierarchy: 'search', popAll: true, input: query })
      .then(function (result) {
        busy = false;
        if (!current(mine)) return;
        if (result.isError === true) { flash(result.message || 'nothing found'); draw(); return; }
        spellReturn = { speller: speller, depth: speller.depth + 1 };
        return present(result, speller.depth + 1, mine, 'search').then(function () {
          if (!current(mine) || !speller.spell.kind) return;
          // Opened from a list's label: straight into that list's category.
          var want = { tracks: 'Tracks', albums: 'Albums', artists: 'Artists' }[speller.spell.kind];
          var category = null;
          for (var i = 0; i < view.items.length; i += 1) if (view.items[i].title === want) category = view.items[i];
          if (category === null) { flash('no ' + want.toLowerCase() + ' for that'); return; }
          var results = view;
          busy = true;
          return ask({ hierarchy: 'search', itemKey: category.itemKey })
            .then(function (inner) {
              busy = false;
              if (!current(mine)) return;
              if (inner.isError === true) return;
              return present(inner, results.depth + 1, mine, 'search').then(function () {
                if (current(mine)) { view.parent = results; view.roonLevel = true; }
              });
            });
        });
      })
      .catch(function (error) {
        busy = false;
        if (!current(mine)) return;
        draw();
        flash(String(error.message || error).slice(0, 80));
      });
  }

  /* ---------- the alphabet jump ---------- */

  /** One row, remembered: picking B then C re-asks many of the same offsets. */
  function probe(hierarchy, offset, probes) {
    if (probes !== undefined && probes !== null
        && Object.prototype.hasOwnProperty.call(probes, offset)) {
      return Promise.resolve(probes[offset]);
    }
    return ask({ hierarchy: hierarchy, load: true, count: 1, offset: offset })
      .then(function (data) {
        var items = data.items || [];
        var title = items.length > 0 ? items[0].title : null;
        if (probes !== undefined && probes !== null) probes[offset] = title;
        return title;
      });
  }

  /**
   * The offset of the first row at or after `letter`, by bisection — eleven
   * one-row reads into two thousand albums rather than twelve full pages.
   *
   * ⚖️ It is sound ONLY because `ringFor` established the order before the ring
   * was ever drawn. On an unordered level this returns nonsense confidently,
   * which is exactly what it did to Genres on 09-03.
   */
  function findLetter(hierarchy, prefix, total, mine, probes, done) {
    var low = 0;
    var high = Math.max(0, total - 1);
    var best = null;
    var steps = 0;
    var step = function () {
      if (!current(mine)) return;
      if (low > high || steps > 16) { done(best); return; }
      steps += 1;
      var mid = Math.floor((low + high) / 2);
      probe(hierarchy, mid, probes).then(function (title) {
        if (!current(mine)) return;
        if (title === null) { high = mid - 1; step(); return; }
        if (prefixCompare(title, prefix) >= 0) { best = mid; high = mid - 1; } else { low = mid + 1; }
        step();
      }).catch(function () { done(best); });
    };
    step();
  }

  function jump(letter) {
    if (view === null || busy) return;
    var alpha = view;
    var mine = epoch;
    var hierarchy = alpha.hierarchy;
    busy = true;
    levelName.textContent = 'finding ' + letter + '\u2026';
    findLetter(hierarchy, letter, alpha.total, mine, alpha.probes, function (offset) {
      if (!current(mine)) { busy = false; return; }
      /**
       * A ring stop that leads nowhere is the fault this whole design exists to
       * avoid. The bisection lands on the first row at or AFTER the letter, so
       * the row it found has to actually be under it — otherwise the library
       * simply has no Q, and saying so beats dropping the reader into R.
       */
      var landed = offset === null ? null : alpha.probes[offset];
      if (offset === null || landed === null || landed === undefined || letterOf(landed) !== letter) {
        busy = false;
        draw();
        flash('nothing under ' + letter);
        return;
      }
      landAt(alpha, offset, letter);
    });
  }

  /**
   * A page of the big list at `offset`, hung under its alphabet as a letter's
   * page is — the letter jump lands here, and so does RANDOM. Loaded from the
   * page's own start, so every circle on it is in hand at once.
   */
  function landAt(alpha, offset, letter) {
    var mine = epoch;
    var hierarchy = alpha.hierarchy;
    var from = Math.floor(offset / SLOTS) * SLOTS;
    busy = true;
    ask({ hierarchy: hierarchy, load: true, count: PAGE, offset: from })
      .then(function (data) {
        busy = false;
        if (!current(mine)) return;
        var items = data.items || [];
        var landed = items[offset - from] ? items[offset - from].title : null;
        view = {
          hierarchy: hierarchy, tier: 'linear', title: alpha.title, total: alpha.total,
          items: items, base: from, sel: offset, depth: alpha.depth,
          letter: letter !== undefined ? letter : (landed === null ? null : letterOf(landed)),
          paging: false, probes: alpha.probes,
          // the alphabet rides round the OUTSIDE of this page, for the wheel
          letters: alpha.letters, parent: alpha, roonLevel: false,
          spelt: letter !== undefined ? { prefix: letter, at: Date.now() } : null,   // the next tap may spell on from here
        };
        tick();
        draw();
      })
      .catch(function () { busy = false; if (current(mine)) draw(); });
  }

  /**
   * THE ALPHABET ROUND THE OUTSIDE; ‹ › WALK THE ARTISTS. On a letter's page a
   * tap on a letter moves to it in the same view; the parent stays the
   * alphabet. (The cog itself is the volume, in every state — Peter, 09-04.)
   *
   * ⚖️ TAPS SPELL (Peter, 09-04: "clicking a second or third letter should
   * spell out the search until located and selected"). A tap within a few
   * seconds of the last extends what is spelt — M, then MA, then MAR — and the
   * highlight jumps to the first title under it, by the same bisection that
   * found the letter, over the same cached probes. What is spelt is written
   * beside the count. A letter that spells nothing ("MARZ") starts over with
   * that letter alone, and so does a pause.
   */
  var SPELL_MS = 6000;   // taps this close together spell one name

  function jumpWithin(letter, done) {
    if (view === null || busy || view.letters === null) { if (done) done(false); return; }
    var page = view;
    var spelt = page.spelt;
    var extend = spelt !== null && spelt !== undefined && Date.now() - spelt.at <= SPELL_MS
      && /^[A-Z]/.test(spelt.prefix) && /^[A-Z]$/.test(letter);
    var wanted = extend ? spelt.prefix + letter : letter;
    seek(page, wanted, extend, function (found) {
      if (found || !extend) { if (done) done(found); return; }
      // Nothing spells that far: the tap meant a fresh letter.
      seek(page, letter, false, function (again) { if (done) done(again); });
    });
  }

  /**
   * Move a letter's page to the first title under `prefix`, if there is one.
   * A failed EXTENSION is quiet — the fresh letter that follows it says where
   * the page went — where a letter the library simply lacks is said out loud.
   */
  function seek(page, prefix, quiet, done) {
    var mine = epoch;
    busy = true;
    levelName.textContent = 'finding ' + prefix + '…';
    findLetter(page.hierarchy, prefix, page.total, mine, page.probes, function (offset) {
      if (!current(mine) || view !== page) { busy = false; done(false); return; }
      var landed = offset === null ? null : page.probes[offset];
      if (offset === null || landed === null || landed === undefined || prefixCompare(landed, prefix) !== 0) {
        busy = false;
        draw();
        if (!quiet) flash('nothing under ' + prefix);
        done(false);
        return;
      }
      var from = Math.floor(offset / SLOTS) * SLOTS;
      ask({ hierarchy: page.hierarchy, load: true, count: PAGE, offset: from })
        .then(function (data) {
          busy = false;
          if (!current(mine) || view !== page) { done(false); return; }
          page.items = data.items || [];
          page.base = from;
          page.sel = offset;
          page.letter = prefix.charAt(0);
          page.spelt = { prefix: prefix, at: Date.now() };
          tick();
          draw();
          done(true);
        })
        .catch(function () { busy = false; if (current(mine)) draw(); done(false); });
    });
  }

  /* The cog never moves the highlight (Peter, 09-04): letters are reached by a
     tap on the alphabet round the outside, the list by ‹ ›, swipes and taps. */

  return {
    open: open,
    close: close,
    park: park,
    back: back,
    commit: commit,
    move: move,
    reloadQueue: reloadQueue,
    refreshRooms: refreshRooms,
    isOpen: function () { return view !== null; },
    /** Which face is up: the music, the library, the queue, or the rooms (a side door off the music). */
    at: function () { return view === null ? 'play' : (view.queue ? 'queue' : (view.rooms ? 'rooms' : 'browse')); },
  };
}
