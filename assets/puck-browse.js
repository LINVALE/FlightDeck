/**
 * THE PUCK'S BROWSE — Roon's library, read around a clock face.
 *
 * ⚖️ THE TIER IS CHOSEN BEFORE THE ITEMS ARE LOADED. Roon reports `list.count`
 * with the level, so the dial knows how to present a list without fetching it
 * first. Measured on a real library: Explore 7, Genres 56, Albums 2295 — which
 * is exactly why all three tiers have to exist.
 *
 *   ≤ 12    RADIAL    the choices ring the face, all of them at once
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
 * ⚖️ ONE AXIS WITH THREE STOPS (09-02): ↓ always descends, ↑ always climbs, and
 * repeated ↑ walks home. `commit()` is ↓ and `back()` is ↑, whatever the tier —
 * the alphabet's letter jump is the one move that is NOT a Roon level, so it is
 * remembered separately and climbed back out of without popping the Core's stack.
 *
 * ⚠️ Its OWN session key. Roon keeps one browse stack per `multi_session_key`,
 * so a puck sharing the default would drag every other screen's level around.
 *
 * ES2018 floor, like every other shipped asset.
 */

import { glyph, iconNameFor } from './puck-icons.js';

var SVG_NS = 'http://www.w3.org/2000/svg';

var RADIAL_MAX = 12;
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
export function letterOf(title) {
  var text = String(title === undefined || title === null ? '' : title);
  // Accents fold: Roon files `Édith Piaf` under E, and a bare code-point
  // comparison would exile her past Z with the CJK.
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  text = text.toUpperCase().replace(/^THE[\s\u2010-\u2015-]+/, '');
  text = text.replace(/^[\u0022\u0027\u2018\u2019\u201c\u201d.\s]+/, '');
  var first = text.charAt(0);
  if (first >= 'A' && first <= 'Z') return first;
  // ASCII digits and the marks Roon does sort on, plus the general-punctuation
  // block (… – « ‘): a Latin title that merely opens with one.
  if (first < '\u0080') return '#';
  if (first >= '\u2000' && first <= '\u206f') return '#';
  return '~';
}

/**
 * Is this level in alphabetical order? Roon never says, and it is not always
 * true — so it is read off the titles rather than assumed from the hierarchy.
 * The bucket, not the title, is what the ring navigates by, so that is what has
 * to be non-decreasing.
 */
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

