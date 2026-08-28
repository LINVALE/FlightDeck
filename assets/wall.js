import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';

/**
 * The House Wall. Ordered by MOST RECENTLY PLAYED (Peter's ruling 08-25): the
 * server does the ordering, so every screen agrees. State is shown by tile SIZE
 * and by the copy — never by moving a zone, so a track change never reshuffles.
 *
 * DOM is bounded: tiles are reused by zone id and never re-created per tick (R7).
 */

var root = document.getElementById('wall');
var grid = document.getElementById('grid');
var summaryEl = document.getElementById('summary');
var coreEl = document.getElementById('core');
var tiles = {};
var order = [];
var tabsEl = document.getElementById('tabs');

/**
 * ISLAND TABS.
 *
 * Roon partitions grouping by protocol and says so per output, but names the
 * protocol nowhere — so the tabs are built from the RELATION itself, and labelled
 * from the rooms in them rather than from a word we would have had to guess.
 * Dividing the house this way is also what makes the tile cap unnecessary.
 */
var activeIsland = '';
try { activeIsland = localStorage.getItem('flightdeck.island') || ''; } catch (e) { activeIsland = ''; }
var tabsKey = '';

/**
 * A FAMILY HAS A COLOUR.
 *
 * Roon groups rooms by how they connect and never says what those groups are, so
 * naming them needs a person. A colour does not (Peter, 08-26: "each family
 * identified by a distinct but elegant subtle colour — no need to name"). The
 * same colour marks the tab and every tile in that family, so the wall teaches
 * the association itself, without a legend and without a word.
 *
 * Assigned by size order, which is stable: an island's rank does not move as the
 * music does. Muted on purpose — these sit behind the artwork, not in front of it.
 */
var FAMILY_COLOURS = ['#7fa6b0', '#b39b78', '#a08bb0', '#8faa8a', '#b08f92', '#8b95b5'];

function familyColour(index) {
  return FAMILY_COLOURS[index % FAMILY_COLOURS.length];
}

/**
 * The server orders and counts the islands; the names come with them. Roon says
 * nothing about what a set of outputs IS — no protocol field, no MAC, and
 * `source_controls` names the device, not the transport — so an island shows the
 * name a person gave it, and only falls back to naming itself by its members.
 */
/** membership hash (what an output carries) -> the server's stable island id */
var serverIsland = {};

function islandsOf(snapshot) {
  var members = {};
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    var zone = snapshot.zones[i];
    var key = zone.outputs.length > 0 ? zone.outputs[0].island : '';
    if (key === '') continue;
    if (members[key] === undefined) members[key] = [];
    members[key].push(zone.name);
  }
  var list = [];
  var islands = snapshot.islands || [];
  for (var j = 0; j < islands.length; j += 1) {
    var names = (members[islands[j].id] || []).slice().sort();
    serverIsland[islands[j].id] = islands[j].id;
    /**
     * An unnamed island is ROON N, not the first device in it. Roon does give us
     * the types — the partition is exactly that — it just does not say what any
     * of them IS. Naming one after a member was arbitrary: it made the Squeezebox
     * family look as though it were called Cobalt. A number claims nothing, and
     * asks to be named — which is done in Roon's own Settings → Extensions.
     */
    list.push({
      id: islands[j].id,
      count: islands[j].count,
      members: names,
      colour: familyColour(j),
      named: islands[j].label !== null,
      // A name is optional now. Unnamed, the tab is its colour and its size —
      // which is all you need to pick one, and claims nothing that is not true.
      label: islands[j].label !== null ? islands[j].label : String(islands[j].count) + ' rooms',
    });
  }
  return list;
}

/**
 * NAMING ONE. A TV has no keyboard, but the Samsung remote is a pointer and does
 * deliver letters and space — so the tab becomes a text field in place, and is
 * committed by a button a pointer can hit rather than by an Enter key that some
 * remotes never send.
 */
function renameIsland(island, node) {
  var box = el('span', 'wall-tab renaming');
  var input = document.createElement('input');
  input.className = 'wall-rename';
  input.type = 'text';
  input.maxLength = 24;
  input.value = island.named ? island.label : '';
  input.placeholder = 'name this group';
  var commit = function (value) {
    fetch('/api/v1/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'label-island', island: island.id, label: value }),
    }).then(function () { tabsKey = ''; var s = store.snapshot(); if (s !== null) render(s, 'snapshot'); });
  };
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') commit(input.value);
    if (event.key === 'Escape') { tabsKey = ''; var s = store.snapshot(); if (s !== null) render(s, 'snapshot'); }
  });
  var save = el('span', 'wall-rename-do', 'save');
  save.addEventListener('click', function () { commit(input.value); });
  box.appendChild(input);
  box.appendChild(save);
  node.parentNode.replaceChild(box, node);
  input.focus();
}

function drawTabs(islands, total) {
  var key = islands.map(function (i) { return i.id + ':' + String(i.count) + ':' + i.label; }).join('|') + '#' + activeIsland;
  if (key === tabsKey) return;
  tabsKey = key;
  if (islands.length < 2) { tabsEl.hidden = true; tabsEl.replaceChildren(); return; }
  tabsEl.hidden = false;
  var nodes = [];
  var tab = function (id, label) {
    var node = el('span', activeIsland === id ? 'wall-tab now' : 'wall-tab', label);
    node.addEventListener('click', function () {
      if (node.className.indexOf('asleep') >= 0) return;   // nothing awake to show
      activeIsland = id;
      try { localStorage.setItem('flightdeck.island', id); } catch (e) { /* private window */ }
      tabsKey = '';
      order = [];                        // a deliberate switch may reorder freely
      var snap = store.snapshot();
      if (snap !== null) render(snap, 'snapshot');
    });
    return node;
  };
  nodes.push(tab('', 'all  ' + String(total)));
  for (var i = 0; i < islands.length; i += 1) {
    (function (island) {
      var node = tab(island.id, island.label);
      var swatch = el('span', 'wall-swatch');
      swatch.style.background = island.colour;
      node.insertBefore(swatch, node.firstChild);
      if (!island.named) node.className += ' unnamed';
      node.setAttribute('title', String(island.count) + ' rooms: ' + island.members.join(' · '));
      // A second press on the tab you are already on asks what it should be called.
      node.addEventListener('dblclick', function () { renameIsland(island, node); });
      var pen = el('span', 'wall-tab-pen', '\u270E');
      pen.addEventListener('click', function (event) {
        event.stopPropagation();
        renameIsland(island, node);
      });
      node.appendChild(pen);
      nodes.push(node);
    })(islands[i]);
  }
  tabsEl.replaceChildren.apply(tabsEl, nodes);
}

