import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { uiOverride } from './screen-shape.js';

/**
 * THE PHONE WALL. The house in one column, for a thumb (Peter, 09-06: "a
 * different wall that shows cards and individual elements optimised for a
 * phone"). Not the Wall in media queries — that page is a television's, four
 * columns of cards sized in vw, and the 08-29 measurement stands: a scaled
 * television is not a phone page. This is a fourth page on the same organs
 * (snapshot store, SSE stream, art relay, the one write route) with its own
 * skin: every room a card the height of a thumb, art on the left, the words
 * in the middle, the one control a listener reaches for on the right, and the
 * room's remote a tap away on the words.
 *
 * Rooms keep the Wall's rule: alphabetical, never reordered by the music, so
 * a thumb that has learned where a room is finds it there.
 */

var root = document.getElementById('pwall');
var SVG_NS = 'http://www.w3.org/2000/svg';

// A ?ui= in the address is remembered here too, so a desktop asked to show
// this page keeps showing it (screen-shape.js).
var storageOrNull = null;
try { storageOrNull = window.localStorage; } catch (e) { storageOrNull = null; }
uiOverride(location.search, storageOrNull);

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- glyphs: the phone's own line-work ---------- */

function glyph(name) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var d = {
    play: 'M8 5.5v13l11-6.5z',
    pause: 'M8 5.5h3.1v13H8zm5 0h3.1v13H13z',
    minus: 'M5.5 10.9h13v2.2h-13z',
    plus: 'M10.9 5.5h2.2v13h-2.2zM5.5 10.9h13v2.2h-13z',
    speaker: 'M4 9.5v5h3.2L12 18.5v-13L7.2 9.5z',
  }[name];
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d || '');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/** The Wall's family colours, in the Wall's order, so a dot means the same here. */
var FAMILY_COLOURS = ['#7fa6b0', '#b39b78', '#a08bb0', '#8faa8a', '#b08f92', '#8b95b5'];

/* ---------- the page ---------- */

var head = el('header', 'head');
var brand = el('div', 'brand', 'FLIGHT');
brand.appendChild(el('span', '', 'DECK'));
var status = el('div', 'status', 'connecting');
head.appendChild(brand);
head.appendChild(status);
var list = el('div', 'rooms');
var empty = el('div', 'empty', 'No Roon zones yet');
empty.hidden = true;
var toast = el('div', 'toast');
root.appendChild(head);
root.appendChild(list);
root.appendChild(empty);
root.appendChild(toast);

/* ---------- talking to the deck ---------- */

function command(body) {
  return fetch('/api/v1/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (data) {
      flash(data.error || ('control failed (' + response.status + ')'));
    });
    return null;
  }).catch(function () { flash('could not reach FlightDeck'); });
}

var toastTimer = null;
function flash(message) {
  toast.textContent = message;
  toast.className = 'toast is-lit';
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.className = 'toast'; }, 2600);
}

function zoneOf(zoneId) {
  var snapshot = store.snapshot();
  if (snapshot === null) return null;
  for (var i = 0; i < snapshot.zones.length; i += 1) if (snapshot.zones[i].id === zoneId) return snapshot.zones[i];
  return null;
}

/** The speaker a card's level steps: the zone's first output that has a level. */
function levelOutput(zone) {
  if (zone === null) return null;
  for (var i = 0; i < zone.outputs.length; i += 1) {
    var v = zone.outputs[i].volume;
    if (v !== null && v.value !== null) return zone.outputs[i];
  }
  return null;
}

/* ---------- cards: one per room, reused by zone id, never rebuilt per tick ---------- */

var cards = {};

