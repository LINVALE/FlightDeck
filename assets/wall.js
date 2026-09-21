import './compat.js';
import { startPuckStatus } from './puck-status.js';
import { createScreensaver } from './screensaver.js';
import { createDisplayCare, createWakePolicy } from './display-care.js';
import { standbyTargets, standbyReviewed } from './wall-power.js';
import { startController, controllerPreview, controllerVolume } from './controller-link.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { seekTargetSecond } from './seek-target.js';
import { alphabeticalWallZones, applyWallSlotOrder, inheritWallOrder, joinedPreviousZones, wallOutputOwners, wallSlot } from './wall-order.js';
import { decideUi } from './screen-shape.js';
import { limitsOf, bandsOf, bandAtFraction, askedLevel, askedSteps, createDoubleTap } from './volume-limits.js';

/** A second press on the same room's scale inside the window: the hand means above comfort. */
var volumeTaps = createDoubleTap(700);

/**
 * ⚖️ A PHONE GETS THE PHONE WALL (Peter, 09-06). This page is a television's:
 * four columns of cards sized in vw. Held in a hand it is the wrong page, so a
 * phone-shaped screen is sent to /phone before anything is built — decided by
 * the short side and the pointer, never the user agent, and overridable with
 * ?ui=tv for comparing designs (screen-shape.js).
 */
var storageOrNull = null;
try { storageOrNull = window.localStorage; } catch (e) { storageOrNull = null; }
if (decideUi(window, location.search, storageOrNull) === 'phone') location.replace('/phone');

/**
 * The House Wall. Rooms are alphabetical until somebody deliberately saves a
 * screen-local order. Playback state is shown by tile SIZE and by the copy —
 * never by moving a zone, so starting music never reshuffles the room.
 *
 * DOM is bounded: tiles are reused by zone id and never re-created per tick (R7).
 */

var root = document.getElementById('wall');
var wallCare = createDisplayCare(root, storageOrNull, 'flightdeck.wall-care');
var wallBlanker = createScreensaver(wallCare, function () {
  var snapshot = typeof store === 'undefined' ? null : store.snapshot();
  return !!(wallCare.prefs.blankOnlySilent && snapshot && snapshot.core.state === 'paired' && snapshot.zones.some(function (zone) { return zone.state === 'playing' || zone.state === 'loading'; }));
}, function () { wallCare.wake(); }, function () { closeWallPanel(false); });
var wallWakePolicy = createWakePolicy(function () { return navigator.wakeLock.request('screen'); });
function keepWallAwake() {
  if (typeof store === 'undefined' || !navigator.wakeLock || !window.isSecureContext) return;
  wallWakePolicy.update(!document.hidden && !wallBlanker.asleep());
}
setInterval(keepWallAwake, 1000);
document.addEventListener('visibilitychange', keepWallAwake);
var grid = document.getElementById('grid');
var startupEl = document.getElementById('wall-startup');
var summaryEl = document.getElementById('summary');
var coreEl = document.getElementById('core');
var tiles = {};
var order = [];
var orderSlots = [];
var previousOutputOwners = {};
var topologyHoldSlots = [];
var lastTopology = null;
var tabsEl = document.getElementById('tabs');
var startupReady = false;
var startupExpected = null;
var startupDeadlineTimer = null;
var startupStartedAt = Date.now();

/** Reveal one composed Wall, not thirteen cards arriving one after another. */
function finishStartup() {
  if (startupReady) return;
  var remaining = 420 - (Date.now() - startupStartedAt);
  if (remaining > 0) { setTimeout(finishStartup, remaining); return; }
  startupReady = true;
  if (startupDeadlineTimer !== null) clearTimeout(startupDeadlineTimer);
  startupDeadlineTimer = null;
  root.classList.add('is-ready');
  if (startupEl !== null) startupEl.setAttribute('aria-hidden', 'true');
}

function settleStartup() {
  if (startupReady || startupExpected === null) return;
  for (var i = 0; i < startupExpected.length; i += 1) {
    var tile = tiles[startupExpected[i]];
    if (tile === undefined || !tile.artReady) return;
  }
  finishStartup();
}

function prepareStartup(zones) {
  if (startupReady) return;
  startupExpected = [];
  for (var i = 0; i < zones.length; i += 1) startupExpected.push(zones[i].id);
  if (startupDeadlineTimer === null) startupDeadlineTimer = setTimeout(finishStartup, 2600);
  settleStartup();
}

function resetWallOrder() {
  order = [];
  orderSlots = [];
  previousOutputOwners = {};
  topologyHoldSlots = [];
  lastTopology = null;
}

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
var manualOrders = {};
try {
  var savedOrders = JSON.parse(localStorage.getItem('flightdeck.wall-orders') || '{}');
  if (savedOrders !== null && typeof savedOrders === 'object') manualOrders = savedOrders;
} catch (e) { manualOrders = {}; }
var hiddenSlots = [];
try {
  var savedHidden = JSON.parse(localStorage.getItem('flightdeck.wall-hidden') || '[]');
  if (Array.isArray(savedHidden)) hiddenSlots = savedHidden;
} catch (e) { hiddenSlots = []; }
var showHiddenMode = false;

function wallOrderScope() { return activeIsland === '' ? 'all' : activeIsland; }
function isHiddenZone(zone) { return hiddenSlots.indexOf(wallSlot(zone)) !== -1; }
function persistHidden() {
  try { localStorage.setItem('flightdeck.wall-hidden', JSON.stringify(hiddenSlots)); } catch (e) { /* private window */ }
}
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
    // The registry deliberately remembers a device family after every member
    // has gone to sleep. That history is useful to the server, but an empty Wall
    // tab is not a destination. Stopped rooms still count; only families with no
    // zone in the live snapshot are omitted.
    if (names.length === 0) continue;
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

/**
 * ⚖️ THE RESTING SCREEN (Peter, 09-05: "centre the information and design a
 * nice logo for the centre — simple, elegant, in keeping with Roon / Rheos
 * branding"). The mark is FlightDeck's own — the dial the app icon already
 * wears: a dark disc, a gold three-quarter arc from half past ten round to
 * five, and the gold hub with its dark centre — drawn as line-work so it is
 * crisp at any size, in the Wall's own ink and accent. Under it the wordmark,
 * then the one fact this screen exists to say, and what to do about it.
 */
function flightDeckMark() {
  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'empty-mark');
  svg.setAttribute('aria-hidden', 'true');
  var disc = document.createElementNS(ns, 'circle');
  disc.setAttribute('cx', '50'); disc.setAttribute('cy', '50'); disc.setAttribute('r', '48');
  disc.setAttribute('fill', '#0b0c0e'); disc.setAttribute('stroke', 'rgba(232,227,216,.10)'); disc.setAttribute('stroke-width', '1');
  svg.appendChild(disc);
  var arc = document.createElementNS(ns, 'path');
  // half past ten, clockwise over the top and down the right, to five o'clock
  arc.setAttribute('d', 'M 24.5 24.5 A 36 36 0 1 1 68 81.2');
  arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', '#d8a24a'); arc.setAttribute('stroke-width', '9');
  svg.appendChild(arc);
  var hub = document.createElementNS(ns, 'circle');
  hub.setAttribute('cx', '50'); hub.setAttribute('cy', '50'); hub.setAttribute('r', '17'); hub.setAttribute('fill', '#e8c77a');
  svg.appendChild(hub);
  var eye = document.createElementNS(ns, 'circle');
  eye.setAttribute('cx', '50'); eye.setAttribute('cy', '50'); eye.setAttribute('r', '5.5'); eye.setAttribute('fill', '#0b0c0e');
  svg.appendChild(eye);
  return svg;
}

function emptyState() {
  var node = el('div', 'empty');
  node.setAttribute('role', 'status');
  node.appendChild(flightDeckMark());
  var brand = el('div', 'empty-brand', 'FLIGHT');
  brand.appendChild(el('span', '', 'DECK'));
  node.appendChild(brand);
  node.appendChild(el('div', 'empty-title', 'No Roon zones yet'));
  node.appendChild(el('div', 'empty-copy', 'Enable a zone in Roon and it will appear here.'));
  return node;
}