/**
 * HOLDING YOUR PLACE.
 *
 * The wall is ordered most-recently-played first, which is right, but re-sorting
 * on every frame moved every tile each time any room changed track — and a wall
 * you cannot keep your place on is not a wall (Peter, 08-26: "things change
 * dynamically and I can get lost"). So it re-sorts when a room STARTS or STOPS,
 * which is news, and holds still through track changes, which are not.
 */
var lastLive = null;
function holdOrder(zones) {
  var live = [];
  for (var i = 0; i < zones.length; i += 1) {
    if (zones[i].state === 'playing' || zones[i].state === 'loading') live.push(zones[i].id);
  }
  var signature = live.sort().join(',');
  var resort = lastLive === null || signature !== lastLive || order.length === 0;
  lastLive = signature;
  if (resort) return zones;

  var held = [];
  for (var k = 0; k < order.length; k += 1) {
    for (var z = 0; z < zones.length; z += 1) if (zones[z].id === order[k]) { held.push(zones[z]); break; }
  }
  for (var n = 0; n < zones.length; n += 1) {
    if (order.indexOf(zones[n].id) === -1) held.push(zones[n]);
  }
  return held;
}

/**
 * A wall shows the zones worth looking at, not every zone that exists. Because
 * the order is most-recently-played, the cap curates itself: the rooms in use
 * are the rooms on screen, and a room silent for a week does not need a tile.
 *
 * The remainder becomes one quiet line rather than a second page — a TV is
 * driven by a remote from a sofa, and a wall nobody has to operate is the point.
 * Override per screen with ?zones=N (0 for all).
 */
/**
 * No cap by default. It existed because a TV cannot scroll and 22 rooms at once
 * is a wall of postage stamps — but the island tabs now do that job by dividing
 * the house rather than truncating it (Peter, 08-26: "we don't need to limit
 * anymore to 16"). `?tiles=N` still puts a cap back for a small screen.
 */
var MAX_TILES = 0;
(function readCap() {
  var match = /[?&]zones=(\d+)/.exec(window.location.search);
  if (match !== null) MAX_TILES = Math.max(0, Math.min(64, parseInt(match[1], 10)));
})();

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The three transport marks, drawn here because the wall carried no glyphs. */
function glyph(name) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tt-glyph');
  svg.setAttribute('aria-hidden', 'true');
  var d = {
    prev: 'M7 6h2.2v12H7zm10 0v12l-8-6z',
    next: 'M17 6h-2.2v12H17zM7 6v12l8-6z',
    play: 'M8 5.5v13l11-6.5z',
    pause: 'M8 5.5h3.1v13H8zm5 0h3.1v13H13z'
  }[name];
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function buildTile(zone) {
  var zoneId = zone.id;
  var tile = el('a', 'tile');
  tile.href = '/face/' + encodeURIComponent(zoneId);
  tile.setAttribute('data-zone', zoneId);
  var check = el('span', 'tile-check');
  tile.appendChild(check);
  /**
   * GROUPING BY HAND. A press that MOVES becomes a drag (held first, on touch,
   * so a scroll is never mistaken for one); a press that stays put is a look at
   * the room, exactly as before. In choose mode a tap toggles the room instead.
   */
  tile.addEventListener('mousedown', function (event) {
    startPress(event, { kind: 'zone', zoneId: zoneId, name: name.textContent });
  });
  tile.addEventListener('touchstart', function (event) {
    startPress(event, { kind: 'zone', zoneId: zoneId, name: name.textContent });
  }, { passive: true });
  tile.addEventListener('click', function (event) {
    if (Date.now() < squelchUntil) { event.preventDefault(); event.stopPropagation(); return; }
    if (!selectMode) return;                    // a plain look at the room
    event.preventDefault(); event.stopPropagation();
    tapToggle(zoneId);
  });
  var art = el('div', 'tile-art');
  var img = document.createElement('img');
  img.alt = '';
  art.appendChild(img);
  var copy = el('div', 'tile-copy');
  var zoneLine = el('div', 'tile-zone');
  var name = el('span', '', zone.name);
  zoneLine.appendChild(name);
  var title = el('div', 'tile-title');
  var line2 = el('div', 'tile-line2');
  /**
   * The progress line, and the transport under it — the shape RHEOS's own console
   * settled on (`rheos_v2/src/device-management/device-console-pages.ts`): an
   * elapsed time, a plain bar, a total, then previous / play-pause / next. Peter
   * asked for exactly that here (08-28), minus the circular art, which he has
   * ruled against for this wall.
   */
  var progress = el('div', 'tile-progress');
  var elapsed = el('span', 'tile-t');
  var rule = el('span', 'tile-rule');
  var fill = el('i');
  rule.appendChild(fill);
  var total = el('span', 'tile-t total');
  progress.appendChild(elapsed); progress.appendChild(rule); progress.appendChild(total);

  var transport = el('div', 'tile-transport');
  /** A press inside the tile's own anchor must never also follow it to the Face. */
  var act = function (mark, label, action) {
    var b = el('span', 'tt', '');
    b.appendChild(glyph(mark));
    b.setAttribute('title', label);
    b.setAttribute('aria-label', label + ' · ' + zone.name);
    var last = 0;
    b.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      if (drag !== null && drag.armed) return;
      var now = Date.now();
      if (now - last < 400) return;
      last = now;
      post({ action: action, zone: zoneId });
    });
    b.addEventListener('mousedown', function (event) { event.stopPropagation(); });
    b.addEventListener('touchstart', function (event) { event.stopPropagation(); }, { passive: true });
    return b;
  };
  var prevB = act('prev', 'previous', 'previous');
  var playB = act('play', 'play', 'playpause');
  var nextB = act('next', 'next', 'next');
  transport.appendChild(prevB); transport.appendChild(playB); transport.appendChild(nextB);

  copy.appendChild(zoneLine); copy.appendChild(title); copy.appendChild(line2);
  copy.appendChild(progress); copy.appendChild(transport);
  var meta = el('div', 'tile-meta');
  var stamp = el('div', 'tile-stamp');
  var state = el('div', 'tile-state');
  meta.appendChild(state); meta.appendChild(stamp);
  tile.appendChild(art); tile.appendChild(copy); tile.appendChild(meta);
  return {
    node: tile, img: img, name: name, zoneLine: zoneLine, title: title,
    line2: line2, fill: fill, stamp: stamp, state: state, check: check,
    elapsed: elapsed, total: total, playB: playB, prevB: prevB, nextB: nextB,
    artKey: null, chips: []
  };
}