function buildCard(zoneId) {
  var node = el('article', 'card');
  node.setAttribute('data-zone', zoneId);
  var art = el('span', 'card-art');
  var img = document.createElement('img');
  img.alt = '';
  art.appendChild(img);
  var mark = glyph('speaker');
  mark.setAttribute('class', 'glyph card-nomark');
  art.appendChild(mark);
  var body = el('span', 'card-body');
  var roomLine = el('span', 'card-room');
  var dot = el('i', 'card-dot');
  var roomName = el('span', 'card-room-name');
  roomLine.appendChild(dot);
  roomLine.appendChild(roomName);
  var title = el('span', 'card-title');
  var line2 = el('span', 'card-line2');
  var bar = el('span', 'card-bar');
  var fill = el('i', '');
  bar.appendChild(fill);
  var times = el('span', 'card-times');
  body.appendChild(roomLine);
  body.appendChild(title);
  body.appendChild(line2);
  body.appendChild(bar);
  body.appendChild(times);
  var side = el('span', 'card-side');
  var play = el('span', 'card-play');
  play.setAttribute('role', 'button');
  play.appendChild(glyph('play'));
  var level = el('span', 'card-level');
  var minus = el('span', 'lv');
  minus.setAttribute('role', 'button');
  minus.setAttribute('aria-label', 'quieter');
  minus.appendChild(glyph('minus'));
  var num = el('span', 'num');
  var plus = el('span', 'lv');
  plus.setAttribute('role', 'button');
  plus.setAttribute('aria-label', 'louder');
  plus.appendChild(glyph('plus'));
  level.appendChild(minus);
  level.appendChild(num);
  level.appendChild(plus);
  side.appendChild(play);
  side.appendChild(level);
  node.appendChild(art);
  node.appendChild(body);
  node.appendChild(side);

  // The words open the room's remote; the buttons act here and stop there.
  var open = function () { location.href = '/phone/' + encodeURIComponent(zoneId); };
  art.addEventListener('click', open);
  body.addEventListener('click', open);
  play.addEventListener('click', function (event) {
    event.stopPropagation();
    var z = zoneOf(zoneId);
    if (z === null || !(z.allowed.play || z.allowed.pause)) return;
    command({ action: 'playpause', zone: z.id });
  });
  // ⚖️ One tap, one step, sent as the remote sends it — never a repeat, never
  // a hold, so no flood can leave this page (feedback_volume_paths_need_a_gate).
  var step = function (delta) {
    return function (event) {
      event.stopPropagation();
      var out = levelOutput(zoneOf(zoneId));
      if (out === null) return;
      command({ action: 'volume', output: out.id, steps: delta });
    };
  };
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));

  return {
    node: node, img: img, art: art, roomName: roomName, dot: dot, title: title, line2: line2,
    fill: fill, times: times, play: play, level: level, num: num, artKey: null, shows: 'play', playing: false,
  };
}

function classFor(zone) {
  var state = zone.state === 'loading' ? 'playing' : zone.state;
  return 'card is-' + state;
}

function familyColour(snapshot, zone) {
  var key = zone.outputs.length > 0 ? zone.outputs[0].island : '';
  var islands = snapshot.islands || [];
  for (var i = 0; i < islands.length; i += 1) if (islands[i].id === key) return FAMILY_COLOURS[i % FAMILY_COLOURS.length];
  return '';
}

/** Where the music is now: the last observed position, moved on while playing. */
function positionOf(zone) {
  var np = zone.nowPlaying;
  if (np === null || np.seek === null) return null;
  var pos = np.seek.positionSec;
  if (zone.state === 'playing') {
    var since = (Date.now() - (Date.parse(np.seek.at) || Date.now())) / 1000;
    if (since > 0 && since < 3600) pos += since;
  }
  if (np.lengthSec !== null && pos > np.lengthSec) pos = np.lengthSec;
  return pos;
}

function paintProgress(zone, card) {
  var np = zone.nowPlaying;
  var pos = positionOf(zone);
  var length = np === null ? null : np.lengthSec;
  var fraction = pos !== null && length !== null && length > 0 ? Math.max(0, Math.min(1, pos / length)) : 0;
  card.fill.style.width = (fraction * 100).toFixed(2) + '%';
  var text = pos === null ? '' : formatTime(pos) + (length === null ? '' : ' · ' + formatTime(length));
  if (card.times.textContent !== text) card.times.textContent = text;
}

