/**
 * THE PUCK'S BROWSE — Roon's library, read around a clock face.
 *
 * ⚖️ THE TIER IS CHOSEN BEFORE THE ITEMS ARE LOADED. Roon reports `list.count`
 * with the level, so the dial knows how to present a list without fetching it
 * first. Measured on a real library: Explore 7, Genres 56, Albums 2295 — which
 * is exactly why all three tiers have to exist.
 *
 *   ≤ 12   RADIAL   the choices ring the face, the selected one read large
 *   ≤ 200  ALPHABET 26 letters ring the face; a letter jumps into the third tier
 *   more   LINEAR   a column under the thumb: the choice in the middle
 *
 * ⚠️ MEASURED 09-03, on the live Core: THE MIDDLE TIER'S PREMISE IS NOT FREE.
 * Genres came back 56 long and NOT alphabetical — `Pop/Rock, Jazz, Classical,
 * Rock, …`, ordered by size — so an alphabet ring over it offered 26 letters
 * that led nowhere, and a bisection for "C" answered 0 because the first title
 * already sorted after it. The count alone cannot tell you a list is ordered.
 *
 * So the middle band LOADS THE WHOLE LEVEL in one call (Roon's own load cap is
 * 200, which is exactly this band) and reads the order off the titles it has.
 * Ordered ⇒ the alphabet ring, and a letter jump is then an index lookup rather
 * than fourteen probes; not ordered ⇒ the column, which needs no order at all.
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

var SVG_NS = 'http://www.w3.org/2000/svg';

var RADIAL_MAX = 12;
var ALPHA_MAX = 200;
var OPT_R = 35;           // where the labels ring the face
var PAGE = 40;            // one linear page; Roon caps a load at 200
var WINDOW = 2;           // rows drawn either side of the chosen one
var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function tierFor(count) {
  if (count <= RADIAL_MAX) return 'radial';
  if (count <= ALPHA_MAX) return 'alpha';
  return 'linear';
}

/**
 * Roon sorts "The Beatles" under B, and numbers ahead of letters — so the
 * alphabet jump has to bucket a title the way the Core already ordered it.
 */