var overflowEl = null;
function setOverflow(zones) {
  if (overflowEl === null) {
    overflowEl = el('div', 'overflow');
    grid.parentNode.insertBefore(overflowEl, grid.nextSibling);
  }
  if (zones.length === 0) { overflowEl.textContent = ''; overflowEl.hidden = true; return; }
  var names = [];
  for (var i = 0; i < zones.length && i < 8; i += 1) names.push(zones[i].name);
  overflowEl.hidden = false;
  overflowEl.textContent = 'quiet since: ' + names.join(' · ')
    + (zones.length > names.length ? ' and ' + (zones.length - names.length) + ' more' : '');
}

function stampFor(zone, now) {
  if (zone.state === 'playing' || zone.state === 'loading') {
    if (!zone.runStartedAt) return 'now';
    return 'since ' + new Date(zone.runStartedAt).toTimeString().slice(0, 5);
  }
  if (!zone.lastPlayedAt) return '';
  var then = new Date(zone.lastPlayedAt);
  var minutes = Math.round((now - then.getTime()) / 60000);
  if (zone.state === 'paused' && minutes < 90) return minutes + ' min';
  var sameDay = then.toDateString() === new Date(now).toDateString();
  if (sameDay) return then.toTimeString().slice(0, 5);
  var days = Math.floor((now - then.getTime()) / 86400000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return then.toDateString().slice(0, 3);
  return then.toDateString().slice(4, 10);
}

function classFor(zone, isHero) {
  var base = 'tile';
  if (zone.state === 'playing' || zone.state === 'loading') base += ' is-live';
  else if (zone.state === 'paused') base += ' is-paused';
  else base += ' is-idle';
  if (isHero) base += ' is-hero';
  return base;
}

function setChips(tile, zone) {
  var wanted = zone.outputs.length > 1 ? zone.outputs.slice(1) : [];
  var key = wanted.map(function (o) { return o.id + '=' + o.name; });
  if (key.join('|') === tile.chips.join('|')) return;
  for (var i = 0; i < tile.chips.length; i += 1) {
    var existing = tile.zoneLine.querySelector('.chip');
    if (existing) tile.zoneLine.removeChild(existing);
  }
  tile.chips = key;
  /**
   * A chip is a MEMBER of the group, and can be dragged out of it. There is no
   * chip for the group's first output — the tile itself is that room, and the
   * LEADER IS PINNED (HEOS's line): its zone's queue IS the group's music, so
   * taking it out would beg the question of who leads now. Dissolve instead.
   */
  for (var j = 0; j < wanted.length; j += 1) {
    (function (o) {
      var chip = el('span', 'chip', o.name);
      chip.addEventListener('mousedown', function (event) {
        event.stopPropagation();
        startPress(event, { kind: 'member', zoneId: zone.id, outputId: o.id, name: o.name, node: chip });
      });
      chip.addEventListener('touchstart', function (event) {
        event.stopPropagation();
        startPress(event, { kind: 'member', zoneId: zone.id, outputId: o.id, name: o.name, node: chip });
      }, { passive: true });
      /**
       * A CHIP IS ALSO A BUTTON (Peter, 08-28: "click or gesture to ungroup?").
       *
       * Drag-out is the symmetric gesture and it stays — but it is undiscoverable,
       * and dragging with a television pointer is genuinely awkward. So a plain
       * press on a member removes that member: one `ungroup_outputs` call on that
       * output alone, exactly what the drag does, with none of the aim required.
       *
       * The `×` only appears on hover/focus, so a wall being LOOKED at still reads
       * as a list of rooms rather than a row of controls.
       */
      chip.appendChild(el('span', 'chip-x', '\u00D7'));
      chip.setAttribute('title', 'remove ' + o.name + ' from this group');
      (function (outputId, roomName, zoneId) {
        var pressedAt = 0;
        var take = function (event) {
          // a press that became a drag is the drag's business, not ours
          if (drag !== null && drag.armed) return;   // a press that became a drag is the drag's business
          var now = Date.now();
          if (now - pressedAt < 400) return;
          pressedAt = now;
          if (event && event.stopPropagation) event.stopPropagation();
          if (event && event.preventDefault) event.preventDefault();
          post({ action: 'ungroup', zone: zoneId, output: outputId }).then(function (ok) {
            if (!ok) say('could not take ' + roomName + ' out of the group');
          });
        };
        chip.addEventListener('click', take);
      })(o.id, o.name, zone.id);
      tile.zoneLine.appendChild(chip);
    })(wanted[j]);
  }
}

function setArt(tile, zone) {
  var art = zone.nowPlaying && zone.nowPlaying.art ? zone.nowPlaying.art : null;
  var key = art ? art.key : null;
  if (key === tile.artKey) return;
  tile.artKey = key;
  if (art === null) { tile.img.removeAttribute('src'); return; }
  // Decode before swapping so a slow image never shows a broken or half-painted
  // frame. img.decode() is Chromium 64 — above the floor — so it is guarded.
  load(tile, art.path, 0);
}

/** One retry after a short delay: a transient miss must not leave a permanent hole. */
function load(tile, path, attempt) {
  var next = new Image();
  next.onload = function () { tile.img.src = next.src; };
  next.onerror = function () {
    if (attempt >= 1) return;
    setTimeout(function () { if (tile.artKey !== null) load(tile, path, attempt + 1); }, 1500);
  };
  next.src = path;
  if ('decode' in HTMLImageElement.prototype) {
    next.decode().then(function () { tile.img.src = next.src; }).catch(function () { /* onload/onerror cover it */ });
  }
}

function render(snapshot, kind) {
  if (snapshot === null) return;
  // A drag holds the wall still: tiles moving under a held finger would change
  // the drop target between the decision and the release. Redrawn on release.
  // A drag holds the wall still, but a frame arriving mid-drag must be KEPT and
  // applied on release — dropping it left the grid showing a house that had since
  // changed (RHEOS's console states the same rule: "held and applied on release,
  // never mid-gesture").
  if (dragLock) { deferredFrame = snapshot; return; }
  var now = Date.now();
  root.setAttribute('data-state', 'live');

  if (kind !== 'seek') {
    var playing = 0, loading = 0;
    for (var c = 0; c < snapshot.zones.length; c += 1) {
      if (snapshot.zones[c].state === 'playing') playing += 1;
      if (snapshot.zones[c].state === 'loading') loading += 1;
    }
    var core = snapshot.core;
    summaryEl.textContent = (core.name ? core.name + ' · ' : '')
      + snapshot.zones.length + ' zones · ' + playing + ' playing'
      + (loading > 0 ? ' · ' + loading + ' loading' : '');
    if (streamState === 'catching-up') {
      coreEl.textContent = 'catching up…';
      coreEl.className = 'wall-core away';
    } else {
      coreEl.textContent = core.state === 'paired' ? 'paired' : 'Roon is away — showing the last known state';
      coreEl.className = 'wall-core' + (core.state === 'paired' ? '' : ' away');
    }

    if (snapshot.zones.length === 0) {
      grid.replaceChildren(el('div', 'empty', 'No Roon zones yet.'));
      order = [];
      return;
    }

    var islands = islandsOf(snapshot);
    drawTabs(islands, snapshot.zones.length);
    // "group rooms" appears only when Roon would let SOMETHING be formed: an
    // island with two zones in it. One zone per island means nothing to join.
    var canGroup = false;
    for (var gi = 0; gi < islands.length; gi += 1) if (islands[gi].count >= 2) canGroup = true;
    groupBtn.hidden = selectMode || !canGroup;
    // every tile wears its family's colour, which is how the tab's colour comes
    // to mean something without a legend anywhere
    var colourOf = {};
    for (var ci = 0; ci < islands.length; ci += 1) colourOf[islands[ci].id] = islands[ci].colour;
    /**
     * And the wall itself takes the family's colour while you are in it (Peter,
     * 08-26). Choosing a tab is choosing a room family, so the brand mark, the
     * progress fills and the tab all move together — you can tell which family
     * you are looking at from across the room without reading anything.
     * `all` goes back to FlightDeck's own amber.
     */
    root.style.setProperty('--accent',
      activeIsland !== '' && colourOf[activeIsland] !== undefined ? colourOf[activeIsland] : '#d8a24a');
    var inTab = snapshot.zones;
    if (activeIsland !== '') {
      inTab = [];
      for (var t = 0; t < snapshot.zones.length; t += 1) {
        var outs = snapshot.zones[t].outputs;
        if (outs.length > 0 && outs[0].island === activeIsland) inTab.push(snapshot.zones[t]);
      }
      // an island that has gone away must not leave an empty wall
      if (inTab.length === 0) { activeIsland = ''; inTab = snapshot.zones; tabsKey = ''; }
    }
    var held = holdOrder(inTab);
    // A TV cannot scroll, so density scales with what is on the page.
    var shown = MAX_TILES === 0 ? held : held.slice(0, MAX_TILES);
    var overflow = held.slice(shown.length);
    var count = shown.length;
    // Density follows what is ON THE PAGE, which is now a family rather than the
    // house: three rooms in a tab should look like three rooms, not like a corner
    // of twenty-two.
    root.setAttribute('data-density', count > 20 ? 'packed' : (count > 9 ? 'dense' : 'roomy'));

    var nextOrder = [];
    for (var i = 0; i < shown.length; i += 1) {
      var zone = shown[i];
      var tile = tiles[zone.id];
      if (tile === undefined) { tile = buildTile(zone); tiles[zone.id] = tile; }
      var isHero = i === 0 && (zone.state === 'playing' || zone.state === 'loading');
      tile.node.className = classFor(zone, isHero) + (count <= 3 ? ' solo' : '');
      if (selectMode) applySelect(tile, zone);
      else tile.check.textContent = '';
      // In one family's tab every tile is that family: the edge would say nothing.
      // A dot beside the room name, not a bar down the tile's edge — four columns
      // of edge bars read as ruled lines on the page, not as a room's family.
      var family = activeIsland !== '' || zone.outputs.length === 0
        ? undefined : colourOf[serverIsland[zone.outputs[0].island]];
      tile.node.style.boxShadow = '';
      if (tile.fam === undefined) {
        tile.fam = el('span', 'tile-fam');
        tile.zoneLine.insertBefore(tile.fam, tile.zoneLine.firstChild);
      }
      tile.fam.style.display = family === undefined ? 'none' : 'inline-block';
      if (family !== undefined) tile.fam.style.background = family;
      tile.name.textContent = zone.name;
      setChips(tile, zone);
      var np = zone.nowPlaying;
      tile.title.textContent = np ? np.title : 'nothing played yet';
      tile.line2.textContent = np ? np.line2 : '';
      tile.stamp.textContent = stampFor(zone, now);
      // The frame carries the state now, so the word only earns its place while
      // something is genuinely in flight.
      tile.state.textContent = zone.state === 'loading' ? 'loading' : '';
      var playing = zone.state === 'playing' || zone.state === 'loading';
      tile.playB.replaceChildren(glyph(playing ? 'pause' : 'play'));
      tile.playB.setAttribute('title', playing ? 'pause' : 'play');
      tile.prevB.className = zone.allowed.previous ? 'tt' : 'tt off';
      tile.nextB.className = zone.allowed.next ? 'tt' : 'tt off';
      setArt(tile, zone);
      nextOrder.push(zone.id);
    }
    if (nextOrder.join(',') !== order.join(',')) {
      order = nextOrder;
      var nodes = [];
      for (var k = 0; k < order.length; k += 1) nodes.push(tiles[order[k]].node);
      grid.replaceChildren.apply(grid, nodes);
    }
    setOverflow(overflow);
  }

  // Progress on every frame, including seek ticks. Only tiles that exist.
  for (var z = 0; z < snapshot.zones.length; z += 1) {
    var azone = snapshot.zones[z];
    var atile = tiles[azone.id];
    if (atile === undefined) continue;
    var position = store.positionSec(azone);
    var length = azone.nowPlaying ? azone.nowPlaying.lengthSec : null;
    if (position !== null && length) {
      atile.fill.style.width = Math.min(100, (position / length) * 100).toFixed(2) + '%';
      atile.elapsed.textContent = formatTime(position);
      atile.total.textContent = formatTime(length);
    } else {
      atile.fill.style.width = '0';
      atile.elapsed.textContent = '';
      atile.total.textContent = '';
    }
  }
}

/* ------------------------------------------------------------------------- *
 * GROUPING ON THE WALL — by direct manipulation, and by choosing.
 *
 * Two paths to the same two server actions:
 *   drag a room ONTO another        -> {action:'group', outputs:[target..., dragged...]}
 *   drag a member chip OUT          -> {action:'ungroup', zone, output}
 *   choose rooms, press "group"     -> {action:'group', outputs:[first chosen..., rest...]}
 *
 * THE DROP TARGET LEADS (HEOS's direction): `group_outputs` preserves the FIRST
 * output's zone's queue and discards the others', so the room you drop on keeps
 * its music and the dragged room joins it. The hint bar says so BEFORE release.
 *
 * THE LEADER IS PINNED (HEOS's line, over BluOS's promote-the-next): the group
 * tile drags as a whole, members drag out one at a time, and the room whose
 * queue the group plays cannot be dragged out — dissolve the group instead.
 * Fewer, larger changes are safer here: Roon tears a Squeezebox grouped zone
 * down on every `ungroup_outputs`, so clever handoffs multiply the damage.
 *
 * Roon will not group across its protocol islands, so an incompatible room is
 * refused BEFORE the drop: its words dim and it never becomes a target. The
 * cover is sacred — the art itself is never dimmed, tinted or shrunk.
 *
 * Events are mouse + touch, handled by hand: HTML5 drag-and-drop is unreliable
 * on TV browsers, and a Samsung pointer remote is a mouse that drifts. A touch
 * must HOLD 350ms before it becomes a drag, so a scroll is never mistaken for
 * one; a mouse arms on movement, so a plain click still opens the room.
 * ------------------------------------------------------------------------- */

var selectMode = false;
var selected = [];             // zone ids in the order chosen; the FIRST leads
var selectTimer = null;
var drag = null;               // the live press/drag, or null
var dragLock = false;          // render suppression while a drag holds the wall
var deferredFrame = null;      // the frame that arrived mid-drag, applied on release
var squelchUntil = 0;          // swallows the click the browser fires after a drag
var mouseBlockUntil = 0;       // swallows the compatibility mouse events after touch
var lastTap = 0;               // one physical press must never act twice

var HOLD_MS = 350;             // touch: hold this long to pick a room up
var TOUCH_SLOP = 10;           // touch: moving further first means scrolling
var MOVE_ARM = 12;             // mouse: dragging further than a jitter arms

function zoneOf(id) {
  var snap = store.snapshot();
  if (snap === null) return null;
  for (var i = 0; i < snap.zones.length; i += 1) if (snap.zones[i].id === id) return snap.zones[i];
  return null;
}

/** The island a whole zone lives in, or '' when it cannot group at all. */
function zoneIsland(zone) {
  if (zone.outputs.length === 0) return '';
  var island = zone.outputs[0].island;
  if (island === '') return '';
  for (var i = 1; i < zone.outputs.length; i += 1) if (zone.outputs[i].island !== island) return '';
  return island;
}

function post(body) {
  return fetch('/api/v1/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (response) {
    if (response.ok) return true;
    return response.json().catch(function () { return {}; }).then(function (data) {
      say(data.error || ('that did not work (' + response.status + ')'));
      return false;
    });
  }).catch(function () { say('could not reach FlightDeck'); return false; });
}