function drawTabs(islands, total, hiddenCount) {
  var key = islands.map(function (i) { return i.id + ':' + String(i.count) + ':' + i.label; }).join('|')
    + '#' + activeIsland + '#' + String(hiddenCount) + '#' + String(showHiddenMode);
  if (key === tabsKey) return;
  tabsKey = key;
  if (islands.length < 2 && hiddenCount === 0) { tabsEl.hidden = true; tabsEl.replaceChildren(); return; }
  tabsEl.hidden = false;
  var nodes = [];
  var tab = function (id, label) {
    var node = el('span', !showHiddenMode && activeIsland === id ? 'wall-tab now' : 'wall-tab', label);
    node.addEventListener('click', function () {
      if (node.className.indexOf('asleep') >= 0) return;   // nothing awake to show
      if (reorderMode) finishReorder();
      showHiddenMode = false;
      activeIsland = id;
      try { localStorage.setItem('flightdeck.island', id); } catch (e) { /* private window */ }
      tabsKey = '';
      resetWallOrder();                  // a deliberate switch may reorder freely
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
  if (hiddenCount > 0) {
    var hiddenTab = el('span', showHiddenMode ? 'wall-tab now' : 'wall-tab', 'hidden  ' + String(hiddenCount));
    hiddenTab.insertBefore(glyph('minimize'), hiddenTab.firstChild);
    hiddenTab.setAttribute('title', 'show hidden room cards');
    hiddenTab.addEventListener('click', function () {
      if (reorderMode) finishReorder();
      showHiddenMode = true;
      tabsKey = '';
      resetWallOrder();
      var snap = store.snapshot();
      if (snap !== null) render(snap, 'snapshot');
    });
    nodes.push(hiddenTab);
  }
  tabsEl.replaceChildren.apply(tabsEl, nodes);
}

/**
 * HOLDING YOUR PLACE.
 *
 * Playback state never owns layout. The default is alphabetical; an explicit
 * Reorder mode stores durable leader-output slots for this screen and family.
 * A topology successor still inherits its leader's slot when there is no saved
 * order, so forming a group does not throw the user's place away.
 */
function holdOrder(zones) {
  var alphabetical = alphabeticalWallZones(zones);
  var scope = wallOrderScope();
  var saved = manualOrders[scope];
  if (reorderMode && draftOrderScope === scope) return applyWallSlotOrder(alphabetical, draftSlots);
  if (Array.isArray(saved)) return applyWallSlotOrder(alphabetical, saved);

  var parts = [];
  for (var i = 0; i < zones.length; i += 1) {
    var outputs = [];
    for (var o = 0; o < zones[i].outputs.length; o += 1) outputs.push(zones[i].outputs[o].id);
    parts.push(zones[i].id + ':' + zones[i].name.toLowerCase() + ':' + outputs.join(','));
  }
  var signature = parts.sort().join('|');
  var changed = lastTopology === null || signature !== lastTopology || order.length === 0;
  var joined = joinedPreviousZones(zones, previousOutputOwners);
  lastTopology = signature;
  if (changed && joined) {
    var inherited = inheritWallOrder(alphabetical, order, orderSlots);
    topologyHoldSlots = inherited.map(wallSlot);
    return inherited;
  }
  if (changed) topologyHoldSlots = [];
  return topologyHoldSlots.length > 0
    ? applyWallSlotOrder(alphabetical, topologyHoldSlots)
    : alphabetical;
}

/**
 * A wall shows the zones worth looking at, not every zone that exists. A cap is
 * optional; alphabetical or explicitly saved order owns the visible sequence.
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
    pause: 'M8 5.5h3.1v13H8zm5 0h3.1v13H13z',
    speaker: 'M4 9.5h3.4L12 5.4v13.2L7.4 14.5H4z',
    info: 'M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8zm-1.05 5.05h2.1v2.1h-2.1zm0 3.4h2.1v5.2h-2.1z'
  }[name];
  if (d !== undefined) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }
  // the two stroked marks: a chain for group, a box-and-arrow for send-to
  var strokes = {
    faders: ['M6 4v16', 'M12 4v16', 'M18 4v16', 'M3 9h6', 'M9 15h6', 'M15 7h6'],
    group: ['M10.2 13.8a3.7 3.7 0 0 0 5.2 0l3.3-3.3a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4',
            'M13.8 10.2a3.7 3.7 0 0 0-5.2 0l-3.3 3.3a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4'],
    groupall: ['M6.5 4.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4',
               'M6.5 15.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4',
               'M17.5 10a2 2 0 1 1 0 4a2 2 0 1 1 0-4',
               'M8.2 7.4l7.6 3.8', 'M8.2 16.6l7.6-3.8'],
    ungroupall: ['M6.5 4.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4',
                 'M6.5 15.5a2 2 0 1 1 0 4a2 2 0 1 1 0-4',
                 'M17.5 10a2 2 0 1 1 0 4a2 2 0 1 1 0-4',
                 'M8.2 7.4l7.6 3.8', 'M8.2 16.6l7.6-3.8', 'M4 4l16 16'],
    chevron: ['M6 9l6 6 6-6'],
    queue: ['M4 5h12','M4 10h12','M4 15h7','M15 14l6 4-6 4z'],
    reorder: ['M5 7h14', 'M16 4l3 3-3 3', 'M19 17H5', 'M8 14l-3 3 3 3'],
    minimize: ['M5 17h14', 'M8 10l4 4 4-4'],
    restore: ['M5 17h14', 'M8 13l4-4 4 4'],
    send: ['M12.6 5.5H6.4A1.9 1.9 0 0 0 4.5 7.4v9.2a1.9 1.9 0 0 0 1.9 1.9h6.2',
           'M10.8 12h9.1', 'M16.8 8.7 20.3 12l-3.5 3.3'],
    pull: ['M11.4 5.5h6.2a1.9 1.9 0 0 1 1.9 1.9v9.2a1.9 1.9 0 0 1-1.9 1.9h-6.2',
           'M3.7 12h9.5', 'M9.7 8.7 13.2 12l-3.5 3.3'],
    ungroup: ['M10.2 13.8a3.7 3.7 0 0 0 5.2 0l3.3-3.3a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4',
              'M13.8 10.2a3.7 3.7 0 0 0-5.2 0l-3.3 3.3a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4',
              'M5 5l14 14'],
    shuffle: ['M3.6 7.5h2.7c1.8 0 2.9 1.2 3.9 2.8l2.2 3.4c1 1.6 2.1 2.8 3.9 2.8h3.2',
              'M3.6 16.5h2.7c1.8 0 2.9-1.2 3.9-2.8l2.2-3.4c1-1.6 2.1-2.8 3.9-2.8h3.2',
              'M18.2 5.6 20.6 7.5 18.2 9.4', 'M18.2 14.6 20.6 16.5 18.2 18.4'],
    repeat: ['M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14', 'M16 13.8 18 16 20 13.8',
             'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10', 'M4 10.2 6 8 8 10.2'],
    'repeat-one': ['M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14', 'M16 13.8 18 16 20 13.8',
                   'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10', 'M4 10.2 6 8 8 10.2',
                   'M11 11.2 12.6 10.2V14']
  }[name] || [];
  var groupingMark = name === 'group' || name === 'groupall'
    || name === 'ungroup' || name === 'ungroupall';
  for (var i = 0; i < strokes.length; i += 1) {
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', strokes[i]);
    line.setAttribute('fill', 'none');
    // Chromium 63 can lose inherited `currentColor` on a dynamically-created
    // stroked SVG. Grouping is too important to become a blank button, so those
    // marks own a bright explicit stroke; the others retain their colour states.
    line.setAttribute('stroke', groupingMark ? '#f2eee6' : 'currentColor');
    line.setAttribute('stroke-width', groupingMark ? '2.15' : '1.7');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);
  }
  return svg;
}

function buildTile(zone) {
  var zoneId = zone.id;
  var faceId = zone.outputs.length > 0 ? zone.outputs[0].id : zoneId;
  var tile = el('article', 'tile');
  // A Roon zone id is disposable. The leader output is the durable room that
  // the card represents, so the link still reaches that room after topology
  // changes between the Wall frame and the click.
  var faceHref = '/face/' + encodeURIComponent(faceId);
  tile.setAttribute('data-zone', zoneId);
  var check = el('span', 'tile-check');
  tile.appendChild(check);
  tile.addEventListener('mousedown', function (event) {
    if (event.target === name || zoneLine.contains(event.target)) startPress(event, { kind: 'zone', zoneId: zoneId, name: name.textContent });
  });
  tile.addEventListener('touchstart', function (event) {
    if (event.target === name || zoneLine.contains(event.target)) startPress(event, { kind: 'zone', zoneId: zoneId, name: name.textContent });
  }, { passive: true });
  tile.addEventListener('click', function (event) {
    if (Date.now() < squelchUntil) { event.preventDefault(); event.stopPropagation(); return; }
    if (activateTile(zoneId)) {
      event.preventDefault(); event.stopPropagation();
    } else if (zoneLine.contains(event.target)) {
      openWallTools(zoneId, toolsB);
    }
  });

  /** A press on any control inside the card must never also follow it to the Face. */
  var quiet = function (node, run) {
    var last = 0;
    if (node.tagName === 'SPAN') { node.tabIndex = 0; node.setAttribute('role', node.classList.contains('tile-rule')?'slider':'button'); node.addEventListener('keydown', function(e) { if(!node.classList.contains('tile-rule') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); node.click(); } }); }
    node.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      if (drag !== null && drag.armed) return;
      var now = Date.now();
      if (now - last < 350) return;
      last = now;
      run(event);
    });
    node.addEventListener('mousedown', function (event) { event.stopPropagation(); });
    node.addEventListener('touchstart', function (event) { event.stopPropagation(); }, { passive: true });
    return node;
  };

  /* ── the head: room, its family, its members, and how long ago ──────────── */
  var head = el('div', 'tile-head');
  var zoneLine = el('div', 'tile-zone');
  var statusDot = el('span', 'tile-status-dot');
  statusDot.setAttribute('role', 'img');
  zoneLine.appendChild(statusDot);
  var name = el('span', '', zone.name);
  zoneLine.appendChild(name);
  zoneLine.tabIndex=0;zoneLine.setAttribute('role','button');zoneLine.setAttribute('title','Drag to group; use Reorder to move cards');
  zoneLine.addEventListener('keydown',function(e){
    if(reorderMode&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();e.stopPropagation();moveWallRoom(zoneId,e.key==='ArrowLeft'?-1:1);return;}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!activateTile(zoneId))openWallTools(zoneId,toolsB);}
  });
  var stamp = el('div', 'tile-stamp');
  var hideB = quiet(el('span', 'tile-hide'), function () { toggleHidden(zoneId); });
  hideB.appendChild(glyph('minimize'));
  hideB.setAttribute('title', 'hide ' + zone.name + ' from this wall');
  hideB.setAttribute('aria-label', 'hide ' + zone.name + ' from this wall');
  head.appendChild(zoneLine); head.appendChild(stamp); head.appendChild(hideB);

  /* ── the art, with the music and the transport beside it ────────────────── */
  var now = el('div', 'tile-now');
  var art = el('a', 'tile-art');
  art.href = faceHref;
  art.setAttribute('aria-label', 'Open ' + zone.name);
  art.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  art.addEventListener('touchstart', function(e) { e.stopPropagation(); }, {passive:true});
  var img = document.createElement('img');
  img.alt = '';
  art.appendChild(img);
  var copy = el('div', 'tile-copy');
  var title = el('div', 'tile-title');
  var line2 = el('div', 'tile-line2');
  var line3 = el('div', 'tile-line3');
  var transport = el('div', 'tile-transport');
  var act = function (mark, label, action) {
    var b = el('button', 'tt');
    b.type = 'button';
    b.appendChild(glyph(mark));
    b.setAttribute('title', label);
    b.setAttribute('aria-label', label + ' \u00B7 ' + zone.name);
    return quiet(b, function () { post({ action: action, zone: zoneId }); });
  };
  /**
   * Shuffle and repeat BRACKET the transport, first and last (Peter, 08-28) —
   * the same arrangement the Face uses, for the same reason: they say how the
   * queue will be read rather than moving through it, so they belong at the ends
   * rather than among play and skip.
   */
  var shufB = act('shuffle', 'shuffle', 'shuffle');
  var prevB = act('prev', 'previous', 'previous');
  var playB = act('play', 'play', 'playpause');
  playB.className = 'tt play';        // the one you reach for is the one you can hit
  var nextB = act('next', 'next', 'next');
  var repB = act('repeat', 'repeat', 'repeat');
  transport.appendChild(shufB); transport.appendChild(prevB); transport.appendChild(playB);
  transport.appendChild(nextB); transport.appendChild(repB);
  copy.appendChild(title); copy.appendChild(line2); copy.appendChild(line3);
  now.appendChild(art); now.appendChild(copy);

  /* ── two bars, each the full width of the card, each with its reading ───── */
  var progress = el('div', 'tile-bar-line tile-progress-line');
  var elapsed = el('span', 'tile-t');
  var rule = el('span', 'tile-rule');
  var fill = el('i');
  rule.appendChild(fill);
  rule.setAttribute('title', 'press to seek');
  rule.setAttribute('aria-label', 'seek in ' + zone.name);
  quiet(rule, function (event) {
    var current = zoneOf(zoneId);
    if (current === null || current.nowPlaying === null || !current.allowed.seek) return;
    var length = current.nowPlaying.lengthSec;
    var box = rule.getBoundingClientRect();
    if (box.width <= 0) return;
    var fraction = (event.clientX - box.left) / box.width;
    var seconds = seekTargetSecond(fraction, length);
    if (seconds !== null) post({ action: 'seek', zone: current.id, seconds: seconds });
  });
  rule.addEventListener('keydown',function(e){
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
    e.preventDefault();e.stopPropagation();var z=zoneOf(zoneId);
    if(!z||!z.nowPlaying||!z.allowed.seek||!(z.nowPlaying.lengthSec>0))return;
    var seconds=seekTargetSecond(((store.positionSec(z)||0)+(e.key==='ArrowRight'?5:-5))/z.nowPlaying.lengthSec,z.nowPlaying.lengthSec);
    if(seconds!==null)post({action:'seek',zone:z.id,seconds:seconds});
  });
  var segments = el('span', 'art-progress');
  segments.setAttribute('aria-hidden', 'true');
  var progressSegments = [];
  for(var ps=0;ps<80;ps++) { var tick=el('i'); segments.appendChild(tick); progressSegments.push(tick); }
  rule.appendChild(segments);
  var total = el('span', 'tile-t total');
  progress.appendChild(elapsed); progress.appendChild(rule); progress.appendChild(total);

  var volLine = el('div', 'tile-bar-line tile-volume-line');
  var volMark = el('span', 'tile-vol-mark');
  volMark.appendChild(glyph('speaker'));
  volMark.setAttribute('title', 'mute');
  volMark.setAttribute('aria-label', 'mute ' + zone.name);
  quiet(volMark, function () {
    var body = muteCommand(zoneId);
    if (body !== null) post(body);
  });
  var volBar = el('span', 'tile-rule vol');
  var volSegments = [];
  // Presence uses 44 narrow runway lamps. The Wall speaks the same visual
  // language, so a small level change changes one tick rather than a whole bar.
  for (var vs = 0; vs < 44; vs += 1) {
    var segment = el('i');
    volSegments.push(segment);
    volBar.appendChild(segment);
  }
  volBar.setAttribute('role','slider');volBar.setAttribute('aria-label','Volume for '+zone.name);volBar.setAttribute('aria-valuemin','0');volBar.setAttribute('aria-valuemax','100');
  volBar.addEventListener('keydown',function(e){
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
    e.preventDefault();e.stopPropagation();var z=zoneOf(zoneId),v=z?volumeLevel(z):null;if(v===null)return;
    var up=e.key==='ArrowRight'||e.key==='ArrowUp';var asked=volumeCommand(zoneId,Math.max(0,Math.min(1,v.level+(up ? .02 : -.02))),false);if(asked!==null)post(asked.body);
  });
  var volNum = el('span', 'tile-t total');
  quiet(volBar, function (event) {
    var box = volBar.getBoundingClientRect();
    if (box.width <= 0) return;
    var want = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    // ⚖️ ROON'S TWO LIMITS (Peter, 09-06): a press is held at the comfort level;
    // a second press inside the window passes it; nothing passes safety.
    var twice = volumeTaps.press(zoneId, Date.now());
    var asked = volumeCommand(zoneId, want, twice);
    if (asked === null) return;                                // above safety: the room does not respond
    var vl = volumeLevel(zoneOf(zoneId) || { outputs: [] });
    paintVolumeSegments(volSegments, asked.shown, false, vl === null ? null : vl.bands);   // answer the press at once
    volNum.textContent = String(Math.round(asked.shown * 100));
    // ⚖️ Press to position, never drag (Peter, 08-28). One grammar with the Face.
    post(asked.body);
  });
  function stepVolume(direction) {
    var z=zoneOf(zoneId), level=z?volumeLevel(z):null;if(level===null)return;
    var twice=volumeTaps.press(zoneId,Date.now());
    var asked=volumeCommand(zoneId,Math.max(0,Math.min(1,level.level+direction*.02)),direction>0&&twice);
    if(asked===null)return;
    paintVolumeSegments(volSegments,asked.shown,false,level.bands);
    volNum.textContent=String(Math.round(asked.shown*100));
    post(asked.body);
  }
  var volDown=quiet(el('button','tile-volume-step volume-down','−'),function(){stepVolume(-1);});
  var volUp=quiet(el('button','tile-volume-step volume-up','+'),function(){stepVolume(1);});
  volDown.type='button';volUp.type='button';
  volDown.setAttribute('aria-label','Lower volume in '+zone.name);volDown.title='Lower volume';
  volUp.setAttribute('aria-label','Raise volume in '+zone.name);volUp.title='Raise volume';
  var membersB = quiet(el('button', 'tile-header-action tile-members'), function () { openWallMembers(zoneId, membersB); });
  membersB.type = 'button'; membersB.appendChild(glyph('faders'));
  membersB.setAttribute('aria-label', 'Individual player volumes and mutes for ' + zone.name);
  membersB.setAttribute('title', 'Individual player volumes and mutes');
  membersB.setAttribute('aria-haspopup', 'dialog'); membersB.setAttribute('aria-expanded', 'false');
  membersB.hidden = zone.outputs.length < 2;
  volLine.appendChild(volMark);volLine.appendChild(volDown);volLine.appendChild(volBar);volLine.appendChild(volUp);volLine.appendChild(volNum);volLine.appendChild(membersB);

  /* ── and what to do with the room, along the bottom ─────────────────────── */
  var actions = el('div', 'tile-actions');
  var left = el('div', 'ta-left');
  var groupB = quiet(el('span', 'ta'), function () { beginGroupFrom(zoneId); });
  groupB.appendChild(glyph('group'));
  groupB.setAttribute('title', 'group ' + zone.name + ' with another room');
  var ungroupB = quiet(el('span', 'ta ungroup'), function () {
    post({ action: 'ungroup', zone: zoneId });
  });
  ungroupB.appendChild(glyph('ungroup'));
  ungroupB.setAttribute('title', 'ungroup ' + zone.name);
  ungroupB.setAttribute('aria-label', 'ungroup ' + zone.name);
  ungroupB.hidden = true;
  var sendB = quiet(el('span', 'ta'), function () { beginSendFrom(zoneId); });
  sendB.appendChild(glyph('send'));
  sendB.setAttribute('title', 'send what is playing here to another room');
  sendB.setAttribute('aria-label', 'send from ' + zone.name + ' to another room');
  var pullB = quiet(el('span', 'ta'), function () { beginPullInto(zoneId); });
  pullB.appendChild(glyph('pull'));
  pullB.setAttribute('title', 'pull music from a player with content into ' + zone.name);
  pullB.setAttribute('aria-label', 'pull music from a player with content into ' + zone.name);
  left.appendChild(groupB); left.appendChild(ungroupB); left.appendChild(sendB); left.appendChild(pullB);

  /** The room's own details — what it actually is, which Roon never says aloud. */
  var detail = el('div', 'tile-detail');
  detail.hidden = true;
  var infoB = quiet(el('span', 'ta'), function () {
    detail.hidden = !detail.hidden;
    infoB.className = detail.hidden ? 'ta' : 'ta now';
  });
  infoB.appendChild(glyph('info'));
  infoB.setAttribute('title', 'what this room is');
  /**
   * ⚖️ OPEN AS — the Wall is the only place that knows the other clients exist.
   *
   * /phone shipped and was never once seen, because nothing links to it; /puck
   * would have gone the same way. The Wall is where a phone sets up the screen
   * it is standing next to, so this is where the three of them belong.
   *
   * ⚠️ These are SPANS that navigate, not anchors: the card is itself an <a>,
   * and a nested anchor is invalid HTML that browsers resolve however they like.
   *
   * Face and Puck take the durable OUTPUT — it survives the regrouping that
   * disposes of a zone id. The phone route resolves zones, so it takes the id.
   */
  var openAs = el('div', 'tile-openas');
  openAs.hidden = true;
  var openWay = function (label, href) {
    var node = quiet(el('span', 'oa', label), function () { window.location.href = href; });
    node.setAttribute('title', 'open ' + zone.name + ' as ' + label);
    return node;
  };
  openAs.appendChild(openWay('Face', '/face/' + encodeURIComponent(faceId)));
  openAs.appendChild(openWay('Phone', '/phone/' + encodeURIComponent(zoneId)));
  openAs.appendChild(openWay('Puck', '/puck/' + encodeURIComponent(faceId)));
  // A word, not a glyph: "open as" has no evident picture, and the rule is that
  // an icon only replaces a word when the meaning is obvious (Peter, 08-26).
  var openB = quiet(el('span', 'ta oa-mark', 'open as'), function () {
    openAs.hidden = !openAs.hidden;
    openB.className = openAs.hidden ? 'ta oa-mark' : 'ta oa-mark now';
  });
  openB.setAttribute('title', 'open ' + zone.name + ' on this screen as a Face, Phone or Puck');

  var state = el('div', 'tile-state');
  actions.appendChild(left); actions.appendChild(state);
  actions.appendChild(openB); actions.appendChild(infoB);

  var body = el('div', 'tile-body');
  // Rare-action nodes retain their handlers; the three primary rows stay visible.
  var drawer = el('div', 'tile-drawer');
  drawer.appendChild(transport); drawer.appendChild(volLine);
  drawer.appendChild(actions); drawer.appendChild(openAs); drawer.appendChild(detail);
  var levels = el('div', 'tile-levels' + (zone.outputs.length > 1 ? ' has-members' : ''));levels.appendChild(progress);levels.appendChild(volLine);
  body.appendChild(now);body.appendChild(transport);body.appendChild(levels);
  var queueB=quiet(el('button','tile-header-action'),function(){openWallQueue(zoneId,queueB);});
  queueB.type='button';queueB.appendChild(glyph('queue'));queueB.setAttribute('aria-label','Queue for '+zone.name);queueB.setAttribute('title','Queue');queueB.setAttribute('aria-haspopup','dialog');
  var toolsB=quiet(el('button','tile-header-action'),function(){openWallTools(zoneId,toolsB);});
  toolsB.type='button';toolsB.appendChild(glyph('chevron'));toolsB.setAttribute('aria-label','Options for '+zone.name);toolsB.setAttribute('title','Room options');toolsB.setAttribute('aria-haspopup','dialog');
  head.appendChild(queueB);head.appendChild(toolsB);
  tile.appendChild(head); tile.appendChild(body); tile.appendChild(drawer);
  return {
    art: art, progressSegments: progressSegments, progressBar: segments, statusDot: statusDot, node: tile, img: img, name: name, zoneLine: zoneLine, title: title,
    line2: line2, line3: line3, rule: rule, levels: levels, fill: fill, stamp: stamp, hideB: hideB, state: state, check: check,
    elapsed: elapsed, total: total, playB: playB, prevB: prevB, nextB: nextB,
    membersB: membersB, volDown: volDown, volUp: volUp, volBar: volBar, volSegments: volSegments, volNum: volNum, volMark: volMark,
    sendB: sendB, pullB: pullB, groupB: groupB,
    ungroupB: ungroupB,
    shufB: shufB, repB: repB,
    detail: detail,
    copy: copy, body: body, drawer: drawer, transport: transport, volLine: volLine, actions: actions, openAs: openAs,
    housed: null,
    artKey: null, artPath: null, artReady: false, chips: []
  };
}

