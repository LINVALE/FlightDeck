import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { seekTargetSecond } from './seek-target.js';
import { alphabeticalWallZones, applyWallSlotOrder, inheritWallOrder, joinedPreviousZones, wallOutputOwners, wallSlot } from './wall-order.js';

/**
 * The House Wall. Rooms are alphabetical until somebody deliberately saves a
 * screen-local order. Playback state is shown by tile SIZE and by the copy —
 * never by moving a zone, so starting music never reshuffles the room.
 *
 * DOM is bounded: tiles are reused by zone id and never re-created per tick (R7).
 */

var root = document.getElementById('wall');
var grid = document.getElementById('grid');
var summaryEl = document.getElementById('summary');
var coreEl = document.getElementById('core');
var tiles = {};
var order = [];
var orderSlots = [];
var previousOutputOwners = {};
var topologyHoldSlots = [];
var lastTopology = null;
var tabsEl = document.getElementById('tabs');

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
  var tile = el('a', 'tile');
  tile.href = '/face/' + encodeURIComponent(zoneId);
  tile.setAttribute('data-zone', zoneId);
  var check = el('span', 'tile-check');
  tile.appendChild(check);
  tile.addEventListener('mousedown', function (event) {
    startPress(event, { kind: 'zone', zoneId: zoneId, name: name.textContent });
  });
  tile.addEventListener('touchstart', function (event) {
    startPress(event, { kind: 'zone', zoneId: zoneId, name: name.textContent });
  }, { passive: true });
  tile.addEventListener('click', function (event) {
    if (Date.now() < squelchUntil) { event.preventDefault(); event.stopPropagation(); return; }
    if (activateTile(zoneId)) {
      event.preventDefault(); event.stopPropagation();
    }
  });

  /** A press on any control inside the card must never also follow it to the Face. */
  var quiet = function (node, run) {
    var last = 0;
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
  var name = el('span', '', zone.name);
  zoneLine.appendChild(name);
  var stamp = el('div', 'tile-stamp');
  var hideB = quiet(el('span', 'tile-hide'), function () { toggleHidden(zoneId); });
  hideB.appendChild(glyph('minimize'));
  hideB.setAttribute('title', 'hide ' + zone.name + ' from this wall');
  hideB.setAttribute('aria-label', 'hide ' + zone.name + ' from this wall');
  head.appendChild(zoneLine); head.appendChild(stamp); head.appendChild(hideB);

  /* ── the art, with the music and the transport beside it ────────────────── */
  var now = el('div', 'tile-now');
  var art = el('div', 'tile-art');
  var img = document.createElement('img');
  img.alt = '';
  art.appendChild(img);
  var copy = el('div', 'tile-copy');
  var title = el('div', 'tile-title');
  var line2 = el('div', 'tile-line2');
  var transport = el('div', 'tile-transport');
  var act = function (mark, label, action) {
    var b = el('span', 'tt');
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
  copy.appendChild(title); copy.appendChild(line2); copy.appendChild(transport);
  now.appendChild(art); now.appendChild(copy);

  /* ── two bars, each the full width of the card, each with its reading ───── */
  var progress = el('div', 'tile-bar-line');
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
  var total = el('span', 'tile-t total');
  progress.appendChild(elapsed); progress.appendChild(rule); progress.appendChild(total);

  var volLine = el('div', 'tile-bar-line');
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
  var volNum = el('span', 'tile-t total');
  quiet(volBar, function (event) {
    var box = volBar.getBoundingClientRect();
    if (box.width <= 0) return;
    var want = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    paintVolumeSegments(volSegments, want, false);            // answer the press at once
    volNum.textContent = String(Math.round(want * 100));
    // ⚖️ Press to position, never drag (Peter, 08-28). One grammar with the Face.
    post(volumeCommand(zoneId, want));
  });
  volLine.appendChild(volMark); volLine.appendChild(volBar); volLine.appendChild(volNum);

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
  var state = el('div', 'tile-state');
  actions.appendChild(left); actions.appendChild(state); actions.appendChild(infoB);

  tile.appendChild(head); tile.appendChild(now);
  tile.appendChild(progress); tile.appendChild(volLine); tile.appendChild(actions);
  tile.appendChild(detail);
  return {
    node: tile, img: img, name: name, zoneLine: zoneLine, title: title,
    line2: line2, fill: fill, stamp: stamp, hideB: hideB, state: state, check: check,
    elapsed: elapsed, total: total, playB: playB, prevB: prevB, nextB: nextB,
    volSegments: volSegments, volNum: volNum, volMark: volMark,
    sendB: sendB, pullB: pullB, groupB: groupB,
    ungroupB: ungroupB,
    shufB: shufB, repB: repB,
    detail: detail,
    artKey: null, chips: []
  };
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

function activateTile(zoneId) {
  if (showHiddenMode) { toggleHidden(zoneId); return true; }
  if (reorderMode) return true;
  if (pendingPull !== null) { finishPull(zoneId); return true; }
  if (pendingSend !== null) { finishSend(zoneId); return true; }
  if (selectMode) { tapToggle(zoneId); return true; }
  return false;
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

function paintVolumeSegments(nodes, level, muted) {
  var exact = muted || level === null ? 0 : level * nodes.length;
  var whole = Math.floor(exact);
  var part = exact - whole;
  for (var i = 0; i < nodes.length; i += 1) {
    var on = i < whole || (i === whole && part > .04);
    nodes[i].className = on ? 'on' : '';
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

function volumeCommand(zoneId, level) {
  var zone = zoneOf(zoneId);
  if (zone === null) return { action: 'group-volume', zone: zoneId, level: level };
  var movable = [];
  for (var i = 0; i < zone.outputs.length; i += 1) {
    var o = zone.outputs[i];
    if (o.volume !== null && o.volume.value !== null && o.volume.max !== null
        && o.volume.type !== 'incremental') movable.push(o);
  }
  if (movable.length === 1) {
    var v = movable[0].volume;
    var mn = v.min === null ? 0 : v.min;
    return { action: 'volume', output: movable[0].id, value: Math.round(mn + level * Math.max(1, v.max - mn)) };
  }
  return { action: 'group-volume', zone: zoneId, level: level };
}

/** The level a card shows: one room's own, or the average across a group. */
function volumeLevel(zone) {
  var sum = 0, n = 0, muted = true;
  for (var i = 0; i < zone.outputs.length; i += 1) {
    var v = zone.outputs[i].volume;
    if (v === null || v.value === null || v.max === null) continue;
    var mn = v.min === null ? 0 : v.min;
    sum += Math.max(0, Math.min(1, (v.value - mn) / Math.max(1, v.max - mn)));
    if (!v.muted) muted = false;
    n += 1;
  }
  return n === 0 ? null : { level: sum / n, muted: muted, rooms: n };
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
      grid.replaceChildren(el('div', 'empty', 'No Roon zones yet.'));
      resetWallOrder();
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
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridAutoRows = (100 / rows).toFixed(4) + '%';
    root.setAttribute('data-rows', String(rows));
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
      tile.hideB.replaceChildren(glyph(showHiddenMode ? 'restore' : 'minimize'));
      tile.hideB.setAttribute('title', (showHiddenMode ? 'restore ' : 'hide ') + zone.name);
      tile.hideB.setAttribute('aria-label', (showHiddenMode ? 'restore ' : 'hide ') + zone.name);
      // The frame carries the state now, so the word only earns its place while
      // something is genuinely in flight.
      tile.state.textContent = zone.state === 'loading' ? 'loading' : '';
      var vl = volumeLevel(zone);
      paintVolumeSegments(tile.volSegments, vl === null ? null : vl.level, vl !== null && vl.muted);
      tile.volNum.textContent = vl === null ? '' : String(Math.round(vl.level * 100));
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
var pendingUngroupAll = null;   // exact grouped zone ids awaiting confirmation
var reorderMode = false;
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
    head.appendChild(cluster);
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
  reorderLabel.textContent = 'save';
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