/** One press, however the device reports it — the wall's cousin of the face's pressable(). */
function tap(node, onPress) {
  var fire = function (event) {
    var now = Date.now();
    if (now - lastTap < 400 || now < squelchUntil) return;
    lastTap = now;
    if (event.stopPropagation) event.stopPropagation();
    if (event.preventDefault && event.type !== 'touchend') event.preventDefault();
    onPress();
  };
  node.addEventListener('click', fire);
  node.addEventListener('mouseup', fire);
  node.addEventListener('touchend', fire);
  node.addEventListener('keyup', fire);
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
}

/* The bar: what a release will do, said before the finger lifts; and in choose
   mode, whose music the group will play. Fixed over the footer so entering a
   mode never shifts a tile under a pointer. */
var bar = el('div', 'wall-bar');
bar.hidden = true;
var barHint = el('span', 'wall-bar-hint');
var barActs = el('span', 'wall-bar-acts');
bar.appendChild(barHint);
bar.appendChild(barActs);
document.body.appendChild(bar);

var sayTimer = null;
function say(message) {
  bar.hidden = false;
  barHint.textContent = message;
  if (sayTimer !== null) clearTimeout(sayTimer);
  sayTimer = setTimeout(function () { sayTimer = null; updateBar(); }, 2600);
}

