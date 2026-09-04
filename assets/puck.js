import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { seekTargetSecond } from './seek-target.js';
import { createSeekIntentGate } from './seek-intent.js';
import { createBrowse } from './puck-browse.js';
import { glyph } from './puck-icons.js';
import { createVolumeGate, levelAtAngle } from './volume-gate.js';
import { readPalette } from './sleeve-palette.js';

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
 * ⚖️ THE SCALE IS THE VOLUME; THE RING IS THE POSITION (Peter, 09-03). The
 * bezel is the wheel, and its scale of a hundred ticks lights up to the level —
 * the reading sits ON the thing you turn, outside the glass. The glass keeps
 * one ring, progress, inside its edge. Nothing else is drawn on the sleeve,
 * which is cropped to the circle and fills it to the edge. Both start at twelve.
 *
 * ⚖️ Progress is Roon's reported second, VERBATIM (Peter, 08-28) — the store
 * holds that rule and nothing here may add a browser clock on top.
 *
 * ⚖️ THE VERBS (09-02, settled against the hardware): the WHEEL adjusts, the
 * GLASS commits, the HAPTIC confirms. There is no wheel press — Waveshare's copy
 * claims one and the pinout is quadrature-only — so a tap that ticks IS the
 * press. Turn · tap · swipe, and nothing else.
 *
 *     wheel turn      volume · move the selection
 *     tap the centre  play/pause · select
 *     swipe ← →       next · previous
 *     tap the ring    seek
 *     swipe ↑ ↓       climb · descend  (one axis, three stops)
 *
 * ⚖️ THE OVERLAY (Peter, 09-03). The first cut drew no transport buttons on the
 * ground that the glass commits — true of the DEVICE, but a mock has to show
 * what the firmware will draw. So the five controls are SUMMONED: invisible at
 * rest, raised by a touch or a mouse move, asleep again after a quiet spell.
 * The first touch only summons — it never acts — because a puck lives where a
 * hand brushes past it, and a brush must not pause the room.
 *
 * ES2018 floor, like every other shipped asset.
 */

var root = document.getElementById('puck');
var SVG_NS = 'http://www.w3.org/2000/svg';

/** Close to the rim: the art runs under it, so the rings read as the edge. */
var PROG_R = 42;
var PROG_C = 2 * Math.PI * PROG_R;
var BEZEL_RATIO = 0.085;

/**
 * ⚖️ OUTER = VOLUME, INNER = POSITION, in the HAND and not only in the drawing
 * (Peter, 09-03: "the outer ring is still seeking rather than adjusting
 * volume"). The seek band had run right out to the rim, so a finger on the
 * dots landed a few pixels inside the glass and the glass said "seek". Now the
 * glass has three bands: inside SEEK_BAND it is the face; from there to
 * WHEEL_BAND it is the position ring; and its outer edge joins the bezel as one
 * wheel — a tap sets the level, a circular drag turns it — wide enough for a
 * finger to find without looking.
 */
var SEEK_BAND = 34;
var WHEEL_BAND = 45;

/** The field behind a missing cover: the art drawn tiny and scaled up. */
var GROUND_PX = 20;

/** How long the summoned controls stand before the face goes back to the music. */
var CHROME_MS = 5000;

/** One detent of the bezel, in degrees. Measured per revolution on the board (I2). */
var DETENT_DEG = 12;

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- the device ---------- */

var rig = el('div', 'rig');
var glass = el('div', 'glass');

/**
 * The knurl, drawn — and it IS the volume readout. One dot per detent from
 * twelve o'clock clockwise; the dots up to the level are lit. A turn has
 * something to be measured against, and the reading sits on the wheel itself.
 */
var detents = document.createElementNS(SVG_NS, 'svg');
detents.setAttribute('class', 'detents');
detents.setAttribute('viewBox', '0 0 100 100');
/**
 * ⚖️ A SCALE, 0 TO 100 ROUND THE DIAL (Peter, 09-03: "not granular enough —
 * maybe 0 (mute) to 100 around the circle, small radials rather than dots").
 * A hundred fine radial ticks from twelve o'clock clockwise, every tenth
 * longer, lit up to the level: a tap on the wheel lands to one percent. The
 * DRAG still moves a device step per twelve degrees — that is the detent the
 * board has and the budget the gate was written for; the tap is the fine path.
 */
