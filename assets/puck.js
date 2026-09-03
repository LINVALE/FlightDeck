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

/* ---------- browse: the clock face ---------- */

var browse = el('div', 'browse');
var browseVeil = el('div', 'browse-veil');
var level = el('div', 'level');
var optWrap = el('div', 'opt-wrap');
var chosen = el('div', 'chosen');
var chosenTitle = el('div', 'chosen-title');
var chosenSub = el('div', 'chosen-sub');
chosen.appendChild(chosenTitle);
chosen.appendChild(chosenSub);
var count = el('div', 'count');
var crumbs = document.createElementNS(SVG_NS, 'svg');
crumbs.setAttribute('class', 'ring');
crumbs.setAttribute('viewBox', '0 0 100 100');
browse.appendChild(browseVeil);
browse.appendChild(crumbs);
browse.appendChild(level);
browse.appendChild(optWrap);
browse.appendChild(chosen);
browse.appendChild(count);

glass.appendChild(cover);
glass.appendChild(scrimTop);
glass.appendChild(scrimFoot);
glass.appendChild(ring);
glass.appendChild(room);
glass.appendChild(words);
glass.appendChild(times);
glass.appendChild(browse);
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


/* ---------- the radial menu ---------- */

/**
 * ⚖️ THE TIER IS CHOSEN BEFORE THE ITEMS ARE LOADED.
 *
 * Roon reports `list.count` with the level, so the dial knows how to present it
 * without fetching first. Measured on a real library: Explore 7, Genres 56,
 * Albums 2295 — which is exactly why all three tiers have to exist.
 */
var RADIAL_MAX = 12;
var ALPHA_MAX = 200;
var OPT_R = 35;          // where the labels ring the face
var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function tierFor(n) {
  if (n <= RADIAL_MAX) return 'radial';
  if (n <= ALPHA_MAX) return 'alpha';
  return 'linear';
}

var view = { open: false, tier: 'radial', title: '', options: [], sel: 0, depth: 0, busy: false };

/** Our OWN session: Roon keeps one browse stack per multi_session_key, so a
 *  puck sharing the default would drag every other screen's level around. */
var SESSION = 'puck-' + String(Math.floor(Math.random() * 1e6));

function ask(body) {
  return fetch('/api/v1/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
}

function openLevel(hierarchy) {
  if (view.busy) return;
  view.busy = true;
  ask({ hierarchy: hierarchy, sessionKey: SESSION, popAll: true }).then(function (head) {
    if (head === null || head.list === null) { view.busy = false; return; }
    var total = head.list.count;
    var tier = tierFor(total);
    return ask({ hierarchy: hierarchy, sessionKey: SESSION, load: true, count: RADIAL_MAX })
      .then(function (page) {
        view.open = true;
        view.tier = tier;
        view.title = head.list.title;
        view.total = total;
        view.sel = 0;
        view.options = tier === 'alpha'
          ? ALPHABET.map(function (c) { return { title: c, subtitle: null }; })
          : ((page && page.items) ? page.items : []).slice(0, RADIAL_MAX);
        view.busy = false;
        drawBrowse();
      });
  }).catch(function () { view.busy = false; });
}

function closeBrowse() {
  view.open = false;
  root.removeAttribute('data-browse');
  root.removeAttribute('data-tier');
  render();
}

function move(step) {
  if (!view.open || view.options.length === 0) return;
  var n = view.options.length;
  view.sel = ((view.sel + step) % n + n) % n;
  drawBrowse();
}

function drawBrowse() {
  if (!view.open) return;
  root.setAttribute('data-browse', view.tier);
  root.setAttribute('data-tier', view.tier);
  level.textContent = view.title;

  while (optWrap.firstChild) optWrap.removeChild(optWrap.firstChild);
  var n = view.options.length;
  for (var i = 0; i < n; i += 1) {
    var angle = (i / n) * 2 * Math.PI - Math.PI / 2;   // twelve o'clock, clockwise
    var node = el('div', i === view.sel ? 'opt opt-on' : 'opt', view.options[i].title);
    node.style.left = String(50 + OPT_R * Math.cos(angle)) + '%';
    node.style.top = String(50 + OPT_R * Math.sin(angle)) + '%';
    (function (index) {
      node.addEventListener('click', function () { view.sel = index; drawBrowse(); });
    }(i));
    optWrap.appendChild(node);
  }

  var pick = view.options[view.sel];
  chosenTitle.textContent = pick ? pick.title : '';
  chosenSub.textContent = pick && pick.subtitle ? pick.subtitle : '';
  count.textContent = String(view.sel + 1) + ' / ' + String(view.tier === 'alpha' ? 26 : n)
    + (view.total > n && view.tier !== 'alpha' ? '  of ' + String(view.total) : '');

  // the cascade: one thin arc per level already descended
  while (crumbs.firstChild) crumbs.removeChild(crumbs.firstChild);
  for (var d = 0; d < view.depth; d += 1) {
    var c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', 'crumb');
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50');
    c.setAttribute('r', String(43 - d * 3));
    crumbs.appendChild(c);
  }
}

/* Wheel and arrows both move the selection: the wheel is the eyes-free path,
   touch is the accelerator. On the device these are the same two inputs. */
window.addEventListener('wheel', function (event) {
  if (!view.open) return;
  move(event.deltaY > 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('keydown', function (event) {
  var k = event.key;
  if (!view.open) {
    if (k === 'ArrowDown') openLevel('browse');
    return;
  }
  if (k === 'ArrowRight' || k === 'ArrowDown') move(1);
  else if (k === 'ArrowLeft' || k === 'ArrowUp') move(-1);
  else if (k === 'Escape') closeBrowse();
});

// The rig affordance: ?browse=<hierarchy> opens straight into a level, so a
// screenshot can be taken of a menu that a gesture would otherwise be needed for.
var wantBrowse = root.getAttribute('data-browse-param');
if (wantBrowse) openLevel(wantBrowse);

var store = createStore(render);
store.hydrate();
createStream(store, function (state) { root.setAttribute('data-state', state); });
render();