function doBtn(label, onPress) {
  var b = el('span', 'wall-do', label);
  tap(b, onPress);
  return b;
}

var groupBtn = el('span', 'wall-act', 'group rooms');
groupBtn.hidden = true;
tap(groupBtn, function () { if (!selectMode) enterSelect(); });
(function () {
  var head = document.querySelector('.wall-head');
  if (head !== null) head.appendChild(groupBtn);
})();

/* ---- choosing rooms (the checkbox path) ---- */

function enterSelect() {
  selectMode = true;
  selected = [];
  root.classList.add('is-selecting');
  groupBtn.hidden = true;
  bumpSelectTimer();
  updateBar();
  var snap = store.snapshot();
  if (snap !== null) render(snap, 'snapshot');
}

function exitSelect() {
  selectMode = false;
  selected = [];
  root.classList.remove('is-selecting');
  if (selectTimer !== null) { clearTimeout(selectTimer); selectTimer = null; }
  updateBar();
  var snap = store.snapshot();
  if (snap !== null) render(snap, 'snapshot');
}

/** A wall left in choose mode is a wall mid-gesture forever; it lets go on its own. */
function bumpSelectTimer() {
  if (selectTimer !== null) clearTimeout(selectTimer);
  selectTimer = setTimeout(exitSelect, 45000);
}