/** Keep metadata, transport and stacked scales in separate permanent rows. */
function houseControls(t, drawerMode) {
  if (t.housed === false) return;
  t.housed = false;
  t.node.classList.remove('is-open'); t.node.classList.remove('open-up');
  t.body.insertBefore(t.transport,t.levels); t.levels.appendChild(t.volLine);
  t.drawer.appendChild(t.actions); t.drawer.appendChild(t.openAs); t.drawer.appendChild(t.detail);
}

/** Where a level press goes: one room sets its own, a group moves as one. */
/**
 * TWO PRESSES, NOT A DRAG. Press group (or send) on a card, then press the room
 * to pair it with — which is the only shape that works on a television pointer,
 * and the same shape whether you are grouping or sending.
 */
var pendingSend = null;
var pendingPull = null;          // { zoneId, outputId }: destination is durable by output

function zoneForOutputId(snapshot, outputId) {
  if (snapshot === null || outputId === null) return null;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    for (var o = 0; o < snapshot.zones[i].outputs.length; o += 1) {
      if (snapshot.zones[i].outputs[o].id === outputId) return snapshot.zones[i];
    }
  }
  return null;
}

function stopPullPick() {
  pendingPull = null;
  root.classList.remove('is-pulling');
}

/** Which way the drawer opens: down, unless it would run off the wall, then up. */
function placeDrawer(tile, drawer) {
  var wall = grid.getBoundingClientRect();
  // Measured as it will open, downward: the hover style may not have landed
  // yet when mouseenter fires, so the drawer is shown for the measurement.
  tile.classList.remove('open-up');
  tile.style.removeProperty('--rise');
  var forced = getComputedStyle(drawer).display === 'none';
  if (forced) drawer.style.display = 'block';
  var below = drawer.getBoundingClientRect();
  if (forced) drawer.style.display = '';
  if (below.height === 0) return;
  // When the wall ends under the card, the card RISES by what the drawer would
  // overrun and the drawer fills the place it left — the same orientation as
  // every other row, words above controls (Peter, 09-06: "the controls expand
  // from below and the metadata shifts up").
  if (below.bottom > wall.bottom - 2) {
    tile.style.setProperty('--rise', '-' + Math.ceil(below.bottom - wall.bottom + 2) + 'px');
    tile.classList.add('open-up');
  }
}

function openCard(tile, drawer) {
  closeOpenCards(tile);
  tile.classList.add('is-open');
  placeDrawer(tile, drawer);
}

function closeOpenCards(except) {
  var open = grid.querySelectorAll('.tile.is-open');
  for (var i = 0; i < open.length; i += 1) if (open[i] !== except) open[i].classList.remove('is-open');
}

// A tap anywhere else on the wall closes an open card.
document.addEventListener('click', function (event) {
  var node = event.target;
  while (node && node !== document.body) { if (node.classList && node.classList.contains('is-open')) return; node = node.parentNode; }
  closeOpenCards(null);
}, true);

function activateTile(zoneId) {
  if (showHiddenMode) { toggleHidden(zoneId); return true; }
  if (reorderMode) return true;
  if (pendingPull !== null) { finishPull(zoneId); return true; }
  if (pendingSend !== null) { finishSend(zoneId); return true; }
  if (selectMode) { tapToggle(zoneId); return true; }
  return false;
}

function unhideAll() {
  if (hiddenSlots.length === 0) return;
  hiddenSlots = [];
  persistHidden();
  showHiddenMode = false;
  tabsKey = '';
  resetWallOrder();
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
}

function toggleHidden(zoneId) {
  var zone = zoneOf(zoneId);
  if (zone === null) return;
  var slot = wallSlot(zone);
  var at = hiddenSlots.indexOf(slot);
  if (at === -1) hiddenSlots.push(slot);
  else hiddenSlots.splice(at, 1);
  persistHidden();
  if (showHiddenMode && hiddenSlots.length === 0) showHiddenMode = false;
  tabsKey = '';
  resetWallOrder();
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
}

function beginGroupFrom(zoneId) {
  pendingSend = null;
  pendingUngroupAll = null;
  stopPullPick();
  paintPending();
  if (!selectMode) enterSelect();
  toggleSelect(zoneId);
}

function beginSendFrom(zoneId) {
  var zone = zoneOf(zoneId);
  if (zone === null || zone.nowPlaying === null) { say('nothing is playing in there to send'); return; }
  if (pendingSend === zoneId) { pendingSend = null; say(''); paintPending(); return; }
  pendingUngroupAll = null;
  stopPullPick();
  pendingSend = zoneId;
  say('now press the room to send ' + zone.name + '\u2019s music to \u00B7 press again here to cancel');
  paintPending();
}

function beginPullInto(zoneId) {
  var zone = zoneOf(zoneId);
  if (zone === null || zone.outputs.length === 0) { say('that player is not available'); return; }
  var outputId = zone.outputs[0].id;
  if (pendingPull !== null && pendingPull.outputId === outputId) {
    stopPullPick();
    say('');
    paintPending();
    return;
  }
  pendingSend = null;
  pendingUngroupAll = null;
  pendingPull = { zoneId: zone.id, outputId: outputId };
  root.classList.add('is-pulling');
  say('now press a player with content to pull its music into ' + zone.name + ' \u00B7 press again here to cancel');
  paintPending();
}