var SCALE = 100;
var ticks = [];
for (var tick = 0; tick < SCALE; tick += 1) {
  var mark = document.createElementNS(SVG_NS, 'line');
  var tickAngle = ((tick / SCALE) * 360 - 90) * Math.PI / 180;   // twelve o'clock, clockwise
  var major = tick % 10 === 0;
  var outer = 49.2;
  var inner = major ? 46.4 : 47.6;
  mark.setAttribute('class', major ? 'tick major' : 'tick');
  mark.setAttribute('x1', String(50 + inner * Math.cos(tickAngle)));
  mark.setAttribute('y1', String(50 + inner * Math.sin(tickAngle)));
  mark.setAttribute('x2', String(50 + outer * Math.cos(tickAngle)));
  mark.setAttribute('y2', String(50 + outer * Math.sin(tickAngle)));
  detents.appendChild(mark);
  ticks.push(mark);
}
rig.appendChild(detents);

var cover = el('div', 'cover');
var coverImg = document.createElement('img');
coverImg.alt = '';
cover.appendChild(coverImg);

var scrimTop = el('div', 'scrim-top');
var scrimFoot = el('div', 'scrim-foot');

var ring = document.createElementNS(SVG_NS, 'svg');
ring.setAttribute('class', 'ring');
ring.setAttribute('viewBox', '0 0 100 100');

function circle(className, radius) {
  var node = document.createElementNS(SVG_NS, 'circle');
  node.setAttribute('class', className);
  node.setAttribute('cx', '50');
  node.setAttribute('cy', '50');
  node.setAttribute('r', String(radius));
  return node;
}

function arcOf(className, radius, circumference) {
  var node = circle(className, radius);
  // Twelve o'clock, clockwise — the convention every FlightDeck ring shares.
  node.setAttribute('transform', 'rotate(-90 50 50)');
  node.setAttribute('stroke-dasharray', String(circumference));
  node.setAttribute('stroke-dashoffset', String(circumference));
  return node;
}

/**
 * ONE ring on the glass: progress at the rim. A first cut drew volume beside it
 * with tracks and a dark gutter under both, and the face read as five
 * concentric lines with the sleeve stopping short (Peter, 09-03: "too many
 * rings", "art doesn't fill circle"). Volume lives on the bezel's dots now.
 */
var progTrack = circle('prog-track', PROG_R);
/**
 * A hairline dark halo under the arc — the arc's own edge, not a ring. It is
 * what lets the accent stay the sleeve's colour: legibility comes from the
 * halo, so the tone need not be pushed to white or to mud to be seen.
 */
var progHalo = arcOf('prog-halo', PROG_R, PROG_C);
var progArc = arcOf('prog-arc', PROG_R, PROG_C);
var progBead = document.createElementNS(SVG_NS, 'circle');
progBead.setAttribute('class', 'prog-bead');
progBead.setAttribute('r', '1.8');
progBead.style.display = 'none';
ring.appendChild(progTrack);
ring.appendChild(progHalo);
ring.appendChild(progArc);
ring.appendChild(progBead);

var room = el('div', 'room');

var words = el('div', 'words');
var title = el('div', 'title');
var artist = el('div', 'artist');
var album = el('div', 'album');
words.appendChild(title);
words.appendChild(artist);
words.appendChild(album);
var note = el('div', 'note', 'connecting');
var toast = el('div', 'toast');

/* ---------- the summoned cluster ---------- */

var pad = el('div', 'pad');
var padVeil = el('div', 'pad-veil');
pad.appendChild(padVeil);

function button(name, className) {
  var node = el('div', 'btn ' + className);
  node.setAttribute('data-shows', name);
  node.appendChild(glyph(name));
  return node;
}

var btnRepeat = button('repeat', 'btn-repeat');
var btnPrev = button('prev', 'btn-prev');
var btnPlay = button('play', 'btn-play');
var btnNext = button('next', 'btn-next');
var btnShuffle = button('shuffle', 'btn-shuffle');

pad.appendChild(btnRepeat);
pad.appendChild(btnPrev);
pad.appendChild(btnPlay);
pad.appendChild(btnNext);
pad.appendChild(btnShuffle);

glass.appendChild(cover);
glass.appendChild(scrimTop);
glass.appendChild(scrimFoot);
glass.appendChild(ring);
glass.appendChild(room);
glass.appendChild(words);
glass.appendChild(pad);
glass.appendChild(note);
glass.appendChild(toast);
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

/**
 * The durable OUTPUT first, exactly as the Face binds. A puck belongs to the
 * speaker in the room: grouping disposes of zone ids, and a hand device that
 * loses its room the moment the house is grouped is worse than one that follows.
 */
var boundOutputId = root.getAttribute('data-output') || null;
var wantedZoneId = root.getAttribute('data-zone') || '';
var wantedSlug = root.getAttribute('data-zone-slug') || '';

