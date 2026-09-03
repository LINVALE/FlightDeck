import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';

/**
 * THE PUCK — one face at two sizes.
 *
 * The same layout is a 360x360 controller in the hand and a metre-wide dial on
 * a television, because every dimension derives from `--u` (the glass / 100).
 * That is what makes the two mirror each other: the thing at two o'clock on the
 * wall is at two o'clock under your thumb, with no translation between views.
 *
 * ⚖️ The art FILLS the dial (Peter, 09-02). Legibility is painted over it in
 * scrims; the cover itself is never dimmed, tinted or transformed.
 *
 * ⚖️ Progress is Roon's reported second, VERBATIM (Peter, 08-28) — the store
 * holds that rule and nothing here may add a browser clock on top.
 *
 * There are no transport buttons, deliberately: on the device the glass commits
 * (tap the centre, swipe for next and previous), so drawn buttons would
 * contradict the grammar and cost the room name its space at 360px.
 *
 * ES2018 floor, like every other shipped asset.
 */

var root = document.getElementById('puck');
var SVG_NS = 'http://www.w3.org/2000/svg';

/** Close to the rim: the art runs under it, so the ring reads as the edge. */
var RING_R = 47;
var RING_C = 2 * Math.PI * RING_R;
var BEZEL_RATIO = 0.085;

/** The field behind a missing cover: the art drawn tiny and scaled up. */
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

var cover = el('div', 'cover');
var coverImg = document.createElement('img');
coverImg.alt = '';
cover.appendChild(coverImg);

var scrimTop = el('div', 'scrim-top');
var scrimFoot = el('div', 'scrim-foot');

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
ringArc.setAttribute('transform', 'rotate(-90 50 50)');   // twelve o'clock, clockwise
ringArc.setAttribute('stroke-dasharray', String(RING_C));
ringArc.setAttribute('stroke-dashoffset', String(RING_C));
var ringBead = document.createElementNS(SVG_NS, 'circle');
ringBead.setAttribute('class', 'ring-bead');
ringBead.setAttribute('r', '1.9');
ringBead.style.display = 'none';
ring.appendChild(ringTrack);
ring.appendChild(ringArc);
ring.appendChild(ringBead);

var room = el('div', 'room');
var words = el('div', 'words');
var title = el('div', 'title');
var line2 = el('div', 'line2');
words.appendChild(title);
words.appendChild(line2);
var times = el('div', 'times');
var note = el('div', 'note', 'connecting');

glass.appendChild(cover);
glass.appendChild(scrimTop);
glass.appendChild(scrimFoot);
glass.appendChild(ring);
glass.appendChild(room);
glass.appendChild(words);
glass.appendChild(times);
glass.appendChild(note);
rig.appendChild(glass);
root.appendChild(rig);

/* ---------- geometry: the SHORT side, never vw ---------- */

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
    var rigPx = Math.max(180, Math.floor(side * 0.94));
    glassPx = Math.max(150, Math.round(rigPx / (1 + 2 * BEZEL_RATIO)));
  }
  var bezelPx = Math.max(8, Math.round(glassPx * BEZEL_RATIO));
  rig.style.setProperty('--glass', String(glassPx) + 'px');
  rig.style.setProperty('--bezel-w', String(bezelPx) + 'px');
  rig.style.setProperty('--u', String(glassPx / 100) + 'px');
}

window.addEventListener('resize', layout);
layout();

/* ---------- what this puck is looking at ---------- */

function stampOf(zone) {
  return Date.parse(zone.lastPlayedAt === null ? '' : zone.lastPlayedAt) || 0;
}

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

var coverKey = null;
var groundCanvas = null;

/** No artwork: a flat field rather than a hole, so the dial is still an object. */
function fallbackField() {
  if (groundCanvas === null) {
    groundCanvas = document.createElement('canvas');
    groundCanvas.width = GROUND_PX;
    groundCanvas.height = GROUND_PX;
    groundCanvas.style.width = '100%';
    groundCanvas.style.height = '100%';
    groundCanvas.style.display = 'block';
    var context = groundCanvas.getContext('2d');
    context.fillStyle = '#15171c';
    context.fillRect(0, 0, GROUND_PX, GROUND_PX);
  }
  return groundCanvas;
}

function paintCover(art) {
  if (art === null) {
    if (coverKey !== null) { coverImg.removeAttribute('src'); coverKey = null; }
    coverImg.style.display = 'none';
    if (fallbackField().parentNode === null) cover.appendChild(fallbackField());
    return;
  }
  coverImg.style.display = '';
  if (groundCanvas !== null && groundCanvas.parentNode !== null) cover.removeChild(groundCanvas);
  if (art.key === coverKey) return;
  coverKey = art.key;
  coverImg.src = art.path;
}

function setArc(fraction) {
  if (fraction === null) {
    ringArc.setAttribute('stroke-dashoffset', String(RING_C));
    ringBead.style.display = 'none';
    return;
  }
  var clamped = Math.max(0, Math.min(1, fraction));
  ringArc.setAttribute('stroke-dashoffset', String(RING_C * (1 - clamped)));
  // Twelve o'clock, clockwise — the same convention the Dial's ring uses.
  var angle = (clamped * 2 * Math.PI) - (Math.PI / 2);
  ringBead.setAttribute('cx', String(50 + RING_R * Math.cos(angle)));
  ringBead.setAttribute('cy', String(50 + RING_R * Math.sin(angle)));
  ringBead.style.display = '';
}

/** When it ends, on the wall clock — the Dial's signature reading. */
function endsAt(remainingSec) {
  var end = new Date(Date.now() + remainingSec * 1000);
  var h = end.getHours();
  var m = end.getMinutes();
  return String(h) + ':' + (m < 10 ? '0' + String(m) : String(m));
}

function render() {
  var snapshot = store.snapshot();
  var zone = pickZone(snapshot);
  if (zone === null) {
    room.textContent = '';
    title.textContent = '';
    line2.textContent = '';
    times.textContent = '';
    paintCover(null);
    setArc(null);
    return;
  }

  room.textContent = zone.name;

  var np = zone.nowPlaying;
  if (np === null) {
    title.textContent = zone.state === 'stopped' ? 'Nothing playing' : '';
    line2.textContent = '';
    times.textContent = '';
    paintCover(null);
    setArc(null);
    return;
  }

  title.textContent = np.title;
  line2.textContent = np.line2;
  paintCover(np.art);

  // The store returns null for a live stream: an ever-rising seek_position with
  // no duration is a stream-age counter, not progress, and must not draw an arc.
  var position = store.positionSec(zone);
  var length = np.lengthSec;
  if (position === null || typeof length !== 'number' || length <= 0) {
    times.textContent = '';
    setArc(null);
    return;
  }
  var remaining = Math.max(0, length - position);
  times.innerHTML = '';
  var strong = document.createElement('b');
  strong.textContent = '−' + formatTime(remaining);
  times.appendChild(strong);
  times.appendChild(document.createTextNode(' ENDS ' + endsAt(remaining)));
  setArc(position / length);
}

var store = createStore(render);
store.hydrate();
createStream(store, function (state) { root.setAttribute('data-state', state); });
render();
