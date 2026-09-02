import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';

/**
 * THE PUCK — a model of the ESP32-S3 knob, driven by the live plane.
 *
 * I1: it RENDERS. No gesture is wired yet, deliberately, so the geometry can be
 * measured against the real device before any input exists to argue about.
 *
 * The page draws the DEVICE, not only its screen: a bezel around the glass. On
 * the hardware the wheel and the touch panel are physically separate surfaces,
 * and a simulation that runs both on one rectangle cannot tell a turn from a
 * swipe. Here the bezel is the wheel and everything inside the glass is touch.
 *
 * ⚖️ Progress is Roon's reported second, VERBATIM (Peter, 08-28). The store
 * already holds that rule; this file must never add a browser clock on top.
 *
 * ES2018 floor, same as every other shipped asset — one dialect, one lint.
 */

var root = document.getElementById('puck');
var SVG_NS = 'http://www.w3.org/2000/svg';

/** The Dial's own ring: r=44 in a 0..100 box, twelve o'clock, clockwise. */
var RING_R = 44;
var RING_C = 2 * Math.PI * RING_R;

/**
 * The cover at 0.54 of the glass puts its corners ~21px inside the ring at 360,
 * so the arc never crosses the artwork. Inscribing is also what keeps the round
 * clip on `.glass` from ever reaching a corner — a circular screen must not be
 * allowed to crop the cover.
 */
var COVER_RATIO = 0.54;
var BEZEL_RATIO = 0.085;

/** The field is the cover drawn tiny and scaled up. This project's blur. */
var GROUND_PX = 20;

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- the device ---------- */

var rig = el('div', 'rig');
var glass = el('div', 'glass');

var ground = document.createElement('canvas');
ground.className = 'ground';
ground.width = GROUND_PX;
ground.height = GROUND_PX;
var groundCtx = ground.getContext('2d');

var veil = el('div', 'veil');

var cover = el('div', 'cover');
var coverImg = document.createElement('img');
coverImg.alt = '';
cover.appendChild(coverImg);

var ring = document.createElementNS(SVG_NS, 'svg');
ring.setAttribute('class', 'ring');
ring.setAttribute('viewBox', '0 0 100 100');
var ringTrack = document.createElementNS(SVG_NS, 'circle');
var ringArc = document.createElementNS(SVG_NS, 'circle');
[ringTrack, ringArc].forEach(function (c) {
  c.setAttribute('cx', '50');
  c.setAttribute('cy', '50');
  c.setAttribute('r', String(RING_R));
});
ringTrack.setAttribute('class', 'ring-track');
ringArc.setAttribute('class', 'ring-arc');
ringArc.setAttribute('transform', 'rotate(-90 50 50)');   // start at twelve o'clock
ringArc.setAttribute('stroke-dasharray', String(RING_C));
ringArc.setAttribute('stroke-dashoffset', String(RING_C));
ring.appendChild(ringTrack);
ring.appendChild(ringArc);

var room = el('div', 'room');
var remain = el('div', 'remain');
var note = el('div', 'note', 'connecting');

glass.appendChild(ground);
glass.appendChild(veil);
glass.appendChild(cover);
glass.appendChild(ring);
glass.appendChild(room);
glass.appendChild(remain);
glass.appendChild(note);
rig.appendChild(glass);
root.appendChild(rig);

/* ---------- geometry: the SHORT side, never vw ---------- */

/**
 * `?px=360` pins the GLASS to the device's own resolution so the page can be
 * held beside the hardware. With none, the stage is sized off whichever side of
 * the viewport is shorter — the rule the phone layout learned the hard way when
 * everything was `vw` for a television and landscape put the sleeve off-screen.
 */
var pinnedRaw = root.getAttribute('data-px');
var PINNED = pinnedRaw === null ? null : parseInt(pinnedRaw, 10);
if (PINNED !== null && !isFinite(PINNED)) PINNED = null;