function paintPending() {
  var snapshot = store === undefined ? null : store.snapshot();
  var pullDestination = pendingPull === null ? null : zoneForOutputId(snapshot, pendingPull.outputId);
  if (pendingPull !== null && pullDestination === null) stopPullPick();
  var keys = Object.keys(tiles);
  for (var i = 0; i < keys.length; i += 1) {
    var tile = tiles[keys[i]];
    var zone = snapshot === null ? null : zoneOf(keys[i]);
    var sendTarget = pendingSend !== null && keys[i] !== pendingSend;
    var pullHere = pullDestination !== null && keys[i] === pullDestination.id;
    var pullSource = pendingPull !== null && zone !== null && !pullHere
      && zone.nowPlaying !== null && zone.outputs.length > 0;
    tile.node.classList.toggle('send-target', sendTarget);
    tile.node.classList.toggle('send-source', pendingSend === keys[i]);
    tile.node.classList.toggle('pull-destination', pullHere);
    tile.node.classList.toggle('pull-source', pullSource);
    tile.pullB.className = pullHere ? 'ta now' : 'ta';
  }
}

function finishSend(toZoneId) {
  var from = pendingSend;
  pendingSend = null;
  paintPending();
  if (from === null || from === toZoneId) { say(''); return true; }
  post({ action: 'transfer', zone: from, to: toZoneId });
  return true;
}

function finishPull(fromZoneId) {
  var destination = pendingPull;
  if (destination === null) return false;
  var snapshot = store.snapshot();
  var destinationZone = zoneForOutputId(snapshot, destination.outputId);
  if (destinationZone === null) {
    stopPullPick();
    paintPending();
    say('that destination is no longer available');
    return true;
  }
  if (fromZoneId === destinationZone.id) {
    stopPullPick();
    paintPending();
    say('');
    return true;
  }
  var source = null;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    if (snapshot.zones[i].id === fromZoneId) { source = snapshot.zones[i]; break; }
  }
  if (source === null || source.nowPlaying === null || source.outputs.length === 0) {
    say('choose a player that has content');
    paintPending();
    return true;
  }

  stopPullPick();
  paintPending();
  post({
    action: 'pull',
    from: source.id,
    output: destination.outputId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  }).then(function (ok) {
    if (ok) say('pulled ' + source.name + '\u2019s music into ' + destinationZone.name);
  });
  return true;
}

/** The family's name, if anyone has given it one. */
function islandName(id) {
  var snap = store.snapshot();
  if (snap === null || id === '') return '';
  var list = snap.islands || [];
  for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i].label || '';
  return '';
}

/**
 * ⚖️ THE SCALE IS DRAWN TO THE TOP, IN BANDS (Peter, 09-06): plain up to Roon's
 * comfort level, amber from there to its safety level, red beyond — on every
 * face alike (volume-limits.js).
 */
function paintVolumeSegments(nodes, level, muted, bands) {
  var exact = muted || level === null ? 0 : level * nodes.length;
  var whole = Math.floor(exact);
  var part = exact - whole;
  for (var i = 0; i < nodes.length; i += 1) {
    var on = i < whole || (i === whole && part > .04);
    var band = bands ? bandAtFraction(i / nodes.length, bands) : 'ok';
    nodes[i].className = (on ? 'on' : '') + (band === 'ok' ? '' : ' ' + band);
    nodes[i].style.opacity = on && i === whole && part > .04 ? String(.25 + part * .75) : '';
  }
}

function muteState(zone) {
  var found = false;
  var allMuted = true;
  for (var i = 0; i < zone.outputs.length; i += 1) {
    if (zone.outputs[i].volume === null) continue;
    found = true;
    if (!zone.outputs[i].volume.muted) allMuted = false;
  }
  return found ? allMuted : null;
}

function muteCommand(zoneId) {
  var zone = zoneOf(zoneId);
  if (zone === null) return null;
  if (zone.outputs.length > 1) {
    return muteState(zone) === null ? null : { action: 'group-mute', zone: zone.id };
  }
  if (zone.outputs.length === 0 || zone.outputs[0].volume === null) return null;
  return { action: 'mute', output: zone.outputs[0].id, muted: !zone.outputs[0].volume.muted };
}

/**
 * What a press on the scale asks for: `{ body, shown }` — the request, and the
 * fraction the card should show at once — or null when the press was above
 * Roon's safety level and nothing is asked. A group asks by level and each
 * room is held to its own limits on the deck.
 */
function volumeCommand(zoneId, level, override) {
  var zone = zoneOf(zoneId);
  if (zone === null) return { body: { action: 'group-volume', zone: zoneId, level: level, override: override === true }, shown: level };
  var movable = [];
  for (var i = 0; i < zone.outputs.length; i += 1) {
    var o = zone.outputs[i];
    if (o.volume !== null && o.volume.value !== null && o.volume.max !== null
        && o.volume.type !== 'incremental') movable.push(o);
  }
  if (movable.length === 1) {
    var limits = limitsOf(movable[0].volume);
    var asked = askedLevel(limits.min + level * (limits.max - limits.min), limits, override === true);
    if (asked === null) return null;
    return {
      body: { action: 'volume', output: movable[0].id, value: asked.value, override: override === true },
      shown: (asked.value - limits.min) / Math.max(1, limits.max - limits.min),
    };
  }
  return { body: { action: 'group-volume', zone: zoneId, level: level, override: override === true }, shown: level };
}