function tapToggle(zoneId) {
  var now = Date.now();
  if (now - lastTap < 400) return;
  lastTap = now;
  toggleSelect(zoneId);
}

function toggleSelect(zoneId) {
  var zone = zoneOf(zoneId);
  if (zone === null) return;
  bumpSelectTimer();
  var at = selected.indexOf(zoneId);
  if (at !== -1) {
    selected.splice(at, 1);
  } else {
    var island = zoneIsland(zone);
    if (island === '') { say('Roon cannot group ' + zone.name + ' with anything'); return; }
    if (selected.length > 0) {
      var lead = zoneOf(selected[0]);
      // Roon will not group across its islands; refused HERE, before anything is sent.
      if (lead !== null && zoneIsland(lead) !== island) {
        say('Roon cannot group ' + zone.name + ' with ' + lead.name);
        return;
      }
    }
    selected.push(zoneId);
  }
  updateBar();
  var snap = store.snapshot();
  if (snap !== null) render(snap, 'snapshot');
}

/** Choose-mode dress for one tile: its number, or its refusal. Called by render. */
function applySelect(tile, zone) {
  var at = selected.indexOf(zone.id);
  if (at !== -1) {
    tile.node.className += ' is-picked';
    tile.check.textContent = String(at + 1);   // 1 is whose music plays
    return;
  }
  tile.check.textContent = '';
  var island = zoneIsland(zone);
  var lead = selected.length > 0 ? zoneOf(selected[0]) : null;
  var joinable = island !== '' && (lead === null || zoneIsland(lead) === island);
  if (!joinable) tile.node.className += ' sel-off';
}

function updateBar() {
  if (drag !== null && drag.armed) return;     // the drag owns the bar
  if (sayTimer !== null) return;               // a message is still being read
  if (!selectMode) { bar.hidden = true; return; }
  bar.hidden = false;

  var alive = [];
  for (var i = 0; i < selected.length; i += 1) if (zoneOf(selected[i]) !== null) alive.push(selected[i]);
  selected = alive;

  var lead = selected.length > 0 ? zoneOf(selected[0]) : null;
  var rooms = 0;
  for (var j = 0; j < selected.length; j += 1) {
    var zone = zoneOf(selected[j]);
    if (zone !== null) rooms += zone.outputs.length;
  }

  // Same measured rule as the drag hint: a group formed from a head that is not
  // playing lands stopped and stays that way until somebody presses play.
  var leadLive = lead !== null && (lead.state === 'playing' || lead.state === 'loading');
  if (lead === null) barHint.textContent = 'choose rooms to group — the first chosen leads';
  else if (selected.length === 1) {
    barHint.textContent = leadLive
      ? lead.name + ' leads — its music plays in every room you add'
      : lead.name + ' leads — it is not playing, so the group will be silent until you press play';
  } else {
    barHint.textContent = leadLive
      ? String(rooms) + ' rooms — ' + lead.name + '’s music plays in all of them'
      : String(rooms) + ' rooms — ' + lead.name + ' leads, silent until you press play';
  }

  var acts = [];
  if (selected.length >= 2) acts.push(doBtn('group ' + String(rooms) + ' rooms', formGroup));
  // One room chosen and it is already a group: the wall can take it apart too.
  if (selected.length === 1 && lead !== null && lead.outputs.length > 1) {
    acts.push(doBtn('ungroup', function () {
      post({ action: 'ungroup', zone: lead.id }).then(function (ok) {
        if (ok) { exitSelect(); say('ungrouped ' + lead.name); }
      });
    }));
  }
  acts.push(doBtn('cancel', exitSelect));
  barActs.replaceChildren.apply(barActs, acts);
}