export function letterOf(title) {
  var text = String(title === undefined || title === null ? '' : title).toUpperCase();
  text = text.replace(/^(THE|A|AN)\s+/, '');
  var first = text.charAt(0);
  return (first >= 'A' && first <= 'Z') ? first : '#';
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
  var level = el('div', 'level');
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
  var crumbs = document.createElementNS(SVG_NS, 'svg');
  crumbs.setAttribute('class', 'ring');
  crumbs.setAttribute('viewBox', '0 0 100 100');
  layer.appendChild(veil);
  layer.appendChild(crumbs);
  layer.appendChild(level);
  layer.appendChild(optWrap);
  layer.appendChild(chosen);
  layer.appendChild(linsub);
  layer.appendChild(count);
  host.appendChild(layer);

  /* ---------- what is on the face ---------- */

  var view = null;   // null when closed
  var epoch = 0;
  var busy = false;

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
    level.textContent = view.title;
    while (optWrap.firstChild) optWrap.removeChild(optWrap.firstChild);

    if (view.tier === 'linear') drawColumn();
    else drawRing();

    // the cascade: one thin arc per Roon level already descended
    while (crumbs.firstChild) crumbs.removeChild(crumbs.firstChild);
    for (var d = 0; d < view.depth; d += 1) {
      var arc = document.createElementNS(SVG_NS, 'circle');
      arc.setAttribute('class', 'crumb');
      arc.setAttribute('cx', '50');
      arc.setAttribute('cy', '50');
      arc.setAttribute('r', String(43 - d * 3));
      crumbs.appendChild(arc);
    }
  }

  function label(index) {
    if (view.tier === 'alpha') return ALPHABET[index];
    var item = itemAt(index);
    return item === null ? '' : item.title;
  }

  function drawRing() {
    var n = view.tier === 'alpha' ? ALPHABET.length : view.items.length;
    for (var i = 0; i < n; i += 1) {
      var angle = (i / n) * 2 * Math.PI - Math.PI / 2;   // twelve o'clock, clockwise
      var node = el('div', i === view.sel ? 'opt opt-on' : 'opt', label(i));
      place(node, 50 + OPT_R * Math.cos(angle), 50 + OPT_R * Math.sin(angle));
      bindPick(node, i);
      optWrap.appendChild(node);
    }
    var pick = view.tier === 'alpha' ? null : itemAt(view.sel);
    chosenTitle.textContent = view.tier === 'alpha' ? ALPHABET[view.sel] : (pick === null ? '' : pick.title);
    chosenSub.textContent = pick !== null && pick.subtitle ? pick.subtitle : '';
    if (pick !== null && pick.art) {
      chosenArt.src = pick.art;
      chosenArt.style.display = '';
      chosen.className = 'chosen has-art';
    } else {
      chosenArt.removeAttribute('src');
      chosenArt.style.display = 'none';
      chosen.className = 'chosen';
    }
    linsub.textContent = '';
    count.textContent = view.tier === 'alpha'
      ? String(view.total) + ' — pick a letter'
      : String(view.sel + 1) + ' / ' + String(view.total);
  }

  function drawColumn() {
    for (var d = -WINDOW; d <= WINDOW; d += 1) {
      var index = view.sel + d;
      if (index < 0 || index >= view.total) continue;
      var item = itemAt(index);
      var node = el('div', d === 0 ? 'opt opt-on' : 'opt', item === null ? '…' : item.title);
      place(node, 50, 50 + d * 12);
      bindPick(node, index);
      optWrap.appendChild(node);
    }
    var pick = itemAt(view.sel);
    chosenArt.style.display = 'none';
    chosen.className = 'chosen';
    linsub.textContent = pick !== null && pick.subtitle ? pick.subtitle : '';
    count.textContent = String(view.sel + 1) + ' / ' + String(view.total)
      + (view.letter === null ? '' : '  ·  ' + view.letter);
  }

  function bindPick(node, index) {
    node.addEventListener('click', function (event) {
      event.stopPropagation();
      if (view === null) return;
      // The ring is navigation AND selection: landing on a choice that is already
      // under the thumb commits it, so a menu never needs two taps in two places.
      if (view.sel === index) { commit(); return; }
      view.sel = index;
      tick();
      draw();
    });
  }

  /* ---------- moving ---------- */

  function move(step) {
    if (view === null || busy) return;
    var n = view.tier === 'alpha' ? ALPHABET.length : view.total;
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
    if (view.sel < have - (WINDOW + 2) || have >= view.total) return;
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

  function present(head, depth, mine, hierarchy) {
    var list = head.list;
    if (list === null || list === undefined) throw new Error('that level has no list');
    var total = list.count;
    var wanted = tierFor(total);
    view = {
      hierarchy: hierarchy, tier: wanted, title: list.title || 'Browse', total: total,
      items: [], base: 0, sel: 0, depth: depth, letter: null, paging: false,
    };
    var take = wanted === 'radial' ? RADIAL_MAX : (wanted === 'alpha' ? ALPHA_MAX : PAGE);
    return ask({ hierarchy: hierarchy, load: true, count: take, offset: 0 })
      .then(function (page) {
        if (!current(mine)) return;
        view.items = page.items || [];
        // A short page means the level is smaller than it claimed, whatever the
        // count said — and for the two whole-load tiers that is the real total.
        if (wanted !== 'linear' && view.items.length < view.total) view.total = view.items.length;
        // The alphabet ring is EARNED, not assumed: an unordered level gets the
        // column, which is honest about a list nobody can jump around in.
        if (wanted === 'alpha' && !isAlphabetical(view.items)) view.tier = 'linear';
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
    busy = false;
    root.removeAttribute('data-browse');
    root.removeAttribute('data-tier');
    onChange(false);
  }

  /* ---------- ↓ commit ---------- */

  function commit() {
    if (view === null || busy) return;
    if (view.tier === 'alpha') { jump(ALPHABET[view.sel]); return; }
    var item = itemAt(view.sel);
    if (item === null) return;
    if (item.input !== null && item.input !== undefined) {
      // Search wants typing, and this device has no keyboard yet (I3).
      flash(item.title + ' needs a keyboard');
      return;
    }
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

  /* ---------- the alphabet jump ---------- */

  /**
   * ⚖️ NO BISECTION. The whole level is already loaded — that is the price of
   * knowing it was ordered at all — so the first row under a letter is a scan,
   * not fourteen serialised probes against a browse stack shared with nothing.
   */
  function jump(letter) {
    if (view === null || busy) return;
    var alpha = view;
    var at = -1;
    for (var i = 0; i < alpha.items.length; i += 1) {
      if (letterOf(alpha.items[i].title) >= letter) { at = i; break; }
    }
    if (at === -1) { flash('nothing under ' + letter); return; }
    view = {
      hierarchy: alpha.hierarchy, tier: 'linear', title: alpha.title, total: alpha.total,
      items: alpha.items, base: 0, sel: at, depth: alpha.depth,
      letter: letter, paging: false, alpha: alpha,
    };
    tick();
    draw();
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