export function createBrowse(options) {
  var host = options.host;
  var root = options.root;
  var el = options.el;
  var zoneId = options.zoneId;
  var flash = options.flash;
  var tick = options.tick || function () {};
  var onChange = options.onChange || function () {};
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
  level.addEventListener('click', function (event) { event.stopPropagation(); back(); });
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
   * level"). ‹ and › either side of the name, select beneath it, and up/back
   * on the level's title at the top. Circles, like everything else pressable.
   */
  var nav = el('div', 'nav-keys');
  var prevKey = key('\u2039', 'previous', function () { move(-1); });
  var nextKey = key('\u203a', 'next', function () { move(1); });
  var selectKey = key('\u25cf', 'select', function () { commit(); });
  prevKey.className = 'key key-prev';
  nextKey.className = 'key key-next';
  selectKey.className = 'key key-select';
  nav.appendChild(prevKey);
  nav.appendChild(selectKey);
  nav.appendChild(nextKey);

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

  var view = null;   // null when closed
  var epoch = 0;
  var busy = false;
  var spellReturn = null;   // { speller, depth } while search results are up

  function current(mine) { return mine === epoch && view !== null; }

  function ask(body) {
    body.sessionKey = session;
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
    if (view.spell) root.setAttribute('data-spell', '1'); else root.removeAttribute('data-spell');
    level.textContent = view.title;
    while (optWrap.firstChild) optWrap.removeChild(optWrap.firstChild);

    if (view.tier === 'linear') drawPaged();
    else drawRing();

  }

  function label(index) {
    if (view.tier === 'alpha') return view.letters[index];
    var item = itemAt(index);
    return item === null ? '' : item.title;
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

  function token(item, text) {
    var node = el('div', 'tok');
    var name = item === null ? null : iconNameFor(item.title, item.hint, onGenreLevel());
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
        var name = el('div', 'opt-name', label(i));
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
      chosenTitle.textContent = view.tier === 'alpha' ? view.letters[view.sel] : (pick === null ? '' : pick.title);
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
  var SLOTS = 7;

  function drawPaged() {
    var first = Math.floor(view.sel / SLOTS) * SLOTS;
    var n = Math.max(1, Math.min(SLOTS, view.total - first));
    var size = tokenSize(n);
    named = true;
    for (var k = 0; k < n; k += 1) {
      var index = first + k;
      var item = itemAt(index);
      var angle = (k / n) * 2 * Math.PI - Math.PI / 2;
      var node = el('div', index === view.sel ? 'opt opt-on' : 'opt');
      var mark = token(item, item === null ? '\u2026' : item.title.charAt(0).toUpperCase());
      var mine = index === view.sel ? size * 1.3 : size;
      sizeToken(mark, mine);
      node.appendChild(mark);
      var name = el('div', 'opt-name', item === null ? '\u2026' : item.title);
      var below = Math.sin(angle) <= 1e-9;   // sin(π) is +1e-16: nine o'clock must side with three
      name.style.marginTop = below
        ? 'calc(var(--u) * ' + String(mine / 2 + 1.4) + ')'
        : 'calc(var(--u) * ' + String(-(mine / 2 + 5.1)) + ')';
      node.appendChild(name);
      place(node, 50 + OPT_R * Math.cos(angle), 50 + OPT_R * Math.sin(angle));
      bindPick(node, index);
      optWrap.appendChild(node);
    }
    var pick = itemAt(view.sel);
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    chosenTitle.textContent = pick === null ? '\u2026' : pick.title;
    chosenSub.textContent = pick !== null && pick.subtitle ? pick.subtitle : '';
    linsub.textContent = '';
    root.setAttribute('data-named', '1');
    count.textContent = String(view.sel + 1) + ' / ' + String(view.total)
      + (view.letter === null ? '' : '  \u00b7  ' + view.letter);
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
      // A library has ends; a ring does not. The floor is the loaded window's
      // own start, because a letter jump lands mid-list and never pages back.
      if (next < view.base || next >= n) return;
      view.sel = next;
      fill();
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
      letters: null, probes: {},
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

  function close() {
    epoch += 1;
    view = null;
    spellReturn = null;
    busy = false;
    root.removeAttribute('data-browse');
    root.removeAttribute('data-tier');
    root.removeAttribute('data-spell');
    onChange(false);
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
        return present(result, depth + 1, mine, hierarchy);
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
    if (view.letter !== null) {
      var restored = view.alpha;
      view = restored;
      view.letter = null;
      tick();
      draw();
      return;
    }
    if (view.depth === 0) { close(); return; }
    var mine = epoch;
    var hierarchy = view.hierarchy;
    var depth = view.depth;
    busy = true;
    ask({ hierarchy: hierarchy, popLevels: 1 })
      .then(function (result) {
        busy = false;
        if (!current(mine)) return;
        return present(result, depth - 1, mine, hierarchy);
      })
      .catch(function () { busy = false; if (current(mine)) close(); });
  }

  /* ---------- the speller: Search, spelt on the ring ---------- */

  function spell(item) {
    var parent = view;
    view = {
      hierarchy: parent.hierarchy, tier: 'alpha', title: item.title || 'Search', total: 0,
      items: [], base: 0, sel: 0, depth: parent.depth, letter: null, paging: false,
      letters: ALPHABET, probes: {},
      spell: { query: '', prompt: (item.input && item.input.prompt) || 'Search', parent: parent },
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
    level.textContent = 'searching\u2026';
    ask({ hierarchy: 'search', popAll: true, input: query })
      .then(function (result) {
        busy = false;
        if (!current(mine)) return;
        if (result.isError === true) { flash(result.message || 'nothing found'); draw(); return; }
        spellReturn = { speller: speller, depth: speller.depth + 1 };
        return present(result, speller.depth + 1, mine, 'search');
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
  function findLetter(hierarchy, letter, total, mine, probes, done) {
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
        if (letterOf(title) >= letter) { best = mid; high = mid - 1; } else { low = mid + 1; }
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
    level.textContent = 'finding ' + letter + '\u2026';
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
      // Anchor the page a couple of rows BEFORE the letter. Loading exactly at
      // it left the two rows above the chosen one unloaded, and a column that
      // opens under two ellipses reads as broken rather than as a beginning.
      var from = Math.max(0, offset - WINDOW);
      ask({ hierarchy: hierarchy, load: true, count: PAGE, offset: from })
        .then(function (data) {
          busy = false;
          if (!current(mine)) return;
          view = {
            hierarchy: hierarchy, tier: 'linear', title: alpha.title, total: alpha.total,
            items: data.items || [], base: from, sel: offset, depth: alpha.depth,
            letter: letter, paging: false, alpha: alpha, probes: alpha.probes, letters: null,
          };
          tick();
          draw();
        })
        .catch(function () { busy = false; if (current(mine)) draw(); });
    });
  }

  return {
    open: open,
    close: close,
    back: back,
    commit: commit,
    move: move,
    isOpen: function () { return view !== null; },
  };
}