function formGroup() {
  var ids = [];
  for (var i = 0; i < selected.length; i += 1) {
    var zone = zoneOf(selected[i]);
    if (zone === null) continue;
    // The FIRST chosen zone's outputs go first: Roon preserves the head's queue.
    for (var j = 0; j < zone.outputs.length; j += 1) ids.push(zone.outputs[j].id);
  }
  if (ids.length < 2) { updateBar(); return; }
  var lead = zoneOf(selected[0]);
  post({ action: 'group', outputs: ids }).then(function (ok) {
    if (ok) {
      exitSelect();
      say(lead === null ? 'grouped' : lead.name + '’s music now plays in ' + String(ids.length) + ' rooms');
    }
  });
}

/* ---- the drag itself ---- */

function point(event) {
  if (event.touches !== undefined) {
    var t = event.touches[0] || (event.changedTouches && event.changedTouches[0]);
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  return typeof event.clientX === 'number' ? { x: event.clientX, y: event.clientY } : null;
}

function startPress(event, src) {
  if (drag !== null) return;
  var isTouch = event.type === 'touchstart';
  if (!isTouch && Date.now() < mouseBlockUntil) return;   // the touch's mouse echo
  if (!isTouch && typeof event.button === 'number' && event.button !== 0) return;
  var tapOnly = selectMode;
  if (!tapOnly && src.kind === 'zone') {
    var zone = zoneOf(src.zoneId);
    if (zone === null || zoneIsland(zone) === '') return; // nothing to drag toward
  }
  var p = point(event);
  if (p === null) return;
  drag = {
    src: src, isTouch: isTouch, tapOnly: tapOnly, moved: false, armed: false,
    sx: p.x, sy: p.y, x: p.x, y: p.y, timer: null, over: null, valid: {}, ghost: null,
  };
  if (isTouch && !tapOnly) {
    drag.timer = setTimeout(function () {
      if (drag !== null && !drag.armed) armDrag();
    }, HOLD_MS);
  }
  bindDocs(isTouch);
  if (!isTouch) event.preventDefault();       // no text selection, no native link drag
}

function bindDocs(isTouch) {
  if (isTouch) {
    document.addEventListener('touchmove', docMove, { passive: false });
    document.addEventListener('touchend', docEnd);
    document.addEventListener('touchcancel', docCancel);
  } else {
    document.addEventListener('mousemove', docMove);
    document.addEventListener('mouseup', docEnd);
  }
}

function unbindDocs() {
  document.removeEventListener('touchmove', docMove);
  document.removeEventListener('touchend', docEnd);
  document.removeEventListener('touchcancel', docCancel);
  document.removeEventListener('mousemove', docMove);
  document.removeEventListener('mouseup', docEnd);
}

function cancelPress() {
  if (drag !== null && drag.timer !== null) clearTimeout(drag.timer);
  unbindDocs();
  drag = null;
}

function docMove(event) {
  if (drag === null) return;
  var p = point(event);
  if (p === null) return;
  drag.x = p.x; drag.y = p.y;
  var moved = Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy);
  if (drag.armed) {
    if (event.cancelable) event.preventDefault();  // the drag owns this touch now
    moveGhost();
    hover(hitZone(p.x, p.y));
    return;
  }
  if (drag.tapOnly) { if (moved > TOUCH_SLOP) drag.moved = true; return; }
  // Not yet armed: on touch, movement first means SCROLL and the hold is off;
  // with a mouse (or a pointer remote), movement is what arms the drag.
  if (drag.isTouch) { if (moved > TOUCH_SLOP) cancelPress(); return; }
  if (moved > MOVE_ARM) armDrag();
}

function docEnd(event) {
  if (drag === null) return;
  var d = drag;
  if (d.isTouch) mouseBlockUntil = Date.now() + 800;
  if (!d.armed) {
    var wasTap = d.tapOnly && !d.moved;
    cancelPress();
    if (wasTap) {
      if (event.cancelable) event.preventDefault();
      tapToggle(d.src.zoneId);
    }
    return;
  }
  squelchUntil = Date.now() + 600;
  finishDrag(d, d.over);
}

function docCancel() {
  if (drag === null) return;
  if (drag.armed) teardownDrag();
  else cancelPress();
}

function armDrag() {
  var src = drag.src;
  drag.armed = true;
  if (drag.timer !== null) { clearTimeout(drag.timer); drag.timer = null; }
  dragLock = true;
  root.classList.add('is-dragging');
  if (src.node) src.node.classList.add('chip-held');

  var srcZone = zoneOf(src.zoneId);
  var island = srcZone === null ? '' : zoneIsland(srcZone);
  var keys = Object.keys(tiles);
  for (var i = 0; i < keys.length; i += 1) {
    var node = tiles[keys[i]].node;
    if (keys[i] === src.zoneId) {
      node.classList.add(src.kind === 'member' ? 'drag-home' : 'drag-src');
      continue;
    }
    var zone = zoneOf(keys[i]);
    // Roon will not group across its islands: only a room in the SAME island
    // lights up, and the refusal is visible before the drop, not after it.
    var ok = src.kind === 'zone' && zone !== null && island !== '' && zoneIsland(zone) === island;
    if (ok) {
      drag.valid[keys[i]] = true;
      node.classList.add('drop-ok');
      // The room whose music would CONTINUE is marked apart from the rest.
      if (zone.state === 'playing' || zone.state === 'loading') node.classList.add('drop-live');
    } else {
      node.classList.add('drop-no');
    }
  }

  drag.ghost = el('div', 'wall-ghost', src.name);
  document.body.appendChild(drag.ghost);
  moveGhost();
  bar.hidden = false;
  barActs.replaceChildren();
  hover(hitZone(drag.x, drag.y));
}

function moveGhost() {
  if (drag === null || drag.ghost === null) return;
  drag.ghost.style.transform = 'translate(' + String(drag.x + 18) + 'px, ' + String(drag.y + 14) + 'px)';
}

function hitZone(x, y) {
  var node = document.elementFromPoint(x, y);
  if (node === null || node.closest === undefined) return null;
  var tile = node.closest('.tile');
  return tile === null ? null : tile.getAttribute('data-zone');
}