function paintCard(snapshot, zone, card) {
  var want = classFor(zone);
  if (card.node.className !== want) card.node.className = want;
  var np = zone.nowPlaying;
  var key = np !== null && np.art !== null ? np.art.key : null;
  if (key !== card.artKey) {
    card.artKey = key;
    if (key === null) { card.img.removeAttribute('src'); card.art.classList.remove('has-art'); }
    else { card.img.src = np.art.path; card.art.classList.add('has-art'); }
  }
  var out = levelOutput(zone);
  var muted = out !== null && out.volume.muted;
  var roomText = zone.name + (zone.outputs.length > 1 ? ' · ' + String(zone.outputs.length) + ' rooms' : '') + (muted ? ' · muted' : '');
  if (card.roomName.textContent !== roomText) card.roomName.textContent = roomText;
  var colour = familyColour(snapshot, zone);
  if (card.dot.style.background !== colour) card.dot.style.background = colour;
  var titleText = np !== null ? np.title : (zone.state === 'stopped' ? 'Nothing playing' : '');
  if (card.title.textContent !== titleText) card.title.textContent = titleText;
  var line2Text = np !== null ? np.line2 : '';
  if (card.line2.textContent !== line2Text) card.line2.textContent = line2Text;
  paintProgress(zone, card);
  var playing = zone.state === 'playing' || zone.state === 'loading';
  card.playing = playing;
  var shows = playing ? 'pause' : 'play';
  if (card.shows !== shows) {
    card.shows = shows;
    card.play.replaceChildren(glyph(shows));
    card.play.setAttribute('aria-label', shows + ' ' + zone.name);
  }
  var can = zone.allowed.play || zone.allowed.pause;
  card.play.classList.toggle('off', !can);
  card.level.hidden = out === null;
  if (out !== null) {
    // The number is the level whether or not the room is muted: a muted room
    // still has a level to step, and the room line says it is muted.
    var numText = String(Math.round(out.volume.value));
    if (card.num.textContent !== numText) card.num.textContent = numText;
    card.level.classList.toggle('is-muted', muted);
  }
}

function render(snapshot) {
  var zones = snapshot.zones.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var nodes = [];
  var seen = {};
  var playing = 0;
  for (var i = 0; i < zones.length; i += 1) {
    var zone = zones[i];
    var card = cards[zone.id];
    if (card === undefined) { card = buildCard(zone.id); cards[zone.id] = card; }
    paintCard(snapshot, zone, card);
    if (zone.state === 'playing' || zone.state === 'loading') playing += 1;
    nodes.push(card.node);
    seen[zone.id] = true;
  }
  for (var id in cards) if (cards.hasOwnProperty(id) && seen[id] !== true) delete cards[id];
  list.replaceChildren.apply(list, nodes);
  empty.hidden = zones.length > 0;
  var core = snapshot.core;
  var statusText = core !== undefined && core !== null && core.state === 'away' ? 'Roon is away'
    : String(zones.length) + ' rooms · ' + String(playing) + ' playing';
  if (status.textContent !== statusText) status.textContent = statusText;
  root.setAttribute('data-state', 'live');
}

var store = createStore(render);
store.hydrate();
createStream(store, function (state) {
  if (state === 'catching-up') { status.textContent = 'catching up…'; }
  else { var snap = store.snapshot(); if (snap !== null) render(snap); }
});

// The bars move between frames without rebuilding anything.
setInterval(function () {
  var snapshot = store.snapshot();
  if (snapshot === null) return;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    var card = cards[snapshot.zones[i].id];
    if (card !== undefined && card.playing) paintProgress(snapshot.zones[i], card);
  }
}, 1000);