function slugOf(name) {
  return String(name === undefined || name === null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stampOf(zone) {
  return Date.parse(zone.lastPlayedAt === null ? '' : zone.lastPlayedAt) || 0;
}

function namesOf(zone) {
  var all = [slugOf(zone.name)];
  for (var i = 0; i < zone.outputs.length; i += 1) all.push(slugOf(zone.outputs[i].name));
  return all;
}

function pickZone(snapshot) {
  if (snapshot === null || !Array.isArray(snapshot.zones) || snapshot.zones.length === 0) return null;
  var zones = snapshot.zones;
  var i;
  var j;
  if (boundOutputId !== null) {
    for (i = 0; i < zones.length; i += 1) {
      for (j = 0; j < zones[i].outputs.length; j += 1) {
        if (zones[i].outputs[j].id === boundOutputId) return zones[i];
      }
    }
  }
  if (wantedZoneId !== '') {
    for (i = 0; i < zones.length; i += 1) if (zones[i].id === wantedZoneId) return zones[i];
  }
  /**
   * The NAME is the fallback, not a nicety: a zone id does not survive every
   * Core change, and a puck bolted to a wall must re-find its room by name
   * rather than going dark until somebody reloads it.
   */
  if (wantedSlug !== '') {
    var named = [];
    for (i = 0; i < zones.length; i += 1) {
      if (namesOf(zones[i]).indexOf(wantedSlug) !== -1) named.push(zones[i]);
    }
    if (named.length > 0) {
      for (i = 0; i < named.length; i += 1) if (named[i].state === 'playing') return named[i];
      return named[0];
    }
  }
  var best = null;
  for (i = 0; i < zones.length; i += 1) {
    if (zones[i].state !== 'playing') continue;
    if (best === null || stampOf(zones[i]) > stampOf(best)) best = zones[i];
  }
  return best !== null ? best : zones[0];
}

function currentZone() { return pickZone(store.snapshot()); }

/**
 * ⚖️ VOLUME ACTS ON ONE OUTPUT — the speaker in this room — never on a whole
 * grouped house. The bound output when there is one; otherwise the zone's head,
 * which is the room whose queue the group is playing.
 */
function currentOutput() {
  var zone = currentZone();
  if (zone === null || zone.outputs.length === 0) return null;
  if (boundOutputId !== null) {
    for (var i = 0; i < zone.outputs.length; i += 1) {
      if (zone.outputs[i].id === boundOutputId) return zone.outputs[i];
    }
  }
  return zone.outputs[0];
}

/* ---------- talking to the deck ---------- */

function command(body) {
  return fetch('/api/v1/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (response) {
    if (!response.ok) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        flash(data.error || ('control failed (' + String(response.status) + ')'));
      });
    }
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

/**
 * ⚖️ THE HAPTIC CONFIRMS (09-02). On the board that is a DRV2605 click; in the
 * browser it is whatever the device has, which on a phone is the same gesture
 * answered the same way. Absent on a desktop, and that is fine — it is
 * confirmation, never the channel.
 */
function haptic(ms) {
  if (typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(ms); } catch (error) { /* a browser that lies about it */ }
}

var seekIntent = createSeekIntentGate(function (body) { return command(body); });

function transport(action) {
  var zone = currentZone();
  if (zone === null) return;
  if (action === 'next' && !zone.allowed.next) { flash('next is not available here'); return; }
  if (action === 'previous' && !zone.allowed.previous) { flash('previous is not available here'); return; }
  haptic(12);
  command({ action: action, zone: zone.id });
}

/* ---------- the wheel ---------- */

/**
 * ⚠️⚠️ 09-03, 22:14 — A RUNAWAY. 119 volume commands reached Study ROON in
 * three bursts, +104 steps net, at up to six steps a second: a scroll wheel
 * with inertia fires dozens of events a second, every one was counted as a
 * detent, and every 140 ms window sent another batch. The room climbed from 11
 * toward its maximum with nobody's hand on anything.
 *
 * ⚖️ EVERYTHING between the hand and the wire now lives in volume-gate.js, where
 * it is proven offline: distance is quantised into detents, one request is in
 * flight at a time, five steps a second is the budget, twelve is the most a
 * spin may move a room before the wheel rests, and the reading under the hand
 * never runs more than four ahead of what Roon has confirmed. The replayed flood
 * sends twelve steps, not a hundred and four (test/volume-gate.test.ts).
 *
 * ⚖️ ONE DETENT, ONE STEP. The bezel has physical detents, so each is a discrete
 * step and the tap-only volume ruling survives on the device untouched.
 */
var turningTimer = null;
var confirmedVolume = null;   // { outputId, value } — the last level Roon reported

function volumeBounds(output) {
  var volume = output.volume;
  var min = volume.min === null ? 0 : volume.min;
  var max = volume.max === null ? 100 : volume.max;
  return { min: min, max: max, step: volume.step === null || volume.step === 0 ? 1 : volume.step };
}

function showTurning() {
  root.setAttribute('data-turning', '1');
  if (turningTimer !== null) clearTimeout(turningTimer);
  turningTimer = setTimeout(function () {
    root.removeAttribute('data-turning');
    turningTimer = null;
  }, 1400);
}

var volumeGate = createVolumeGate(function (steps) {
  var output = currentOutput();
  if (output === null || output.volume === null) return null;
  return command({ action: 'volume', output: output.id, steps: steps });
});

function turn(step) {
  var output = currentOutput();
  if (output === null) return;
  if (output.volume === null) { flash(output.name + ' has no volume control'); return; }
  wake();   // the bezel has a place; a hand on it means it
  var verdict = volumeGate.step(step);
  showTurning();
  if (verdict === 'rest') { flash('rest the wheel'); return; }
  if (verdict !== 'sent') return;
  haptic(6);
  render();
}

/* ---------- the summoned chrome ---------- */

var chromeTimer = null;
var chromeUp = false;

function wake() {
  if (browse.isOpen()) return false;
  var first = !chromeUp;
  chromeUp = true;
  root.setAttribute('data-chrome', '1');
  if (chromeTimer !== null) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(sleep, CHROME_MS);
  if (first) render();
  return first;
}

function sleep() {
  if (chromeTimer !== null) { clearTimeout(chromeTimer); chromeTimer = null; }
  chromeUp = false;
  root.removeAttribute('data-chrome');
  render();
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

/**
 * ⚖️ SUBTLE COLOUR AND CONTRAST FROM THE SLEEVE (Peter, 09-03). The ring takes
 * the sleeve's own tone, lifted until it measurably clears the band of art it
 * is drawn over; the bezel is tinted a third of the way toward the sleeve's
 * deep tone; and the scrim under the credit is as strong as the sleeve's foot
 * needs. Nothing touches the cover itself. A sleeve with no colour to lend — an
 * all-black or all-white cover — leaves the face's own defaults standing.
 */
var DEFAULT_PAINT = { accent: 'rgb(204, 98, 102)', bezelFace: '#202329', bezelLip: '#34383f' };

function paintFromSleeve(tones) {
  var style = document.documentElement.style;
  style.setProperty('--accent', tones === null ? DEFAULT_PAINT.accent : tones.ring);
  style.setProperty('--bezel-face', tones === null ? DEFAULT_PAINT.bezelFace : tones.bezelFace);
  style.setProperty('--bezel-lip', tones === null ? DEFAULT_PAINT.bezelLip : tones.bezelLip);
  root.setAttribute('data-foot', tones !== null && tones.foot > 0.35 ? 'bright' : 'dark');
}

function paintCover(art) {
  if (art === null) {
    if (coverKey !== null) { coverImg.removeAttribute('src'); coverKey = null; paintFromSleeve(null); }
    coverImg.style.display = 'none';
    if (fallbackField().parentNode === null) cover.appendChild(fallbackField());
    return;
  }
  coverImg.style.display = '';
  if (groundCanvas !== null && groundCanvas.parentNode !== null) cover.removeChild(groundCanvas);
  if (art.key === coverKey) return;
  coverKey = art.key;
  coverImg.src = art.path;
  // Keyed to the sleeve it was read from: a late answer for the last track must
  // never paint this one.
  readPalette(art.path, function (tones) {
    if (coverKey !== art.key) return;
    paintFromSleeve(tones);
  });
}

function setArc(arc, circumference, fraction) {
  if (fraction === null) { arc.setAttribute('stroke-dashoffset', String(circumference)); return; }
  var clamped = Math.max(0, Math.min(1, fraction));
  arc.setAttribute('stroke-dashoffset', String(circumference * (1 - clamped)));
}

function setProgress(fraction) {
  setArc(progHalo, PROG_C, fraction);
  setArc(progArc, PROG_C, fraction);
  if (fraction === null) { progBead.style.display = 'none'; return; }
  var clamped = Math.max(0, Math.min(1, fraction));
  var angle = (clamped * 2 * Math.PI) - (Math.PI / 2);
  progBead.setAttribute('cx', String(50 + PROG_R * Math.cos(angle)));
  progBead.setAttribute('cy', String(50 + PROG_R * Math.sin(angle)));
  progBead.style.display = '';
}

function paintVolume() {
  var output = currentOutput();
  if (output === null || output.volume === null) {
    root.setAttribute('data-vol', 'none');
    confirmedVolume = null;
    volumeGate.reset();
    lightDetents(null);
    rig.removeAttribute('data-muted');
    return;
  }
  var volume = output.volume;
  if (volume.muted) rig.setAttribute('data-muted', '1'); else rig.removeAttribute('data-muted');
  if (volume.value === null || volume.max === null) {
    // An incremental output says only that it takes + and −: no level to read,
    // no dots to light, and inventing either would be a lie.
    root.setAttribute('data-vol', 'blind');
    lightDetents(null);
    return;
  }
  root.setAttribute('data-vol', 'level');
  // Roon reported a level. Whatever it answered is no longer owed to the hand,
  // and a wheel that moved to ANOTHER room owes nothing at all.
  if (confirmedVolume === null || confirmedVolume.outputId !== output.id) {
    volumeGate.reset();
  } else if (confirmedVolume.value !== volume.value) {
    volumeGate.confirm();
  }
  confirmedVolume = { outputId: output.id, value: volume.value };
  var bounds = volumeBounds(output);
  // The reading under the hand: Roon's number plus at most four unconfirmed
  // steps. A face may run a little ahead of the room; it may never run away.
  var shown = Math.max(bounds.min, Math.min(bounds.max,
    volume.value + volumeGate.ahead() * bounds.step));
  var span = Math.max(1, bounds.max - bounds.min);
  lightDetents((shown - bounds.min) / span);
}

/** The dots up to the level are lit, from twelve o'clock clockwise. */
function lightDetents(fraction) {
  var lit = fraction === null ? 0 : Math.round(Math.max(0, Math.min(1, fraction)) * ticks.length);
  for (var i = 0; i < ticks.length; i += 1) {
    var major = i % 10 === 0;
    ticks[i].setAttribute('class', (major ? 'tick major' : 'tick') + (i < lit ? ' is-lit' : ''));
  }
}

function paintControls(zone) {
  var playing = zone !== null && (zone.state === 'playing' || zone.state === 'loading');
  var shows = playing ? 'pause' : 'play';
  if (btnPlay.getAttribute('data-shows') !== shows) {
    btnPlay.setAttribute('data-shows', shows);
    btnPlay.replaceChildren(glyph(shows));
  }
  var able = function (node, allowed) {
    if (allowed) node.removeAttribute('data-off');
    else node.setAttribute('data-off', '1');
  };
  able(btnPrev, zone !== null && zone.allowed.previous);
  able(btnNext, zone !== null && zone.allowed.next);

  var settings = zone === null ? null : zone.settings;
  able(btnShuffle, settings !== null);
  if (settings !== null && settings.shuffle) btnShuffle.setAttribute('data-on', '1');
  else btnShuffle.removeAttribute('data-on');

  // Repeat asks the CORE to cycle, so off/all/one is Roon's order, not ours.
  var loop = settings === null ? 'disabled' : settings.loop;
  var wants = loop === 'loop_one' ? 'repeat-one' : 'repeat';
  if (btnRepeat.getAttribute('data-shows') !== wants) {
    btnRepeat.setAttribute('data-shows', wants);
    btnRepeat.replaceChildren(glyph(wants));
  }
  able(btnRepeat, settings !== null);
  if (loop === 'loop' || loop === 'loop_one') btnRepeat.setAttribute('data-on', '1');
  else btnRepeat.removeAttribute('data-on');
}

function render() {
  var zone = currentZone();
  paintVolume();
  paintControls(zone);
  if (zone === null) {
    room.textContent = '';
    title.textContent = '';
    artist.textContent = '';
    album.textContent = '';
    paintCover(null);
    setProgress(null);
    return;
  }

  room.textContent = zone.name;

  var np = zone.nowPlaying;
  if (np === null) {
    title.textContent = zone.state === 'stopped' ? 'Nothing playing' : '';
    artist.textContent = '';
    album.textContent = '';
    paintCover(null);
    setProgress(null);
    return;
  }

  title.textContent = np.title;
  artist.textContent = np.line2;
  album.textContent = np.line3;
  paintCover(np.art);

  /**
   * ⚖️ THE RING IS THE CLOCK (Peter, 09-03: "remove ends time and time elapsed
   * — rely on the progress"). No numbers under the credit: the arc says how far,
   * and that is all a face at arm's length needs. The store returns null for a
   * live stream — an ever-rising seek_position with no duration is a stream-age
   * counter, not progress — and then there is no arc either.
   */
  var position = store.positionSec(zone);
  var length = np.lengthSec;
  if (position === null || typeof length !== 'number' || length <= 0) { setProgress(null); return; }
  setProgress(position / length);
}

/* ---------- the browse face ---------- */

var browse = createBrowse({
  host: glass,
  root: root,
  el: el,
  zoneId: function () { var zone = currentZone(); return zone === null ? null : zone.id; },
  flash: flash,
  tick: function () { haptic(6); },
  onChange: function (open) {
    if (open) sleep();
    render();
  },
});

// The browse layer was appended last and would otherwise paint over the toast —
// which is the only place a refusal is legible on a device with no error surface.
glass.appendChild(toast);

/* ---------- the glass: tap, swipe, and the ring ---------- */

var SWIPE_MIN = 0.10;     // of the glass, so the gesture scales with the device
var TAP_SLOP = 0.04;

var touch = null;

function glassMetrics() {
  var box = glass.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width / 2, size: box.width };
}

/** Where a point sits on the face, in the same 0–100 units the rings are drawn in. */
function radiusOf(metrics, clientX, clientY) {
  var dx = clientX - metrics.x;
  var dy = clientY - metrics.y;
  return metrics.r === 0 ? 0 : (Math.sqrt(dx * dx + dy * dy) / metrics.r) * 50;
}

function seekTo(clientX, clientY) {
  var zone = currentZone();
  if (zone === null || zone.nowPlaying === null) return;
  if (!zone.allowed.seek) { flash('seeking is not available here'); return; }
  var length = zone.nowPlaying.lengthSec;
  if (typeof length !== 'number' || length <= 0) { flash('seeking is not available here'); return; }
  var metrics = glassMetrics();
  // Twelve o'clock, clockwise: the same convention the ring is drawn with, so
  // the place you touch is the place the bead lands.
  var angle = Math.atan2(clientY - metrics.y, clientX - metrics.x) + Math.PI / 2;
  var fraction = ((angle / (2 * Math.PI)) % 1 + 1) % 1;
  var seconds = seekTargetSecond(fraction, length);
  if (seconds === null) return;
  haptic(12);
  flash('seek to ' + formatTime(seconds));
  seekIntent.seek({ zone: zone.id, seconds: seconds });
}

function tapped(clientX, clientY) {
  var metrics = glassMetrics();
  var band = radiusOf(metrics, clientX, clientY) >= SEEK_BAND;
  // While a menu is up the rim belongs to nothing: seeking mid-browse would act
  // on music the person has already stopped looking at.
  if (browse.isOpen()) { if (!band) browse.commit(); return; }
  /**
   * ⚖️ A CONTROL WITH A PLACE ACTS ON THE FIRST TOUCH (Peter, 09-03: "volume and
   * seek are seemingly timed"). The ring, a dot, the title — each names what it
   * does by where it is, so a tap there is never a brush. Only the CENTRE
   * summons first: it is the one target a passing hand can land on, and what
   * it does is pause the room.
   */
  if (band) { wake(); seekTo(clientX, clientY); return; }
  if (wake()) return;
  // Everything the cluster owns is a real button; the field around it is the
  // centre tap, which on the device IS the press the wheel does not have.
  transport('playpause');
}

function swiped(dx, dy, size) {
  var far = Math.max(Math.abs(dx), Math.abs(dy));
  if (far < size * SWIPE_MIN) return false;
  wake();
  if (Math.abs(dx) > Math.abs(dy)) {
    if (browse.isOpen()) { browse.move(dx < 0 ? 1 : -1); return true; }
    transport(dx < 0 ? 'next' : 'previous');
    return true;
  }
  /**
   * ⚖️ ONE AXIS WITH THREE STOPS: ↑ always climbs and ↓ always descends, at every
   * depth, so a repeated ↑ walks home from anywhere. Rooms sit one stop above
   * PLAY and are not built yet (I4) — an ↑ from the top is deliberately silent
   * rather than a promise the device cannot keep.
   */
  if (dy > 0) {
    if (browse.isOpen()) browse.commit();
    else browse.open('browse');
  } else {
    if (browse.isOpen()) browse.back();
  }
  return true;
}

glass.addEventListener('pointerdown', function (event) {
  if (event.button !== undefined && event.button !== 0) return;
  // The glass's outer edge IS the wheel: hand it to the bezel, not the face.
  if (!browse.isOpen() && radiusOf(glassMetrics(), event.clientX, event.clientY) >= WHEEL_BAND) {
    beginTurn(event);
    return;
  }
  touch = { x: event.clientX, y: event.clientY, at: Date.now() };
});

glass.addEventListener('pointerup', function (event) {
  if (touch === null) return;
  var start = touch;
  touch = null;
  var dx = event.clientX - start.x;
  var dy = event.clientY - start.y;
  var metrics = glassMetrics();
  if (swiped(dx, dy, metrics.size)) return;
  if (Math.abs(dx) > metrics.size * TAP_SLOP || Math.abs(dy) > metrics.size * TAP_SLOP) return;
  tapped(event.clientX, event.clientY);
});

glass.addEventListener('pointercancel', function () { touch = null; });

/** A mouse crossing the glass is the desk equivalent of a hand approaching it. */
glass.addEventListener('pointermove', function (event) {
  if (event.pointerType === 'touch') return;
  wake();
});

/* ---------- the cluster's own presses ---------- */

function press(node, act) {
  node.addEventListener('click', function (event) {
    event.stopPropagation();
    if (node.getAttribute('data-off') === '1') return;
    // The same rule the glass obeys: a touch on a sleeping face only summons.
    if (wake()) return;
    act();
  });
  // The glass gesture handler must not also read a button press as a tap.
  node.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
  node.addEventListener('pointerup', function (event) { event.stopPropagation(); });
}

press(btnPlay, function () { transport('playpause'); });
press(btnPrev, function () { transport('previous'); });
press(btnNext, function () { transport('next'); });
press(btnShuffle, function () {
  var zone = currentZone();
  if (zone === null) return;
  haptic(12);
  command({ action: 'shuffle', zone: zone.id });
});
press(btnRepeat, function () {
  var zone = currentZone();
  if (zone === null) return;
  haptic(12);
  command({ action: 'repeat', zone: zone.id });
});

/**
 * ⚖️ THE WORDS ARE THE WAY IN, ON ONE TAP (Peter, 09-03: "doesn't click to the
 * browse selector on clicking metadata"). A first cut made the credit obey the
 * summon rule like everything else, so a tap on the title only raised the
 * overlay and it took a second to browse — seven play/pauses in the log were
 * a person tapping the middle to find out what had happened. A tap on the
 * title is not a brush: it is the most deliberate thing on the face, and it
 * goes straight to the library.
 */
words.addEventListener('click', function (event) {
  event.stopPropagation();
  haptic(10);
  browse.open('browse');
});
words.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
words.addEventListener('pointerup', function (event) { event.stopPropagation(); });

/**
 * ⚖️ THE PUCK IS A NORMAL FACE OPTION (Peter, 09-03), which cuts both ways: a
 * screen that chose it from the faces list must be able to choose another. The
 * room name is the way back — it lands on the face the screen had before, which
 * the Face kept beside its memory, and forgets "puck" so the Face does not turn
 * straight round.
 */
room.addEventListener('click', function (event) {
  event.stopPropagation();
  var before = 'presence';
  try {
    before = localStorage.getItem('flightdeck.face.before.' + wantedZoneId) || 'presence';
    localStorage.setItem('flightdeck.face.' + wantedZoneId, before);
  } catch (error) { /* private mode: the Face falls back to presence */ }
  haptic(10);
  window.location.href = '/face/' + encodeURIComponent(boundOutputId || wantedZoneId || '') + '?face=' + before;
});
room.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
room.addEventListener('pointerup', function (event) { event.stopPropagation(); });

/* ---------- the bezel: a turn, quantised to its detents ---------- */

var turning = null;

function angleAt(event) {
  var box = rig.getBoundingClientRect();
  var dx = event.clientX - (box.left + box.width / 2);
  var dy = event.clientY - (box.top + box.height / 2);
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

/** A hand on the wheel — the bezel itself, or the glass's outer edge. */
function beginTurn(event) {
  turning = { angle: angleAt(event), carried: 0, moved: 0, at: Date.now() };
  rig.className = 'rig is-turning';
  try { rig.setPointerCapture(event.pointerId); } catch (error) { /* mouse without capture */ }
}

rig.addEventListener('pointerdown', function (event) {
  if (event.target !== rig && event.target !== detents && event.target.parentNode !== detents) return;
  beginTurn(event);
});

/**
 * ⚖️ THE DOTS ARE THE CONTROL (Peter, 09-03: "that should be the control"). A
 * tap on the bezel sets the level to the dot under the finger — one press, one
 * level, the tap-only rule the Wall's volume bar lives by — while a drag still
 * turns it a detent at a time. One tap is one intention and cannot repeat
 * itself, so it goes straight to Roon as an absolute value, bounded by the
 * device's own range. It acts on the first touch: a dot has a place, and a tap
 * on it is never a brush (Peter, 09-03: "volume and seek are seemingly timed").
 */
var lastBezelTap = 0;
function tapBezel(degrees) {
  if (browse.isOpen()) return;
  var output = currentOutput();
  if (output === null) return;
  if (output.volume === null) { flash(output.name + ' has no volume control'); return; }
  wake();   // raise the readout; a dot has a place, so the tap itself acts
  var now = Date.now();
  if (now - lastBezelTap < 300) return;
  lastBezelTap = now;
  var bounds = volumeBounds(output);
  var value = levelAtAngle(degrees, bounds.min, bounds.max, ticks.length);
  if (value === null) return;
  haptic(12);
  showTurning();
  command({ action: 'volume', output: output.id, value: value });
}

rig.addEventListener('pointermove', function (event) {
  if (turning === null) return;
  var now = angleAt(event);
  var delta = now - turning.angle;
  // Crossing twelve o'clock is a small turn, not a full revolution backwards.
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  turning.angle = now;
  turning.carried += delta;
  turning.moved += Math.abs(delta);
  while (Math.abs(turning.carried) >= DETENT_DEG) {
    var step = turning.carried > 0 ? 1 : -1;
    turning.carried -= step * DETENT_DEG;
    if (browse.isOpen()) browse.move(step);
    else turn(step);
  }
});

function endTurn(event) {
  if (turning === null) return;
  var was = turning;
  turning = null;
  rig.className = 'rig';
  // Barely moved and quickly released: that was a tap on a dot, not a turn.
  if (event && event.type === 'pointerup' && was.moved < DETENT_DEG / 2 && Date.now() - was.at < 600) {
    tapBezel(angleAt(event));
  }
}

rig.addEventListener('pointerup', endTurn);
rig.addEventListener('pointercancel', endTurn);

/**
 * A scroll wheel IS the bezel on a desk, and the only way to demonstrate the
 * wheel without the hardware in hand.
 */
window.addEventListener('wheel', function (event) {
  // A wheel event is DISTANCE. A mouse notch is about a hundred units; a
  // trackpad sends the same distance as dozens of small ones, and inertia keeps
  // sending after the fingers have left. The gate turns distance into detents.
  var delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 33;
  else if (event.deltaMode === 2) delta *= 100;
  volumeGate.scroll(delta, function (dir) {
    if (browse.isOpen()) { browse.move(dir); return; }
    // The one input with NO place: a scroll can land on an idle page from a
    // hand that meant another window. So a sleeping face is only woken by it,
    // and the next detent acts — the bezel and its dots never wait.
    if (wake()) { showTurning(); return; }
    turn(-dir);
  });
}, { passive: true });

/* ---------- the keyboard: the same three verbs, for a desk ---------- */

window.addEventListener('keydown', function (event) {
  var key = event.key;
  var open = browse.isOpen();
  if (key === 'ArrowDown') {
    if (open) browse.commit();
    else { wake(); browse.open('browse'); }
  } else if (key === 'ArrowUp') {
    if (open) browse.back();
    else wake();
  } else if (key === 'ArrowRight') {
    if (open) browse.move(1); else { wake(); transport('next'); }
  } else if (key === 'ArrowLeft') {
    if (open) browse.move(-1); else { wake(); transport('previous'); }
  } else if (key === 'Enter' || key === ' ') {
    if (open) browse.commit(); else { wake(); transport('playpause'); }
  } else if (key === 'Escape') {
    if (open) browse.close();
  } else if (key === '+' || key === '=') {
    turn(1);
  } else if (key === '-' || key === '_') {
    turn(-1);
  } else {
    return;
  }
  event.preventDefault();
});

/* ---------- boot ---------- */

var store = createStore(render);
store.hydrate();
createStream(store, function (state) { root.setAttribute('data-state', state); });
render();

/**
 * The rig affordances. `?browse=<hierarchy>` opens straight into a level and
 * `?chrome=1` raises the cluster, so a screenshot can catch a face that a
 * gesture would otherwise be needed for — and so a mock can be looked at
 * without a hand on it.
 */
if (root.getAttribute('data-chrome-param') === '1') wake();
var wantBrowse = root.getAttribute('data-browse-param');
if (wantBrowse) browse.open(wantBrowse);