function hover(overId) {
  if (drag === null) return;
  if (overId !== drag.over) {
    if (drag.over !== null && tiles[drag.over] !== undefined) tiles[drag.over].node.classList.remove('drop-hot');
    if (overId !== null && drag.valid[overId] === true && tiles[overId] !== undefined) {
      tiles[overId].node.classList.add('drop-hot');
    }
    drag.over = overId;
  }
  barHint.textContent = dragHint(overId);
}

/** What a release RIGHT NOW would do — always said before the finger lifts. */
function dragHint(overId) {
  var src = drag.src;
  var srcZone = zoneOf(src.zoneId);
  if (src.kind === 'member') {
    var home = srcZone === null ? 'its group' : srcZone.name;
    if (overId === src.zoneId) return src.name + ' is in ' + home + ' — drag it away to take it out';
    return 'release: ' + src.name + ' leaves ' + home + ' — the other rooms keep playing';
  }
  if (overId !== null && drag.valid[overId] === true) {
    var target = zoneOf(overId);
    if (target !== null) {
      /**
       * ⚖️ MEASURED ON THE LIVE CORE, 08-27: Roon auto-plays a newly grouped zone
       * ONLY when its first output was already playing. Grouped from a PAUSED
       * head, the zone lands `stopped` with no now-playing at all and never
       * resumes on its own. (RHEOS proved the same thing on 08-18 across three
       * Downstairs cycles; the counter-example there was decisive.)
       *
       * So the promise has to depend on the target's state. Saying "Study's music
       * plays" over a paused Study would be a lie the viewer discovers by hearing
       * silence — the worst way to learn it.
       */
      var live = target.state === 'playing' || target.state === 'loading';
      var line = 'release: ' + src.name + ' joins ' + target.name
        + (live ? ' — ' + target.name + '’s music plays'
                : ' — ' + target.name + ' is not playing, so press play after');
      if (live && srcZone !== null && (srcZone.state === 'playing' || srcZone.state === 'loading')) {
        line += ' · ' + src.name + '’s stops';
      }
      return line;
    }
  }
  if (overId !== null && overId !== src.zoneId) {
    var other = zoneOf(overId);
    if (other !== null) return 'Roon cannot group ' + src.name + ' with ' + other.name;
  }
  var any = false;
  for (var id in drag.valid) { if (drag.valid[id] === true) { any = true; break; } }
  return any ? 'drop ' + src.name + ' on a lit room to group them'
             : 'no room on this wall can join ' + src.name;
}

function finishDrag(d, overId) {
  var src = d.src;
  var srcZone = zoneOf(src.zoneId);
  var action = null;
  if (src.kind === 'zone') {
    if (overId !== null && d.valid[overId] === true && srcZone !== null) {
      var target = zoneOf(overId);
      if (target !== null) {
        var ids = [];
        // THE DROP TARGET LEADS: its outputs go first, so Roon keeps ITS queue,
        // and the dragged room joins the music that was already playing there.
        for (var i = 0; i < target.outputs.length; i += 1) ids.push(target.outputs[i].id);
        for (var j = 0; j < srcZone.outputs.length; j += 1) ids.push(srcZone.outputs[j].id);
        action = { body: { action: 'group', outputs: ids }, said: src.name + ' joined ' + target.name };
      }
    }
  } else if (overId !== src.zoneId) {
    // Dropped anywhere out of its own tile: the member leaves, and ONLY the
    // member — one call, never dissolve-and-rebuild, so the rooms that were not
    // being changed never stop playing.
    action = {
      body: { action: 'ungroup', zone: src.zoneId, output: src.outputId },
      said: src.name + ' left ' + (srcZone === null ? 'the group' : srcZone.name),
    };
  }
  teardownDrag();
  if (action !== null) {
    post(action.body).then(function (ok) { if (ok) say(action.said); });
  }
}

function teardownDrag() {
  unbindDocs();
  if (drag !== null) {
    if (drag.timer !== null) clearTimeout(drag.timer);
    if (drag.ghost !== null && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (drag.src.node) drag.src.node.classList.remove('chip-held');
  }
  drag = null;
  root.classList.remove('is-dragging');
  var keys = Object.keys(tiles);
  for (var i = 0; i < keys.length; i += 1) {
    tiles[keys[i]].node.classList.remove('drop-ok', 'drop-no', 'drop-hot', 'drop-live', 'drag-src', 'drag-home');
  }
  dragLock = false;
  updateBar();
  var snap = deferredFrame !== null ? deferredFrame : store.snapshot();
  deferredFrame = null;
  if (snap !== null) render(snap, 'snapshot');
}

// The click the browser makes up after a drag must not open a face page.
document.addEventListener('click', function (event) {
  if (Date.now() < squelchUntil) { event.preventDefault(); event.stopPropagation(); }
}, true);

// A long touch on a tile is picking a room up, not asking for the link menu.
document.addEventListener('contextmenu', function (event) {
  if (drag !== null) event.preventDefault();
});

// Escape lets go: of a drag in flight (a member drag would otherwise commit
// anywhere but home), and of choose mode.
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  if (drag !== null) { if (drag.armed) teardownDrag(); else cancelPress(); return; }
  if (selectMode) exitSelect();
});

var store = createStore(render);
store.hydrate();
var streamState = 'live';
createStream(store, function (state) {
  streamState = state;
  // Restore the truth on heal: a late error frame from the dead socket used to
  // leave "catching up" on screen after the data was already live again.
  if (state === 'catching-up') { coreEl.textContent = 'catching up…'; coreEl.className = 'wall-core away'; }
  else { var snap = store.snapshot(); if (snap !== null) render(snap, 'snapshot'); }
});

// Repaint at a low rate so interpolated progress moves smoothly between frames
// without ever rebuilding the DOM.
setInterval(function () {
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'seek');
}, 500);