function layout() {
  var glassPx;
  if (PINNED !== null) {
    glassPx = PINNED;
  } else {
    /**
     * The DEVICE must fit the short side, not only its screen. Sizing the glass
     * at 0.88 of the short side and hanging the bezel outside it put 507px of
     * object into a 500px viewport — so solve rig = glass + 2 * bezel for the
     * glass instead, and let the bezel come out of the same budget.
     */
    var side = Math.min(window.innerWidth, window.innerHeight);
    var rigPx = Math.max(180, Math.floor(side * 0.92));
    glassPx = Math.max(150, Math.round(rigPx / (1 + 2 * BEZEL_RATIO)));
  }
  var bezelPx = Math.max(10, Math.round(glassPx * BEZEL_RATIO));
  rig.style.setProperty('--glass', String(glassPx) + 'px');
  rig.style.setProperty('--bezel-w', String(bezelPx) + 'px');
  rig.style.setProperty('--cover', String(Math.round(glassPx * COVER_RATIO)) + 'px');
  rig.style.setProperty('--u', String(glassPx / 100) + 'px');
}

window.addEventListener('resize', layout);
layout();

/* ---------- what this puck is looking at ---------- */

function stampOf(zone) {
  return Date.parse(zone.lastPlayedAt === null ? '' : zone.lastPlayedAt) || 0;
}

/**
 * A pinned zone wins; otherwise the puck follows whatever is playing, most
 * recently started first. A puck bound to an OUTPUT is I2's job — the display
 * registry already answers that question and there is no point guessing at it
 * here first.
 */
function pickZone(snapshot) {
  if (snapshot === null || !Array.isArray(snapshot.zones) || snapshot.zones.length === 0) return null;
  var zones = snapshot.zones;
  var wanted = root.getAttribute('data-zone');
  var i;
  if (wanted) {
    for (i = 0; i < zones.length; i += 1) if (zones[i].id === wanted) return zones[i];
  }
  var best = null;
  for (i = 0; i < zones.length; i += 1) {
    if (zones[i].state !== 'playing') continue;
    if (best === null || stampOf(zones[i]) > stampOf(best)) best = zones[i];
  }
  return best !== null ? best : zones[0];
}

/* ---------- painting ---------- */

var groundKey = null;
var coverKey = null;

function paintGround(art) {
  if (art === null) {
    groundCtx.clearRect(0, 0, GROUND_PX, GROUND_PX);
    groundKey = null;
    return;
  }
  if (art.key === groundKey) return;
  groundKey = art.key;
  var image = new Image();
  image.onload = function () {
    if (groundKey !== art.key) return;    // a later track already claimed the field
    groundCtx.drawImage(image, 0, 0, GROUND_PX, GROUND_PX);
  };
  image.onerror = function () { if (groundKey === art.key) groundKey = null; };
  image.src = art.path;
}

function paintCover(art) {
  if (art === null) {
    if (coverKey !== null) { coverImg.removeAttribute('src'); coverKey = null; }
    cover.style.display = 'none';
    return;
  }
  cover.style.display = '';
  if (art.key === coverKey) return;
  coverKey = art.key;
  coverImg.src = art.path;
}

function setArc(fraction) {
  var clamped = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  ringArc.setAttribute('stroke-dashoffset', String(RING_C * (1 - clamped)));
}

function render() {
  var snapshot = store.snapshot();
  var zone = pickZone(snapshot);
  if (zone === null) {
    room.textContent = '';
    remain.textContent = '';
    paintGround(null);
    paintCover(null);
    setArc(null);
    return;
  }

  room.textContent = zone.name;

  var np = zone.nowPlaying;
  if (np === null) {
    remain.textContent = '';
    paintGround(null);
    paintCover(null);
    setArc(null);
    return;
  }

  paintGround(np.art);
  paintCover(np.art);

  // The store returns null for a live stream: an ever-rising seek_position with
  // no duration is a stream-age counter, not progress, and must not draw an arc.
  var position = store.positionSec(zone);
  var length = np.lengthSec;
  if (position === null || typeof length !== 'number' || length <= 0) {
    remain.textContent = '';
    setArc(null);
    return;
  }
  remain.textContent = '−' + formatTime(Math.max(0, length - position));
  setArc(position / length);
}

var store = createStore(render);
store.hydrate();
createStream(store, function (state) { root.setAttribute('data-state', state); });
render();
