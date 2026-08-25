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

/**
 * A wall shows the zones worth looking at, not every zone that exists. Because
 * the order is most-recently-played, the cap curates itself: the rooms in use
 * are the rooms on screen, and a room silent for a week does not need a tile.
 *
 * The remainder becomes one quiet line rather than a second page — a TV is
 * driven by a remote from a sofa, and a wall nobody has to operate is the point.
 * Override per screen with ?zones=N (0 for all).
 */
var MAX_TILES = 16;
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

    // Fit the house into the screen: a TV cannot scroll, so shown zones are capped
    // and density scales with what is left.
    var shown = MAX_TILES === 0 ? snapshot.zones : snapshot.zones.slice(0, MAX_TILES);
    var overflow = snapshot.zones.slice(shown.length);
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