/** The level a card shows: one room's own, or the average across a group. */
function volumeLevel(zone) {
  var sum = 0, n = 0, muted = true, bands = null;
  for (var i = 0; i < zone.outputs.length; i += 1) {
    var v = zone.outputs[i].volume;
    if (v === null || v.value === null || v.max === null) continue;
    var mn = v.min === null ? 0 : v.min;
    sum += Math.max(0, Math.min(1, (v.value - mn) / Math.max(1, v.max - mn)));
    if (!v.muted) muted = false;
    if (bands === null) bands = bandsOf(limitsOf(v));   // a group's scale wears its first room's bands
    n += 1;
  }
  return n === 0 ? null : { level: sum / n, muted: muted, rooms: n, bands: bands };
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

/**
 * NO MEMBER CHIPS. Roon already names a group "Study RHEOS + 1", and that says
 * everything the card needs to (Peter, 08-28: "don't show members, just use the
 * Roon group name"). The chips repeated it, wrapped the head onto a second line
 * on a group of three, and squeezed the music out of the card.
 *
 * The rooms are still named — in the details the card opens on hover — and
 * taking one room out of a group lives on that room's Face, where there is space
 * to say which room you are removing.
 */
function setChips(tile, zone) {
  if (tile.chips.length === 0) return;
  var existing = tile.zoneLine.querySelectorAll('.chip');
  for (var i = 0; i < existing.length; i += 1) tile.zoneLine.removeChild(existing[i]);
  tile.chips = [];
}

function setArt(tile, zone) {
  var art = zone.nowPlaying && zone.nowPlaying.art ? zone.nowPlaying.art : null;
  var key = art ? art.key : null;
  if (key === tile.artKey) {
    if (art === null) { tile.artReady = true; settleStartup(); }
    return;
  }
  tile.artKey = key;
  tile.artPath = art === null ? null : art.path;
  tile.artReady = false;
  if (art === null) {
    tile.img.removeAttribute('src');
    tile.artReady = true;
    settleStartup();
    return;
  }
  // Decode before swapping so a slow image never shows a broken or half-painted
  // frame. img.decode() is Chromium 64 — above the floor — so it is guarded.
  load(tile, art.path, 0);
}

/** One retry after a short delay: a transient miss must not leave a permanent hole. */
function load(tile, path, attempt) {
  var next = new Image();
  var complete = function () {
    if (tile.artPath !== path) return;
    tile.img.src = next.src;
    tile.artReady = true;
    settleStartup();
  };
  next.onload = complete;
  next.onerror = function () {
    if (tile.artPath !== path) return;
    if (attempt >= 1) {
      tile.artReady = true;
      settleStartup();
      return;
    }
    setTimeout(function () { if (tile.artPath === path) load(tile, path, attempt + 1); }, 1500);
  };
  next.src = path;
  if ('decode' in HTMLImageElement.prototype) {
    next.decode().then(complete).catch(function () { /* onload/onerror cover it */ });
  }
}

/** Size the contents from the actual grid tracks, including the short-screen scroll case. */
function sizeWallCards(cols, rows, capped, half) {
  var width = capped ? grid.clientWidth * Math.min(1 / cols, 1 / 3)
    : (grid.clientWidth - (cols - 1) * 6) / cols;
  var height = window.innerHeight < 850 ? 210
    : (half ? grid.clientHeight * .46 : (grid.clientHeight - (rows - 1) * 6 - 10) / rows);
  var play = Math.floor(Math.max(36, Math.min(64, height * .18)));
  var available = Math.max(80, height - 88 - play);
  var art = Math.floor(Math.max(72, Math.min(available, (width - 32) * .43, width - 186)));
  // Four-row cards keep the artwork budget but give eight pixels back below the scales.
  if (rows >= 4) play = Math.max(28, play - 8);
  var copy = width - 32 - art;
  var title = Math.floor(Math.max(16, Math.min(38, art * .18, copy * .11)));
  var credit = Math.floor(Math.max(13, title * .68));
  root.style.setProperty('--card-art', art + 'px');
  root.style.setProperty('--card-play', play + 'px');
  root.style.setProperty('--card-button', Math.round(play * .9) + 'px');
  root.style.setProperty('--card-glyph', Math.round(play * .48) + 'px');
  root.style.setProperty('--card-title', title + 'px');
  root.style.setProperty('--card-credit', credit + 'px');
  root.style.setProperty('--card-room', Math.min(26, Math.max(12, Math.round(title * .72))) + 'px');
  root.style.setProperty('--card-time', Math.min(16, Math.max(10, Math.round(title * .5))) + 'px');
}

function render(snapshot, kind) {
  if (wallBlanker) wallBlanker.check();
  if (kind !== 'seek') { refreshWallMembers(); refreshWallRadio(); }
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
    pauseAllBtn.hidden = playing === 0;
    var core = snapshot.core;
    summaryEl.textContent = (core.name ? core.name + ' · ' : '')
      + snapshot.zones.length + ' zones · ' + playing + ' playing'
      + (loading > 0 ? ' · ' + loading + ' loading' : '');
    if (streamState === 'catching-up') {
      coreEl.textContent = 'catching up…';
      coreEl.className = 'wall-core away';
    } else {
      coreEl.textContent = core.state === 'paired' ? '' : 'Roon is away — showing the last known state';
      coreEl.className = 'wall-core' + (core.state === 'paired' ? '' : ' away');
    }

    if (snapshot.zones.length === 0) {
      activeIsland = '';
      try { localStorage.removeItem('flightdeck.island'); } catch (e) { /* private window */ }
      tabsKey = '';
      drawTabs([], 0, 0);
      reorderBtn.hidden = true;
      groupBtn.hidden = true;
      groupAllBtn.hidden = true;
      ungroupAllBtn.hidden = true;
      root.style.setProperty('--accent', '#d8a24a');
      grid.replaceChildren(emptyState());
      resetWallOrder();
      prepareStartup([]);
      return;
    }

    var islands = islandsOf(snapshot);
    // A saved tab can name a family whose last device is now asleep. Fall back
    // to All before drawing so the selector never has an empty active choice.
    if (activeIsland !== '') {
      var activePresent = false;
      for (var ii = 0; ii < islands.length; ii += 1) {
        if (islands[ii].id === activeIsland) { activePresent = true; break; }
      }
      if (!activePresent) {
        activeIsland = '';
        try { localStorage.removeItem('flightdeck.island'); } catch (e) { /* private window */ }
        tabsKey = '';
        resetWallOrder();
      }
    }
    var hiddenCount = 0;
    for (var hc = 0; hc < snapshot.zones.length; hc += 1) {
      if (isHiddenZone(snapshot.zones[hc])) hiddenCount += 1;
    }
    if (showHiddenMode && hiddenCount === 0) showHiddenMode = false;
    root.classList.toggle('is-hidden-page', showHiddenMode);
    drawTabs(islands, snapshot.zones.length - hiddenCount, hiddenCount);
    // "group rooms" appears only when Roon would let SOMETHING be formed: an
    // island with two zones in it. One zone per island means nothing to join.
    var canGroup = false;
    for (var gi = 0; gi < islands.length; gi += 1) if (islands[gi].count >= 2) canGroup = true;
    groupBtn.hidden = selectMode || reorderMode || showHiddenMode || !canGroup;
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
    var filtered = [];
    for (var hz = 0; hz < snapshot.zones.length; hz += 1) {
      var hiddenHere = isHiddenZone(snapshot.zones[hz]);
      if (showHiddenMode ? hiddenHere : (inTab.indexOf(snapshot.zones[hz]) !== -1 && !hiddenHere)) {
        filtered.push(snapshot.zones[hz]);
      }
    }
    inTab = filtered;
    var familyZones = currentFamilyZones(snapshot);
    var familyGroups = 0;
    for (var fg = 0; fg < familyZones.length; fg += 1) {
      if (familyZones[fg].outputs.length > 1) familyGroups += 1;
    }
    reorderBtn.hidden = selectMode || showHiddenMode || inTab.length < 2;
    groupAllBtn.hidden = selectMode || reorderMode || showHiddenMode || familyZones.length < 2;
    ungroupAllBtn.hidden = selectMode || reorderMode || showHiddenMode || familyGroups === 0;
    unhideAllBtn.hidden = !showHiddenMode;
    var held = holdOrder(inTab);
    // A TV cannot scroll, so density scales with what is on the page.
    var shown = MAX_TILES === 0 ? held : held.slice(0, MAX_TILES);
    var overflow = held.slice(shown.length);
    var count = shown.length;
    if (count === 0) {
      grid.replaceChildren(el('div', 'empty', hiddenCount > 0
        ? 'All room cards are hidden · open Hidden to restore one.'
        : 'No rooms in this device family.'));
      order = [];
      orderSlots = [];
      previousOutputOwners = {};
      setOverflow([]);
      prepareStartup([]);
      return;
    }
    /**
     * THE CARDS FILL THE SCREEN, up to sixteen (Peter, 08-28: "would we be better
     * varying size to fill screen up to max 16 per screen?" — which is what
     * RHEOS's console does with auto-fill and a minimum).
     *
     * A rigid 4x4 wasted a whole row on eleven rooms and cramped every card into
     * 177px; three rows of four gives each one 244px and every fit problem on this
     * card stops being a fit problem. Past sixteen the rows stay at a quarter and
     * the seventeenth scrolls, rather than shrinking the first sixteen.
     */
    var cols = Math.max(1, Math.min(4, count));
    var rows = Math.max(1, Math.min(4, Math.ceil(count / cols)));
    /**
     * ⚖️ NO CARD IS EVER BIGGER THAN A QUARTER OF THE SCREEN (Peter, 09-03:
     * "when we are down to less than 4 cards the layout for each gets too big
     * and controls spread out").
     *
     * One room filled the whole television, two took half the width and all of
     * the height — and every reading inside them scaled with the row count, so
     * a single room put a 30vh sleeve and a metre of transport row on screen.
     * The cap is half the height and a THIRD of the width — a quarter of the
     * screen at the very most, and never the widest card the wall has ever
     * drawn. Half the width would have satisfied the area on its own, but two
     * rooms would still have been 900px each and the transport row still spread
     * across a metre; a third leaves margin on both sides, so a short wall is a
     * centred cluster rather than a stretched row.
     *
     * `data-rows` is the SIZE class, not the row count — a capped card is a
     * half-height card, so it takes the two-row scale and every vw reading
     * inside it stays the size it is on a full wall.
     */
    var capped = count < 4;
    // ⚖️ A ONE-ROW WALL KEEPS THE HALF-HEIGHT CARD (Peter, 09-06: "with one row
    // don't expand the card — keep to the same height, half the view height").
    var half = capped || rows === 1;
    var colPct = capped ? Math.min(100 / cols, 100 / 3) : 100 / cols;
    grid.style.gridTemplateColumns = capped
      ? 'repeat(' + cols + ', ' + colPct.toFixed(4) + '%)'
      : 'repeat(' + cols + ', 1fr)';
    grid.style.gridAutoRows = window.innerHeight < 850 ? '210px' : (half ? '46%' : 'calc((100% - ' + ((rows-1)*6+10) + 'px) / ' + rows + ')');
    // Centred only while the cards are short of the wall: the full wall fills its
    // tracks, and centring a grid that SCROLLS can put its first row out of reach.
    grid.style.justifyContent = capped ? 'center' : '';
    grid.style.alignContent = half ? 'center' : '';
    var rowsClass = half ? 2 : rows;
    root.setAttribute('data-rows', String(rowsClass));
    sizeWallCards(cols, rows, capped, half);
    // ⚖️ THE DRAWER IS FOR THREE ROWS OR MORE; two or fewer keep the old card.
    var drawerMode = false;
    if (drawerMode) root.setAttribute('data-drawer', '1'); else root.removeAttribute('data-drawer');
    // Density follows what is ON THE PAGE, which is now a family rather than the
    // house: three rooms in a tab should look like three rooms, not like a corner
    // of twenty-two.
    root.setAttribute('data-density', count > 20 ? 'packed' : (count > 9 ? 'dense' : 'roomy'));

    var nextOrder = [];
    for (var i = 0; i < shown.length; i += 1) {
      var zone = shown[i];
      var tile = tiles[zone.id];
      if (tile === undefined) { tile = buildTile(zone); tiles[zone.id] = tile; }
      houseControls(tile, drawerMode);
      var isHero = i === 0 && (zone.state === 'playing' || zone.state === 'loading');
      // A paint rewrites the state classes; the classes a hand put there — a
      // card opened by a finger, a drawer turned upward — must survive it.
      var kept = (tile.node.classList.contains('is-open') ? ' is-open' : '')
        + (tile.node.classList.contains('open-up') ? ' open-up' : '');
      tile.node.className = classFor(zone, isHero) + kept;
      var faceId = zone.outputs.length > 0 ? zone.outputs[0].id : zone.id;
      tile.art.href = '/face/' + encodeURIComponent(faceId);
      tile.node.setAttribute('data-zone', zone.id);
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
      var reported = snapshot.core.state==='paired' && streamState!=='catching-up' && kind!=='cache' ? zone.state : 'unknown';
      tile.node.setAttribute('data-playback',reported);
      tile.statusDot.setAttribute('aria-label',reported);
      tile.statusDot.setAttribute('title',reported);
      tile.playB.disabled = !zone.allowed.play && !zone.allowed.pause;
      tile.prevB.disabled = !zone.allowed.previous;tile.nextB.disabled = !zone.allowed.next;
      setChips(tile, zone);
      var np = zone.nowPlaying;
      tile.title.textContent = np ? np.title : 'nothing played yet';
      tile.line2.textContent = np ? np.line2 : '';
      tile.line3.textContent = np && np.line3 ? np.line3 : '';
      tile.line3.hidden = !tile.line3.textContent;
      tile.stamp.textContent = stampFor(zone, now);
      tile.hideB.replaceChildren(glyph(showHiddenMode ? 'restore' : 'minimize'));
      tile.hideB.setAttribute('title', (showHiddenMode ? 'restore ' : 'hide ') + zone.name);
      tile.hideB.setAttribute('aria-label', (showHiddenMode ? 'restore ' : 'hide ') + zone.name);
      // The frame carries the state now, so the word only earns its place while
      // something is genuinely in flight.
      tile.state.textContent = zone.state === 'loading' ? 'loading' : '';
      var vl = volumeLevel(zone);
      paintVolumeSegments(tile.volSegments, vl === null ? null : vl.level, vl !== null && vl.muted, vl === null ? null : vl.bands);
      tile.volNum.textContent = vl === null ? '' : String(Math.round(vl.level * 100));
      tile.membersB.hidden = zone.outputs.length < 2;
      tile.levels.classList.toggle('has-members', zone.outputs.length > 1);
      tile.volDown.disabled=vl===null;tile.volUp.disabled=vl===null;
      tile.volBar.setAttribute('aria-valuenow',vl===null?'0':String(Math.round(vl.level*100)));tile.volBar.setAttribute('aria-disabled',vl===null?'true':'false');
      var muted = muteState(zone);
      tile.volMark.className = muted === null ? 'tile-vol-mark off'
        : (muted ? 'tile-vol-mark muted' : 'tile-vol-mark');
      var muteLabel = muted ? 'unmute ' : 'mute ';
      tile.volMark.setAttribute('title', muted === null ? 'mute is not available' : muteLabel + zone.name);
      tile.volMark.setAttribute('aria-label', muted === null ? 'mute is not available' : muteLabel + zone.name);
      tile.sendB.className = zone.nowPlaying === null ? 'ta off' : 'ta';
      tile.pullB.className = zone.outputs.length === 0 ? 'ta off' : 'ta';
      var grouped = zone.outputs.length > 1;
      // A group is also a valid leader: Group adds more rooms, while Ungroup
      // dismantles the existing group. They are different verbs, so grouped
      // cards offer both rather than replacing one with the other.
      tile.groupB.hidden = false;
      tile.ungroupB.hidden = !grouped;
      var rooms = [];
      for (var oi = 0; oi < zone.outputs.length; oi += 1) rooms.push(zone.outputs[oi].name);
      var fam = zone.outputs.length > 0 ? islandName(zone.outputs[0].island) : '';
      tile.detail.textContent = rooms.join(' + ') + (fam === '' ? '' : '  \u00B7  ' + fam)
        + '  \u00B7  ' + zone.state;
      var playing = zone.state === 'playing' || zone.state === 'loading';
      tile.playB.replaceChildren(glyph(playing ? 'pause' : 'play'));
      tile.playB.setAttribute('title', playing ? 'pause' : 'play');
      tile.playB.className = 'tt play';
      tile.prevB.className = zone.allowed.previous ? 'tt' : 'tt off';
      tile.nextB.className = zone.allowed.next ? 'tt' : 'tt off';
      var st = zone.settings;
      tile.shufB.className = st === null ? 'tt off' : (st.shuffle ? 'tt lit' : 'tt');
      var loop = st === null ? 'disabled' : st.loop;
      tile.repB.replaceChildren(glyph(loop === 'loop_one' ? 'repeat-one' : 'repeat'));
      tile.repB.className = st === null ? 'tt off' : (loop === 'disabled' ? 'tt' : 'tt lit');
      tile.repB.setAttribute('title', loop === 'loop_one' ? 'repeating this track'
        : (loop === 'loop' ? 'repeating the queue' : 'repeat'));
      setArt(tile, zone);
      nextOrder.push(zone.id);
    }
    var nextSlots = [];
    for (var si = 0; si < shown.length; si += 1) nextSlots.push(wallSlot(shown[si]));
    if (nextOrder.join(',') !== order.join(',') || nextSlots.join(',') !== orderSlots.join(',')) {
      order = nextOrder;
      orderSlots = nextSlots;
      var nodes = [];
      for (var k = 0; k < order.length; k += 1) nodes.push(tiles[order[k]].node);
      grid.replaceChildren.apply(grid, nodes);
    }
    previousOutputOwners = wallOutputOwners(inTab);
    setOverflow(overflow);
    paintPending();
    prepareStartup(shown);
  }

  // Progress on every frame, including seek ticks. Only tiles that exist.
  for (var z = 0; z < snapshot.zones.length; z += 1) {
    var azone = snapshot.zones[z];
    var atile = tiles[azone.id];
    if (atile === undefined) continue;
    var position = store.positionSec(azone);
    var length = azone.nowPlaying ? azone.nowPlaying.lengthSec : null;
    if (position !== null && length) {
      var pct=Math.max(0,Math.min(100,(position/length)*100));
      atile.fill.style.width = pct.toFixed(2) + '%';
      atile.progressBar.hidden=false;
      atile.rule.setAttribute('aria-valuemin','0');atile.rule.setAttribute('aria-valuemax',String(length));atile.rule.setAttribute('aria-valuenow',String(Math.floor(position)));atile.rule.setAttribute('aria-valuetext',formatTime(position)+' of '+formatTime(length));atile.rule.setAttribute('aria-disabled',azone.allowed.seek?'false':'true');
      for(var pi=0;pi<atile.progressSegments.length;pi++) atile.progressSegments[pi].className=pi<Math.floor(pct*atile.progressSegments.length/100)?'lit':'';
      atile.elapsed.textContent = formatTime(position);
      atile.total.textContent = formatTime(length);
    } else {
      atile.fill.style.width = '0';
      atile.progressBar.hidden=false;atile.rule.setAttribute('aria-disabled','true');atile.rule.removeAttribute('aria-valuenow');atile.rule.removeAttribute('aria-valuetext');
      for(var emptyTick=0;emptyTick<atile.progressSegments.length;emptyTick++)atile.progressSegments[emptyTick].className='';
      atile.elapsed.textContent = '—';
      atile.total.textContent = length ? formatTime(length) : '—';
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
var pendingUngroupAll = null;   // exact grouped zone ids awaiting confirmation
var reorderMode = false;
var reorderIdleTimer=null;
function armReorderIdle() { if(reorderIdleTimer!==null)clearTimeout(reorderIdleTimer); reorderIdleTimer=null; if(reorderMode && drag===null)reorderIdleTimer=setTimeout(function(){if(reorderMode && drag===null)saveReorder();},6000); }
var draftSlots = [];
var draftOrderScope = '';
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

/**
 * The one compatible family meant by "all". The aggregate tab may contain
 * incompatible protocols, so it owns a bulk action only when exactly one
 * family is present. Choosing a family tab makes that scope explicit.
 */
function currentFamilyZones(snapshot) {
  if (snapshot === null) return [];
  var family = activeIsland;
  if (family === '') {
    for (var i = 0; i < snapshot.zones.length; i += 1) {
      var found = zoneIsland(snapshot.zones[i]);
      if (found === '') continue;
      if (family !== '' && family !== found) return [];
      family = found;
    }
  }
  if (family === '') return [];
  var zones = [];
  for (var z = 0; z < snapshot.zones.length; z += 1) {
    if (zoneIsland(snapshot.zones[z]) === family) zones.push(snapshot.zones[z]);
  }
  return zones;
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
    if(event.type==='keyup' && event.key!=='Enter' && event.key!==' ')return;
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

/* The header becomes the control line while an action is in progress. */
var bar = el('div', 'wall-bar');
bar.hidden = true;
var barHint = el('span', 'wall-bar-hint');
var barActs = el('span', 'wall-bar-acts');
bar.appendChild(barHint);
bar.appendChild(barActs);
var controlHead = document.querySelector('.wall-head');
if (controlHead !== null) controlHead.appendChild(bar);
else document.body.appendChild(bar);

var sayTimer = null;
function say(message) {
  if (message === '') {
    if (sayTimer !== null) clearTimeout(sayTimer);
    sayTimer = null;
    updateBar();
    return;
  }
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

var reorderBtn = el('span', 'wall-act');
reorderBtn.appendChild(glyph('reorder'));
var reorderLabel = el('span', 'wall-act-label', 'reorder');
reorderBtn.appendChild(reorderLabel);
reorderBtn.setAttribute('title', 'reorder cards on this screen');
reorderBtn.setAttribute('aria-label', 'reorder cards on this screen');
tap(reorderBtn, function () { if (reorderMode) saveReorder(); else beginReorder(); });
var groupBtn = el('span', 'wall-act');
groupBtn.appendChild(glyph('group'));
groupBtn.appendChild(el('span', 'wall-act-label', 'group rooms'));
groupBtn.hidden = true;
groupBtn.setAttribute('title', 'choose rooms to group');
groupBtn.setAttribute('aria-label', 'choose rooms to group');
tap(groupBtn, function () { if (!selectMode) enterSelect(); });
var groupAllBtn = el('span', 'wall-act');
groupAllBtn.appendChild(glyph('groupall'));
groupAllBtn.appendChild(el('span', 'wall-act-label', 'group all'));
groupAllBtn.hidden = true;
groupAllBtn.setAttribute('title', 'group every room in this device family');
groupAllBtn.setAttribute('aria-label', 'group every room in this device family');
tap(groupAllBtn, beginGroupAll);
var ungroupAllBtn = el('span', 'wall-act');
ungroupAllBtn.appendChild(glyph('ungroupall'));
ungroupAllBtn.appendChild(el('span', 'wall-act-label', 'ungroup all'));
ungroupAllBtn.hidden = true;
ungroupAllBtn.setAttribute('title', 'ungroup every group in this device family');
ungroupAllBtn.setAttribute('aria-label', 'ungroup every group in this device family');
tap(ungroupAllBtn, beginUngroupAll);
/** On the hidden-cards page: every hidden room back on the wall in one press (Peter, 09-06). */
var unhideAllBtn = el('span', 'wall-act');
unhideAllBtn.appendChild(glyph('restore'));
unhideAllBtn.appendChild(el('span', 'wall-act-label', 'unhide all'));
unhideAllBtn.hidden = true;
unhideAllBtn.setAttribute('title', 'put every hidden room card back on the deck');
unhideAllBtn.setAttribute('aria-label', 'put every hidden room card back on the deck');
tap(unhideAllBtn, unhideAll);
var pauseAllBtn = el('span', 'wall-act wall-pause-all');
pauseAllBtn.appendChild(glyph('pause'));
pauseAllBtn.appendChild(el('span', 'wall-act-label', 'pause all'));
pauseAllBtn.hidden = true;
pauseAllBtn.setAttribute('title', 'pause every playing room');
pauseAllBtn.setAttribute('aria-label', 'pause every playing room');
var wallPauseInFlight = false;
function pauseAllOnWall() {
  if (wallPauseInFlight) return;
  var snapshot = store === undefined ? null : store.snapshot();
  if (snapshot === null) return;
  var requests = [];
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    if (snapshot.zones[i].state === 'playing') {
      requests.push(post({ action: 'pause', zone: snapshot.zones[i].id }));
    }
  }
  if (requests.length === 0) return;
  wallPauseInFlight = true;
  Promise.all(requests).then(function (results) {
    wallPauseInFlight = false;
    var paused = 0;
    for (var r = 0; r < results.length; r += 1) if (results[r]) paused += 1;
    if (paused > 0) say(paused === 1 ? 'pausing one room' : 'pausing ' + paused + ' rooms');
  }).catch(function () { wallPauseInFlight = false; });
}
tap(pauseAllBtn, pauseAllOnWall);
(function () {
  var head = document.querySelector('.wall-head');
  if (head !== null) {
    var cluster = el('span', 'wall-command-cluster');
    cluster.appendChild(reorderBtn);
    cluster.appendChild(pauseAllBtn);
    cluster.appendChild(groupBtn);
    cluster.appendChild(groupAllBtn);
    cluster.appendChild(ungroupAllBtn);
cluster.appendChild(unhideAllBtn);
    head.appendChild(cluster);
    var settings=el('button','wall-settings');settings.type='button';settings.textContent='⚙';settings.setAttribute('aria-label','Display settings');settings.setAttribute('title','Display settings');settings.addEventListener('click',function(){openWallSettings(settings);});head.appendChild(settings);
  }
})();

/* ---- choosing rooms (the checkbox path) ---- */

function enterSelect(initial) {
  selectMode = true;
  pendingUngroupAll = null;
  selected = initial === undefined ? [] : initial.slice();
  root.classList.add('is-selecting');
  groupBtn.hidden = true;
  groupAllBtn.hidden = true;
  ungroupAllBtn.hidden = true;
  bumpSelectTimer();
  updateBar();
  var snap = store.snapshot();
  if (snap !== null) render(snap, 'snapshot');
}

function beginReorder() {
  if (orderSlots.length < 2) { say('there is only one card to order'); return; }
  pendingSend = null;
  pendingUngroupAll = null;
  stopPullPick();
  reorderMode = true;
  draftOrderScope = wallOrderScope();
  draftSlots = orderSlots.slice();
  reorderLabel.textContent = 'save order';
  armReorderIdle();
  reorderBtn.className = 'wall-act now';
  root.classList.add('is-reordering');
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
  updateBar();
}

function saveReorder() {
  if (!reorderMode) return;
  manualOrders[draftOrderScope] = draftSlots.slice();
  try { localStorage.setItem('flightdeck.wall-orders', JSON.stringify(manualOrders)); } catch (e) { /* private window */ }
  finishReorder();
  say('card order saved on this screen');
}

function resetReorder() {
  var snapshot = store.snapshot();
  if (snapshot === null) return;
  var zones = snapshot.zones;
  if (draftOrderScope !== 'all') {
    zones = [];
    for (var i = 0; i < snapshot.zones.length; i += 1) {
      if (zoneIsland(snapshot.zones[i]) === draftOrderScope) zones.push(snapshot.zones[i]);
    }
  }
  draftSlots = alphabeticalWallZones(zones).map(wallSlot);
  render(snapshot, 'snapshot');
  updateBar();
}

function cancelReorder() {
  if (!reorderMode) return;
  finishReorder();
}

function finishReorder() {
  if(reorderIdleTimer!==null)clearTimeout(reorderIdleTimer);reorderIdleTimer=null;
  reorderMode = false;
  draftSlots = [];
  draftOrderScope = '';
  reorderLabel.textContent = 'reorder';
  reorderBtn.className = 'wall-act';
  root.classList.remove('is-reordering');
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
  updateBar();
}

function beginGroupAll() {
  var snapshot = store === undefined ? null : store.snapshot();
  var zones = currentFamilyZones(snapshot);
  if (zones.length < 2) { say('choose a device-family tab with at least two rooms'); return; }
  var ids = [];
  for (var i = 0; i < zones.length; i += 1) ids.push(zones[i].id);
  // The visible first room becomes leader. The top control line still requires
  // explicit confirmation before the grouping command is sent.
  enterSelect(ids);
}

function beginUngroupAll() {
  var snapshot = store === undefined ? null : store.snapshot();
  var zones = currentFamilyZones(snapshot);
  var ids = [];
  for (var i = 0; i < zones.length; i += 1) {
    if (zones[i].outputs.length > 1) ids.push(zones[i].id);
  }
  if (ids.length === 0) { say('there are no groups in this device family'); return; }
  pendingSend = null;
  stopPullPick();
  pendingUngroupAll = ids;
  say('');
}

function finishUngroupAll() {
  var ids = pendingUngroupAll;
  pendingUngroupAll = null;
  if (ids === null) { updateBar(); return; }
  var requests = [];
  for (var i = 0; i < ids.length; i += 1) {
    var zone = zoneOf(ids[i]);
    if (zone !== null && zone.outputs.length > 1) requests.push(post({ action: 'ungroup', zone: zone.id }));
  }
  if (requests.length === 0) { say('those groups have already changed'); return; }
  Promise.all(requests).then(function (results) {
    var count = 0;
    for (var r = 0; r < results.length; r += 1) if (results[r]) count += 1;
    say(count === 1 ? 'ungrouped one group' : 'ungrouped ' + count + ' groups');
  });
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
  if (reorderMode) {
    bar.hidden = false;
    barHint.textContent = 'Reorder cards · drag into place, then Save';
    barActs.replaceChildren(
      doBtn('save', saveReorder),
      doBtn('a–z', resetReorder),
      doBtn('cancel', cancelReorder)
    );
    return;
  }
  if (pendingUngroupAll !== null) {
    bar.hidden = false;
    barHint.textContent = pendingUngroupAll.length === 1
      ? 'Ungroup the group in this device family?'
      : 'Ungroup all ' + String(pendingUngroupAll.length) + ' groups in this device family?';
    barActs.replaceChildren(
      doBtn('ungroup all', finishUngroupAll),
      doBtn('cancel', function () { pendingUngroupAll = null; updateBar(); })
    );
    return;
  }
  if (pendingPull !== null) {
    var pullZone = zoneForOutputId(store.snapshot(), pendingPull.outputId);
    if (pullZone === null) { stopPullPick(); paintPending(); }
    else {
      bar.hidden = false;
      barHint.textContent = 'Pull into ' + pullZone.name + ' · choose a player with content';
      barActs.replaceChildren(doBtn('cancel', function () { stopPullPick(); paintPending(); updateBar(); }));
      return;
    }
  }
  if (pendingSend !== null) {
    var sendZone = zoneOf(pendingSend);
    if (sendZone === null) { pendingSend = null; paintPending(); }
    else {
      bar.hidden = false;
      barHint.textContent = 'Send from ' + sendZone.name + ' · choose a destination';
      barActs.replaceChildren(doBtn('cancel', function () { pendingSend = null; paintPending(); updateBar(); }));
      return;
    }
  }
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
  if (lead === null) barHint.textContent = 'Group rooms · first chosen leads';
  else if (selected.length === 1) {
    barHint.textContent = leadLive
      ? lead.name + ' leads · choose rooms to add'
      : lead.name + ' leads · choose rooms to add · starts silent';
  } else {
    barHint.textContent = leadLive
      ? String(rooms) + ' rooms · ' + lead.name + ' leads'
      : String(rooms) + ' rooms · ' + lead.name + ' leads · starts silent';
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
  if (drag !== null || showHiddenMode) return;
  var isTouch = event.type === 'touchstart';
  if (!isTouch && Date.now() < mouseBlockUntil) return;   // the touch's mouse echo
  if (!isTouch && typeof event.button === 'number' && event.button !== 0) return;
  if (reorderMode && src.kind !== 'zone') return;
  var tapOnly = !reorderMode && (selectMode || pendingSend !== null || pendingPull !== null);
  if (!tapOnly && src.kind === 'zone') {
    var zone = zoneOf(src.zoneId);
    if (zone === null || (!reorderMode && zoneIsland(zone) === '')) return; // nothing to drag toward
  }
  var p = point(event);
  if (p === null) return;
  drag = {
    src: src, isTouch: isTouch, tapOnly: tapOnly, reorder: reorderMode, moved: false, armed: false,
    sx: p.x, sy: p.y, x: p.x, y: p.y, timer: null, over: null, valid: {}, ghost: null,
  };
  if (isTouch && !tapOnly) {
    drag.timer = setTimeout(function () {
      if (drag !== null && !drag.armed) armDrag();
    }, HOLD_MS);
  }
  if(reorderIdleTimer!==null)clearTimeout(reorderIdleTimer);reorderIdleTimer=null;
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
  armReorderIdle();
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
    if (d.reorder) {
      cancelPress();
      if (event.cancelable) event.preventDefault();
      squelchUntil = Date.now() + 600;
      return;
    }
    var wasTap = d.tapOnly && !d.moved;
    cancelPress();
    if (wasTap) {
      if (event.cancelable) event.preventDefault();
      squelchUntil = Date.now() + 600;
      activateTile(d.src.zoneId);
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
    if (drag.reorder) {
      drag.valid[keys[i]] = true;
      node.classList.add('drop-ok');
      continue;
    }
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
  if (drag.reorder) {
    if (overId !== null && drag.valid[overId] === true) {
      var before = zoneOf(overId);
      if (before !== null) return 'release: move ' + src.name + ' before ' + before.name;
    }
    return 'drag ' + src.name + ' to its new position';
  }
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
  if (d.reorder) {
    var targetZone = overId === null ? null : zoneOf(overId);
    if (srcZone !== null && targetZone !== null && d.valid[overId] === true) {
      var sourceSlot = wallSlot(srcZone);
      var targetSlot = wallSlot(targetZone);
      var from = draftSlots.indexOf(sourceSlot);
      if (from !== -1) draftSlots.splice(from, 1);
      var to = draftSlots.indexOf(targetSlot);
      if (to === -1) draftSlots.push(sourceSlot);
      else draftSlots.splice(to, 0, sourceSlot);
    }
    teardownDrag();
    return;
  }
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
  armReorderIdle();
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
  if (pendingPull !== null || pendingSend !== null) {
    pendingSend = null; stopPullPick(); paintPending(); updateBar(); return;
  }
  if (pendingUngroupAll !== null) { pendingUngroupAll = null; updateBar(); return; }
  if (reorderMode) { cancelReorder(); return; }
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

/* The panel keeps output identities; a topology change closes it before another command. */
var wallMembers = null;
function memberFingerprint(zone) { return zone.outputs.map(function (o) { return o.id; }).join('|'); }
function currentWallMember(outputId) {
  if (!wallMembers || !wallPanel || wallPanel.hidden) return null;
  var zone = zoneOf(wallMembers.zone);
  if (!zone || memberFingerprint(zone) !== wallMembers.members) { closeWallPanel(true); say('The group changed — reopen player volumes'); return null; }
  for (var i = 0; i < zone.outputs.length; i++) if (zone.outputs[i].id === outputId) return zone.outputs[i];
  return null;
}
function refreshWallMembers() {
  if (!wallMembers) return;
  var state = wallMembers;
  for (var i = 0; i < state.rows.length; i++) {
    var row = state.rows[i], output = currentWallMember(row.id);
    if (!output) return;
    var v = output.volume, numeric = v !== null && v.type !== 'incremental' && typeof v.value === 'number';
    row.name.textContent = output.name;
    row.read.textContent = numeric ? String(Number(v.value.toFixed(2))) + (v.type === 'db' ? ' dB' : '') : (v ? 'Steps only' : (output.power && output.power.asleep ? 'Standby' : 'Fixed volume'));
    row.mute.disabled = !v;
    row.mute.setAttribute('aria-label', (v && v.muted ? 'Unmute ' : 'Mute ') + output.name);
    row.mute.setAttribute('aria-pressed', v && v.muted ? 'true' : 'false');
    row.mute.title = row.mute.getAttribute('aria-label');
    row.down.disabled = !v; row.up.disabled = !v;
    row.bar.hidden = !numeric;
    row.bar.setAttribute('aria-disabled', numeric ? 'false' : 'true');
    if (numeric) {
      var limits = limitsOf(v);
      row.bar.setAttribute('aria-valuemin', String(limits.min)); row.bar.setAttribute('aria-valuemax', String(limits.max)); row.bar.setAttribute('aria-valuenow', String(v.value));
      paintVolumeSegments(row.segments, (v.value - limits.min) / Math.max(.000001, limits.max - limits.min), v.muted, bandsOf(limits));
    }
  }
}
function openWallMembers(zoneId, trigger) {
  var zone = zoneOf(zoneId); if (!zone || zone.outputs.length < 2) return;
  openWallPanel('Player volumes · ' + zone.name, trigger);
  wallMembers = { zone: zone.id, members: memberFingerprint(zone), rows: [] };
  zone.outputs.forEach(function (output) {
    var row = el('div', 'wall-member'), name = el('div', 'wall-member-name', output.name), controls = el('div', 'wall-member-controls');
    var read = el('span', 'wall-member-value');
    function step(direction) {
      var latest = currentWallMember(output.id); if (!latest || !latest.volume) return;
      var override = direction > 0 && volumeTaps.press('member-step:' + output.id, Date.now());
      var asked = latest.volume.type === 'incremental' ? { steps: direction } : askedSteps(latest.volume.value, direction, limitsOf(latest.volume), override);
      if (asked.steps) post({ action: 'volume', output: latest.id, steps: asked.steps, override: override });
    }
    var mute = panelButton('', function () {
      var latest = currentWallMember(output.id); if (latest && latest.volume) post({ action: 'mute', output: latest.id, muted: !latest.volume.muted });
    }); mute.appendChild(glyph('speaker'));
    var down = panelButton('−', function () { step(-1); }), up = panelButton('+', function () { step(1); });
    down.setAttribute('aria-label', 'Lower volume for ' + output.name); up.setAttribute('aria-label', 'Raise volume for ' + output.name);
    var bar = el('span', 'tile-rule vol wall-member-bar'), segments = [];
    bar.tabIndex = 0; bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', 'Volume for ' + output.name);
    for (var i = 0; i < 44; i++) { var segment = el('i'); segments.push(segment); bar.appendChild(segment); }
    bar.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].indexOf(e.key) < 0) return;
      e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1);
    });
    bar.addEventListener('click', function (e) {
      var latest = currentWallMember(output.id), box = bar.getBoundingClientRect();
      if (!latest || !latest.volume || latest.volume.type === 'incremental' || !box.width) return;
      var limits = limitsOf(latest.volume), fraction = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      var override = volumeTaps.press('member-bar:' + latest.id, Date.now());
      var asked = askedLevel(limits.min + fraction * (limits.max - limits.min), limits, override);
      if (asked) post({ action: 'volume', output: latest.id, value: asked.value, override: override });
    });
    controls.appendChild(mute); controls.appendChild(down); controls.appendChild(bar); controls.appendChild(up); controls.appendChild(read);
    row.appendChild(name); row.appendChild(controls); wallPanelBody.appendChild(row);
    wallMembers.rows.push({ id: output.id, name: name, read: read, mute: mute, down: down, up: up, bar: bar, segments: segments });
  });
  refreshWallMembers(); placeWallPanel();
}

/* Explicit room panels: basic controls stay on the card, details open on demand. */
var wallPanel=null, wallPanelBody=null, wallPanelReturn=null, wallPanelEpoch=0;
function closeWallPanel(focus) {
  wallPanelEpoch++;
  wallMembers = null;
  wallRadioRows = null;
  if(wallPanel) {wallPanel.hidden=true;wallPanelBody.replaceChildren();}
  if(wallPanelReturn) {wallPanelReturn.setAttribute('aria-expanded','false');if(focus)wallPanelReturn.focus();}
}
function panelButton(label,run) {
  var b=el('button','wall-menu-choice',label);b.type='button';b.addEventListener('click',run);return b;
}
function openWallPanel(title,trigger) {
  closeWallPanel(false);
  if(!wallPanel) {
    wallPanel=el('section','wall-panel');wallPanel.setAttribute('role','dialog');wallPanel.setAttribute('aria-modal','true');wallPanel.setAttribute('aria-labelledby','wall-panel-title');
    var head=el('div','wall-panel-head');var h=el('h2','');h.id='wall-panel-title';head.appendChild(h);
    head.appendChild(panelButton('Close',function(){closeWallPanel(true);}));
    wallPanelBody=el('div','wall-panel-body');wallPanel.appendChild(head);wallPanel.appendChild(wallPanelBody);document.body.appendChild(wallPanel);
    function outsidePanel(e){if(!wallPanel.hidden&&!wallPanel.contains(e.target)&&(!wallPanelReturn||!wallPanelReturn.contains(e.target)))closeWallPanel(false);}
    document.addEventListener('mousedown',outsidePanel);
    document.addEventListener('touchstart',outsidePanel,{passive:true});
    document.addEventListener('keydown',function(e){
      if(wallPanel.hidden)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeWallPanel(true);}
      if(e.key==='Tab') {var all=wallPanel.querySelectorAll('button:not([disabled]),a[href],select,[role=slider]:not([aria-disabled=true])');var first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
  }
  document.getElementById('wall-panel-title').textContent=title;
  wallPanel.hidden=false;wallPanelReturn=trigger;if(trigger)trigger.setAttribute('aria-expanded','true');
  wallPanel.querySelector('button').focus();placeWallPanel();return wallPanelEpoch;
}
function placeWallPanel(){if(!wallPanel||wallPanel.hidden)return;var r=wallPanelReturn?wallPanelReturn.getBoundingClientRect():{right:innerWidth-24,bottom:60};var w=wallPanel.offsetWidth,h=wallPanel.offsetHeight;wallPanel.style.left=Math.max(16,Math.min(r.right-w,innerWidth-w-16))+'px';wallPanel.style.top=Math.max(16,Math.min(r.bottom+8,innerHeight-h-16))+'px';wallPanel.style.right='auto';}
window.addEventListener('resize',placeWallPanel);
function moveWallRoom(zoneId,step){if(!reorderMode)return;var z=zoneOf(zoneId);if(!z)return;var slot=wallSlot(z),from=draftSlots.indexOf(slot),to=from+step;if(from<0||to<0||to>=draftSlots.length)return;draftSlots.splice(from,1);draftSlots.splice(to,0,slot);var snap=store.snapshot();if(snap)render(snap,'snapshot');armReorderIdle();if(tiles[zoneId])tiles[zoneId].zoneLine.focus();}
function openWallTools(zoneId,trigger) {
  var zone=zoneOf(zoneId),tile=tiles[zoneId];if(!zone||!tile)return;
  openWallPanel(zone.name,trigger);
  wallPanelBody.appendChild(el('p','wall-menu-note','Room controls'));
  if (zone.settings) wallPanelBody.appendChild(panelButton('Roon Radio · ' + (zone.settings.autoRadio ? 'On' : 'Off'), function () {
    if (!zoneOf(zoneId)) return; post({ action: 'radio', zone: zoneId }); closeWallPanel(true);
  }));
  zone.outputs.forEach(function (output) {
    if (!output.power || !output.power.controlKey || output.power.asleep) return;
    wallPanelBody.appendChild(panelButton('Standby · ' + output.name, function () {
      post({ action: 'standby', output: output.id, controlKey: output.power.controlKey }); closeWallPanel(true);
    }));
  });
  function existing(label,control){wallPanelBody.appendChild(panelButton(label,function(){if(!zoneOf(zoneId)){closeWallPanel(true);say('That room changed — reopen its options');return;}closeWallPanel(false);control.click();}));}
  existing('Group rooms',tile.groupB);
  if(zone.outputs.length>1)existing('Ungroup rooms',tile.ungroupB);
  existing('Transfer music',tile.sendB);existing('Bring music here',tile.pullB);
  var browse=el('a','wall-menu-choice','Browse music');browse.href=tile.art.href+'?panel=browse';wallPanelBody.appendChild(browse);
  var face=el('a','wall-menu-choice','Open room face');face.href=tile.art.href;wallPanelBody.appendChild(face);
  var phone=el('a','wall-menu-choice','Open phone controls');phone.href='/phone/'+encodeURIComponent(zoneId);wallPanelBody.appendChild(phone);
  var puck=el('a','wall-menu-choice','Open puck view');puck.href=tile.art.href.replace('/face/','/puck/');wallPanelBody.appendChild(puck);
  existing('Hide this room',tile.hideB);
  wallPanelBody.appendChild(el('p','wall-menu-note',zone.outputs.map(function(o){return o.name;}).join(' · ')));placeWallPanel();
}
function openWallQueue(zoneId,trigger) {
  var zone=zoneOf(zoneId);if(!zone)return;
  var epoch=openWallPanel('Queue · '+zone.name,trigger);
  wallPanelBody.appendChild(el('p','wall-menu-note','Reading queue…'));
  function active(){return !wallPanel.hidden&&epoch===wallPanelEpoch&&zoneOf(zoneId)!==null;}
  function load(attempt){
    fetch('/api/v1/queue?zone='+encodeURIComponent(zoneId),{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('Queue unavailable');return r.json();}).then(function(data){
      if(!active())return;
      if(!data.ready&&attempt<8){setTimeout(function(){if(active())load(attempt+1);},250);return;}
      wallPanelBody.replaceChildren();
      if(!data.ready){wallPanelBody.appendChild(el('p','wall-menu-note','Queue is still loading. Close and reopen to retry.'));return;}
      var items=Array.isArray(data.items)?data.items:[];
      if(!items.length)wallPanelBody.appendChild(el('p','wall-menu-note','Nothing queued yet'));
      items.forEach(function(item,index){
        var b=panelButton('',function(){
          var snap=store.snapshot();
          if(!active()||!snap||data.generation!==snap.generation||!Number.isInteger(data.revision)||data.revision<0){say('The queue changed — reopen Queue');return;}
          b.disabled=true;
          fetch('/api/v1/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zone:zoneId,itemId:String(item.id||''),generation:data.generation,queueRevision:data.revision})}).then(function(r){
            if(!active())return;
            if(!r.ok){b.disabled=false;say('The queue changed — reading it again');load(0);return;}
            closeWallPanel(true);say('Playing from '+(item.title||'this track'));
          }).catch(function(){if(active()){b.disabled=false;say('Could not reach FlightDeck');}});
        });
        b.classList.add('wall-queue-row');b.appendChild(el('span','wall-queue-title',(index===0?'Now · ':'')+(item.title||'Untitled')));
        b.appendChild(el('span','wall-queue-credit',item.subtitle||item.line2||''));
        if(index===0)b.disabled=true;wallPanelBody.appendChild(b);
      });placeWallPanel();
    }).catch(function(e){if(active()){wallPanelBody.replaceChildren(el('p','wall-menu-note',e.message));}});
  }
  load(0);
}
var wallDesign={art:'overlay',toolbar:'labels'};
try {var storedDesign=JSON.parse(localStorage.getItem('flightdeck.wall-design')||'{}');if(storedDesign.art==='circle')wallDesign.art='circle';if(storedDesign.toolbar==='icons')wallDesign.toolbar='icons';}catch(e){}
function applyWallDesign(){root.setAttribute('data-art-style',wallDesign.art);root.setAttribute('data-toolbar-style',wallDesign.toolbar);try{localStorage.setItem('flightdeck.wall-design',JSON.stringify(wallDesign));}catch(e){}}
applyWallDesign();
function openWallSettings(trigger){
  openWallPanel('Deck settings',trigger);
  wallPanelBody.appendChild(el('p','wall-menu-note','This display'));
  function choice(label,key,options,care){
    var row=el('label','wall-setting',label),select=el('select',''); select.setAttribute('aria-label',label);
    options.forEach(function(option){var o=el('option','',option[1]);o.value=String(option[0]);select.appendChild(o);});
    select.value=String(care ? wallCare.prefs[key] : wallDesign[key]);
    select.addEventListener('change',function(){
      if(care){var value=(key==='brightness'||key==='blankMinutes')?Number(select.value):select.value==='true';wallCare.set(key,value);wallBlanker.activity();keepWallAwake();}
      else {wallDesign[key]=select.value;applyWallDesign();}
    });row.appendChild(select);wallPanelBody.appendChild(row);
  }
  choice('Dim when unattended','brightness',[[100,'Off'],[75,'75% brightness'],[50,'50% brightness']],true);
  choice('Gentle movement','drift',[[false,'Off'],[true,'On']],true);
  choice('Blank after inactivity','blankMinutes',[[0,'Never'],[15,'15 minutes'],[30,'30 minutes'],[60,'60 minutes']],true);
  choice('Blank only when nothing is playing','blankOnlySilent',[[true,'Yes'],[false,'No · even while playing']],true);
  wallPanelBody.appendChild(el('p','wall-menu-note','Dimming and movement begin after 30 seconds. Saved on this display.'));
  wallPanelBody.appendChild(panelButton('Blank this display now',function(){closeWallPanel(true);wallBlanker.sleep();keepWallAwake();}));
  wallPanelBody.appendChild(el('p','wall-menu-note','Touch or press a key to wake. Music keeps playing.'));
  wallPanelBody.appendChild(el('p','wall-menu-note','Music and players'));
  wallPanelBody.appendChild(panelButton('Roon Radio by room',function(){openWallRadio(trigger);}));
  wallPanelBody.appendChild(panelButton('Standby all players…',function(){openWallStandby(trigger);}));
  wallPanelBody.appendChild(el('p','wall-menu-note','Appearance and controls'));
  choice('Artwork','art',[['overlay','Square · segmented progress'],['circle','Circular artwork · segmented progress']]);
  choice('Toolbar','toolbar',[['labels','Icons with labels'],['icons','Icons only']]);
  wallPanelBody.appendChild(panelButton('Connect puck',function(){closeWallPanel(false);wallController.settings();}));
  placeWallPanel();
}

var wallRadioRows = null;
function refreshWallRadio() {
  if (!wallRadioRows) return;
  wallRadioRows.forEach(function (row) {
    var zone = zoneOf(row.id), available = zone && zone.settings;
    row.button.disabled = row.pending || !available;
    row.button.textContent = (zone ? zone.name : row.name) + ' · ' + (available ? (zone.settings.autoRadio ? 'On' : 'Off') : 'Unavailable');
    row.button.setAttribute('aria-pressed', available && zone.settings.autoRadio ? 'true' : 'false');
  });
}
function openWallRadio(trigger) {
  openWallPanel('Roon Radio by room',trigger); wallRadioRows = [];
  wallPanelBody.appendChild(panelButton('Back to Deck settings',function(){openWallSettings(trigger);}));
  wallPanelBody.appendChild(el('p','wall-menu-note','Continue with related music when a room’s queue ends.'));
  var snapshot = store.snapshot();
  if (snapshot) snapshot.zones.forEach(function (zone) {
    if (!zone.settings) return;
    var row = { id:zone.id, name:zone.name, button:null, pending:false };
    row.button = panelButton('',function(){
      if(row.pending || !zoneOf(row.id)) return;
      row.pending=true; refreshWallRadio();
      post({action:'radio',zone:row.id}).then(function(){row.pending=false;refreshWallRadio();});
    });
    wallRadioRows.push(row);wallPanelBody.appendChild(row.button);
  });
  if (!wallRadioRows.length) wallPanelBody.appendChild(el('p','wall-menu-note','No rooms with Roon Radio settings are available.'));
  refreshWallRadio();placeWallPanel();
}

function openWallStandby(trigger) {
  var snapshot = store.snapshot(), targets = standbyTargets(snapshot);
  openWallPanel('Standby all players',trigger);
  wallPanelBody.appendChild(panelButton('Back to Deck settings',function(){openWallSettings(trigger);}));
  if (!targets.length) { wallPanelBody.appendChild(el('p','wall-menu-note','No awake players report a standby control.'));placeWallPanel();return; }
  wallPanelBody.appendChild(el('p','wall-menu-note','Put these players into standby? This can stop music in their rooms.'));
  targets.forEach(function(target){wallPanelBody.appendChild(el('div','wall-standby-player',target.name));});
  wallPanelBody.appendChild(el('p','wall-menu-note','Includes supported players across all rooms, including hidden cards. Players without standby support are left alone.'));
  var confirm = panelButton('Confirm standby for '+targets.length+' players',function(){
    if(confirm.disabled)return;confirm.disabled=true;
    standbyReviewed(targets,snapshot.generation,function(){return store.snapshot();},post).then(function(result){
      say(result.sent+' players sent to standby'+(result.skipped?' · '+result.skipped+' changed or already asleep':'')+(result.failed?' · '+result.failed+' failed':''));
      if(confirm.isConnected)openWallStandby(trigger);
    });
  });confirm.classList.add('wall-standby-confirm');wallPanelBody.appendChild(confirm);placeWallPanel();
}

// Resizing changes the space available even when no new Roon frame arrives.
window.addEventListener('resize', function () { var snap = store.snapshot(); if (snap !== null) render(snap, 'snapshot'); });

/* The paired controller uses this Wall's existing room/house action owners. */
var controllerWallFocus='',controllerMovingRoom='';
function controllerWallTools(){
  openWallPanel('Room tools',document.querySelector('.wall-settings'));
  function action(label,run){wallPanelBody.appendChild(panelButton(label,function(){closeWallPanel(false);run();}));}
  action('Group rooms',function(){enterSelect();});action('Pause all',pauseAllOnWall);action('Group all',beginGroupAll);action('Reorder rooms',beginReorder);
  action('Show player',function(){var out=wallController.output();if(out)location.href='/face/'+encodeURIComponent(out);});
  action('Connect puck',function(){wallController.settings();});placeWallPanel();
}
var wallController=startController({
  read:function(output){
    var snap=store.snapshot(),zone=zoneForOutputId(snap,output),choices=[],selectedKey='';
    var member=zone?zone.outputs.filter(function(o){return o.id===output;})[0]:null;controllerVolume(member,false);
    if(!reorderMode)controllerMovingRoom='';
    if(wallPanel&&!wallPanel.hidden){
      var nodes=wallPanel.querySelectorAll('button:not([disabled]),a[href],select,[role=slider]:not([aria-disabled=true])');
      for(var n=0;n<nodes.length;n++)(function(node,index){
        var key='panel:'+index+':'+node.textContent.trim();if(node===document.activeElement)selectedKey=key;
        choices.push({key:key,title:node.textContent.trim(),node:node,activate:function(){if(node.tagName==='SELECT'){node.selectedIndex=(node.selectedIndex+1)%node.options.length;node.dispatchEvent(new Event('change',{bubbles:true}));}else node.click();}});
      })(nodes[n],n);
      return {output:output,volume:member?member.volume:null,room:zone?zone.name:'',open:true,mode:'wall-panel',title:document.getElementById('wall-panel-title').textContent,choices:choices,selected:selectedKey};
    }
    for(var i=0;i<order.length;i++)(function(z){if(!z||!tiles[z.id])return;var t=tiles[z.id],key='room:'+wallSlot(z);
      if(!controllerWallFocus&&z.outputs.some(function(o){return o.id===output;}))controllerWallFocus=key;
      if(t.node.contains(document.activeElement))controllerWallFocus=key;
      choices.push({key:key,title:z.name,subtitle:reorderMode?(controllerMovingRoom===z.id?'Turn to move · tap to place':'Tap to move this room'):(selectMode?(selected.indexOf(z.id)>=0?'Selected · tap to remove':'Tap to add to group'):(z.nowPlaying?z.nowPlaying.title:z.state)),node:t.node,
        focus:function(){controllerWallFocus=key;t.zoneLine.focus();},activate:function(){
          if(reorderMode){controllerMovingRoom=controllerMovingRoom===z.id?'':z.id;armReorderIdle();return;}
          if(!activateTile(z.id))location.href=t.art.href;
        }});
    })(zoneOf(order[i]));
    if(selectMode||reorderMode||pendingSend||pendingPull||pendingUngroupAll){
      var buttons=barActs.querySelectorAll('[role="button"],button,[tabindex]');
      for(var j=0;j<buttons.length;j++)(function(node){choices.push({key:'action:'+node.textContent,title:node.textContent,node:node});})(buttons[j]);
    }
    choices.push({key:'tools',title:'Room tools',subtitle:'Group · pause all · reorder',activate:controllerWallTools});
    return {output:output,volume:member?member.volume:null,room:zone?zone.name:'',open:true,mode:reorderMode?'reorder':selectMode?'group':'rooms',title:controllerMovingRoom?'Move '+(zoneOf(controllerMovingRoom)||{name:'room'}).name:selectMode?'Group rooms':'Rooms',choices:choices,selected:controllerWallFocus};
  },
  move:function(delta){if(reorderMode&&controllerMovingRoom){for(var i=0;i<Math.min(16,Math.abs(delta));i++)moveWallRoom(controllerMovingRoom,delta<0?-1:1);return true;}return false;},
  command:function(type,value,output){
    var snap=store.snapshot(),z=zoneForOutputId(snap,output);
    if(type==='rooms'){closeWallPanel(false);return;}
    if(type==='back'){if(wallPanel&&!wallPanel.hidden){closeWallPanel(true);return;}if(selectMode){exitSelect();return;}if(reorderMode){saveReorder();return;}type='playing';}
    if(type==='options'){controllerWallTools();return;}
    if(type==='playing'||type==='browse'||type==='queue'){if(output)location.href='/face/'+encodeURIComponent(output)+(type==='playing'?'':'?panel='+type);return;}
    if(type==='preview'){controllerPreview(value);return;}
    if(!z)return;
    if(type==='volume'){controllerVolume(z.outputs.filter(function(o){return o.id===output;})[0],true);post({action:'volume',output:output,steps:Math.max(-20,Math.min(20,value)),override:false});return;}
    if(type==='mute'){controllerVolume(z.outputs.filter(function(o){return o.id===output;})[0],true);post({action:'mute',output:output,muted:value===1});return;}
    if(type==='seek'){controllerPreview(-1);post({action:'seek',zone:z.id,seconds:value});return;}
    if(['playpause','play','pause','next','previous','shuffle','repeat'].indexOf(type)>=0)post({action:type,zone:z.id});
  }
});

startPuckStatus(function(){var snap=store.snapshot();if(!snap)return [];return snap.zones.filter(function(z){return !!tiles[z.id];}).map(function(z){return {host:tiles[z.id].node.querySelector('.tile-head'),outputs:z.outputs.map(function(o){return o.id;})};});});
