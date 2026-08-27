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
 * The server orders and counts the islands; the names come with them. Roon says
 * nothing about what a set of outputs IS — no protocol field, no MAC, and
 * `source_controls` names the device, not the transport — so an island shows the
 * name a person gave it, and only falls back to naming itself by its members.
 */
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
    /**
     * An unnamed island is TYPE N, not the first device in it. Roon does give us
     * the types — the partition is exactly that — it just does not say what any
     * of them IS (Peter, 08-26: "so we basically know they can be type 1, 2, 3").
     * Naming one after a member was arbitrary: it made the Squeezebox family look
     * like it was called Cobalt. A number claims nothing, and asks to be named.
     */
    list.push({
      id: islands[j].id,
      count: islands[j].count,
      members: names,
      named: islands[j].label !== null,
      label: islands[j].label !== null ? islands[j].label
        : 'type ' + String(j + 1),
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
      if (!island.named) {
        node.className += ' unnamed';
        // what is in it, for anyone wondering which type this is
        node.setAttribute('title', String(island.count) + ' rooms: ' + island.members.join(' · '));
      }
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

function buildTile(zone) {
  var tile = el('a', 'tile');
  tile.href = '/face/' + encodeURIComponent(zone.id);
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
  var rule = el('div', 'tile-rule');
  var fill = el('i');
  rule.appendChild(fill);
  copy.appendChild(zoneLine); copy.appendChild(title); copy.appendChild(line2); copy.appendChild(rule);
  var meta = el('div', 'tile-meta');
  var stamp = el('div', 'tile-stamp');
  var state = el('div', 'tile-state');
  var times = el('div', 'tile-times');
  meta.appendChild(state); meta.appendChild(times); meta.appendChild(stamp);
  tile.appendChild(art); tile.appendChild(copy); tile.appendChild(meta);
  return {
    node: tile, img: img, name: name, zoneLine: zoneLine, title: title,
    line2: line2, fill: fill, stamp: stamp, state: state, times: times,
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
  var wanted = zone.outputs.length > 1 ? zone.outputs.slice(1).map(function (o) { return o.name; }) : [];
  if (wanted.join('|') === tile.chips.join('|')) return;
  for (var i = 0; i < tile.chips.length; i += 1) {
    var existing = tile.zoneLine.querySelector('.chip');
    if (existing) tile.zoneLine.removeChild(existing);
  }
  tile.chips = wanted;
  for (var j = 0; j < wanted.length; j += 1) tile.zoneLine.appendChild(el('span', 'chip', wanted[j]));
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
    root.setAttribute('data-density', count > 20 ? 'packed' : (count > 9 ? 'dense' : 'roomy'));

    var nextOrder = [];
    for (var i = 0; i < shown.length; i += 1) {
      var zone = shown[i];
      var tile = tiles[zone.id];
      if (tile === undefined) { tile = buildTile(zone); tiles[zone.id] = tile; }
      var isHero = i === 0 && (zone.state === 'playing' || zone.state === 'loading');
      tile.node.className = classFor(zone, isHero) + (snapshot.zones.length <= 3 ? ' solo' : '');
      tile.name.textContent = zone.name;
      setChips(tile, zone);
      var np = zone.nowPlaying;
      tile.title.textContent = np ? np.title : 'nothing played yet';
      tile.line2.textContent = np ? np.line2 : '';
      tile.stamp.textContent = stampFor(zone, now);
      tile.state.textContent = zone.state === 'loading' ? 'loading'
        : (zone.state === 'playing' ? '' : zone.state);
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
      atile.times.textContent = formatTime(position) + ' / ' + formatTime(length);
    } else {
      atile.fill.style.width = '0';
      atile.times.textContent = '';
    }
  }
}

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
