import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { seekTargetSecond } from './seek-target.js';
import { createSeekIntentGate } from './seek-intent.js';
import { createBrowse } from './puck-browse.js';
import { nextStop } from './puck-axis.js';
import { glyph } from './puck-icons.js';
import { createVolumeGate, levelAtAngle } from './volume-gate.js';
import { readPalette, luminance } from './sleeve-palette.js';

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
 *     swipe ↑ ↓       the face above · below  (music · library · queue: a wheel)
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
/**
 * ⚖️ THE WHEEL SAYS ITS NUMBER (Peter, 09-04: "show on the volume dial what the
 * volume is numerically"). At the end of the lit run, just inside the ticks,
 * in the accent — the reading sits where the scale stops, as on any dial. The
 * large fading readout in the centre stays for the moment of a turn.
 */
var tickRead = document.createElementNS(SVG_NS, 'text');
tickRead.setAttribute('class', 'tick-read');
tickRead.setAttribute('text-anchor', 'middle');
tickRead.setAttribute('dominant-baseline', 'central');
tickRead.style.display = 'none';
detents.appendChild(tickRead);
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
/**
 * ⚖️ THE TIMES ARE ON THE DIAL (Peter, 09-04: "show progress/track length on
 * the dial"). Not a line under the credit — that was removed for good reason —
 * but a small tag that rides the bead round the ring: elapsed / length, where
 * the hand of a clock would be read. It sits just outside the arc, over it,
 * and takes no touch.
 */
/**
 * ⚖️ THE TIMES (Peter, 09-05): the ELAPSED time rides the arc's end as the bead
 * itself — a small round circle in the arc's own tone, with the halo's shade
 * and the bead's rim, never a white-on-black pill — and the LENGTH sits
 * quietly above the room name. One number where the arc ends, one where the
 * track's size is read once.
 */
var progRead = el('div', 'prog-read');
var progLength = el('div', 'prog-length');
var progBead = document.createElementNS(SVG_NS, 'circle');
progBead.setAttribute('class', 'prog-bead');
progBead.setAttribute('r', '1.8');
progBead.style.display = 'none';
ring.appendChild(progTrack);
ring.appendChild(progHalo);
ring.appendChild(progArc);
ring.appendChild(progBead);

var room = el('div', 'room');
var roomName = el('span', 'room-name');
room.appendChild(roomName);
/**
 * ⚖️ THE PUCK HAS NO WAY BACK TO THE WALL (Peter, 09-05: "the puck will never
 * have a back-to-the-wall option — it only ever controls one zone"). What it
 * has instead is a way to another ROOM: the hub of the rooms ring. The return
 * and the face options a browser needs live OUTSIDE the puck, in the page's
 * own chrome — the Face's mark and its "faces" door, drawn only where there
 * is an outside (a browser, a television), never on the device, and never
 * repeating a control the puck already has.
 */
var outside = el('div', 'outside');
var homeMark = el('span', 'homemark');
homeMark.appendChild(glyph('back'));
homeMark.setAttribute('title', 'back to every room');
homeMark.setAttribute('aria-label', 'go to the whole house');
var faceDoor = el('span', 'cog', 'faces');
faceDoor.setAttribute('title', 'this room on the screen, and its other faces');
outside.appendChild(homeMark);
outside.appendChild(faceDoor);
/**
 * ⚖️ A TURN OR A TAP ON THE WHEEL SHOWS THE LEVEL IN THE CENTRE, THEN FADES
 * (Peter, 09-03). The number, large, with the word under it — a knob that
 * answers a turn with a number is what makes the wheel feel connected — and
 * it goes again by itself, so the face's subject stays the music.
 */
var volRead = el('div', 'vol-read');
var volReadValue = el('b', 'vol-read-value');
var volReadLabel = el('span', 'vol-read-label', 'volume');
volRead.appendChild(volReadValue);
volRead.appendChild(volReadLabel);

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
/**
 * MUTE, between repeat and shuffle (Peter, 09-03: "volume change always shows
 * muted" — Roon was reporting the room muted, and with the pill gone there was
 * no way to unmute from the puck). The speaker shows the state; a tap flips it.
 */
/**
 * ⚖️ THE BUTTON IS A MUTE, NOT A VOLUME (Peter, 09-05: "make the mute symbol a
 * mute rather than volume, and colour the background to indicate status"). It
 * wears the crossed speaker in both states — the symbol names the ACT — and
 * the disc fills with the accent while the room is muted, which is the state.
 */
var btnMute = button('mute', 'btn-mute');
btnMute.setAttribute('title', 'mute');
/**
 * ⚖️ THE SAME IDIOM ON THE MUSIC FACE (Peter, 09-04: "swipe up and down, with
 * up and down arrows to tap to rotate through, or tap on the metadata area").
 * ↑ above the play button and ↓ below the shoulder row are the axis, exactly
 * where the disc wears them in browse: a tap on ↓ is the library, ↑ the queue,
 * and a swipe does the same without looking. The credit at the foot stays the
 * door to browse. The return arrow that sat above play now rides the room name.
 */
var btnUp = button('up', 'btn-up');
var btnDown = button('down', 'btn-down');

pad.appendChild(btnUp);
pad.appendChild(btnDown);
pad.appendChild(btnRepeat);
pad.appendChild(btnMute);
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
glass.appendChild(progRead);
glass.appendChild(progLength);
glass.appendChild(volRead);
glass.appendChild(note);
glass.appendChild(toast);
rig.appendChild(glass);
root.appendChild(rig);
root.appendChild(outside);

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
  // An OUTSIDE exists only where the viewport is wider than the puck: a
  // browser or a television. On the device the puck is the whole screen.
  var outsidePx = (window.innerWidth - (glassPx + 2 * bezelPx)) / 2;
  root.setAttribute('data-outside', outsidePx >= 72 ? '1' : '0');
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
  /**
   * ⚖️ ROON'S OWN LIMIT IS THE CEILING (Peter, 09-05: "Roon already provides a
   * comprehensive max volume per zone — don't create a duplicate feature; say
   * users should set it when the zone is first enabled"). Roon reports it as
   * `soft_limit`; the deck carries it as softLimit. Nothing here duplicates it:
   * the wheel cannot ask for more than it, and the scale shows where it lies.
   */
  var soft = typeof volume.softLimit === 'number' ? volume.softLimit : max;
  var ceiling = soft < max && soft > min ? soft : max;
  return { min: min, max: max, ceiling: ceiling, step: volume.step === null || volume.step === 0 ? 1 : volume.step };
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
  // Up to Roon's limit and no further: a turn that would cross it is cut to
  // reach it, and a turn already there sends nothing and says why.
  var bounds = volumeBounds(output);
  var at = output.volume.value;
  if (steps > 0 && typeof at === 'number' && at + steps * bounds.step > bounds.ceiling) {
    var room = Math.floor((bounds.ceiling - at) / bounds.step);
    if (room <= 0) { flash("at the limit set in Roon"); return null; }
    steps = room;
  }
  return command({ action: 'volume', output: output.id, steps: steps });
});

function turn(step) {
  var output = currentOutput();
  if (output === null) return;
  if (output.volume === null) { flash(output.name + ' has no volume control'); return; }
  wake();   // the bezel has a place; a hand on it means it
  var verdict = volumeGate.step(step);
  showTurning();
  // The runaway guard: twenty steps of continuous turning, then it waits for
  // the hand to pause. Say so in words a person can act on.
  if (verdict === 'rest') { flash('wheel paused \u2014 lift, then turn again'); return; }
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

/** The text colour that reads on a tone — ink on a light one, bone on a deep one. */
function onTone(colour) {
  var rgb = null;
  var hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  var dec = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(colour);
  if (hex) rgb = [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  else if (dec) rgb = [Number(dec[1]), Number(dec[2]), Number(dec[3])];
  if (rgb === null) return '#f2eee6';
  return luminance(rgb) >= 0.4 ? '#0c0d10' : '#f2eee6';
}

function paintFromSleeve(tones) {
  var style = document.documentElement.style;
  style.setProperty('--accent', tones === null ? DEFAULT_PAINT.accent : tones.ring);
  // What reads on the accent: ink on a light tone, bone on a deep one.
  style.setProperty('--on-accent', onTone(tones === null ? DEFAULT_PAINT.accent : tones.ring));
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

/** Where the tag rides: just outside the arc, still inside the glass at three and nine. */
var READ_R = 42;

function setProgress(fraction, positionSec, lengthSec) {
  setArc(progHalo, PROG_C, fraction);
  setArc(progArc, PROG_C, fraction);
  if (fraction === null) { progBead.style.display = 'none'; progRead.style.display = 'none'; progLength.style.display = 'none'; return; }
  var clamped = Math.max(0, Math.min(1, fraction));
  var angle = (clamped * 2 * Math.PI) - (Math.PI / 2);
  progBead.setAttribute('cx', String(50 + PROG_R * Math.cos(angle)));
  progBead.setAttribute('cy', String(50 + PROG_R * Math.sin(angle)));
  progBead.style.display = '';
  progRead.textContent = formatTime(positionSec);
  progLength.textContent = formatTime(lengthSec);
  progLength.style.display = 'block';
  // The circle steps aside near twelve, where the mute, the length and the
  // room name live (Peter, 09-05): within the first or last few percent it
  // trails the bead by 40°, clear of all three (measured at 0:19 on the Study:
  // 28° still sat on the room's last letter).
  var tagAngle = angle;
  if (clamped < 0.03) tagAngle += 40 * Math.PI / 180;
  else if (clamped > 0.97) tagAngle -= 40 * Math.PI / 180;
  progRead.style.left = String(50 + READ_R * Math.cos(tagAngle)) + '%';
  progRead.style.top = String(50 + READ_R * Math.sin(tagAngle)) + '%';
  progRead.style.display = 'block';   // the stylesheet hides it; '' would only defer to that
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
    volReadValue.textContent = '\u00b7\u00b7\u00b7';
    volReadLabel.textContent = (volume.muted ? 'muted \u00b7 ' : '') + output.name;
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
  var shown = Math.max(bounds.min, Math.min(bounds.ceiling,
    volume.value + volumeGate.ahead() * bounds.step));
  var span = Math.max(1, bounds.max - bounds.min);
  lightDetents((shown - bounds.min) / span, String(Math.round(shown)), (bounds.ceiling - bounds.min) / span);
  // The number always; "muted" is said beneath it, not instead of it — and so
  // is Roon's limit, when the level has reached it.
  var atLimit = bounds.ceiling < bounds.max && shown >= bounds.ceiling;
  volReadValue.textContent = String(Math.round(shown));
  volReadLabel.textContent = (volume.muted ? 'muted \u00b7 ' : (atLimit ? "at Roon's limit \u00b7 " : 'volume \u00b7 ')) + output.name;
  // The glyph never changes; the disc's fill is the state.
  if (volume.muted) { btnMute.setAttribute('data-on', '1'); btnMute.setAttribute('title', 'muted \u2014 tap to unmute'); }
  else { btnMute.removeAttribute('data-on'); btnMute.setAttribute('title', 'mute'); }
}

/** The dots up to the level are lit, from twelve o'clock clockwise. */
var TICK_READ_R = 44.6;   // rig units: inside the ticks (46.4), on the bezel's inner band

function lightDetents(fraction, label, ceiling) {
  var lit = fraction === null ? 0 : Math.round(Math.max(0, Math.min(1, fraction)) * ticks.length);
  // The ticks past Roon's limit are drawn dead: the wheel cannot go there.
  var alive = typeof ceiling === 'number' ? Math.round(Math.max(0, Math.min(1, ceiling)) * ticks.length) : ticks.length;
  for (var i = 0; i < ticks.length; i += 1) {
    var major = i % 10 === 0;
    ticks[i].setAttribute('class', (major ? 'tick major' : 'tick') + (i < lit ? ' is-lit' : '') + (i >= alive ? ' beyond' : ''));
  }
  if (fraction === null || label === undefined || label === null) { tickRead.style.display = 'none'; return; }
  var angle = ((lit / ticks.length) * 360 - 90) * Math.PI / 180;
  tickRead.setAttribute('x', String(50 + TICK_READ_R * Math.cos(angle)));
  tickRead.setAttribute('y', String(50 + TICK_READ_R * Math.sin(angle)));
  tickRead.textContent = label;
  tickRead.style.display = '';
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

var nowKey = '';   // what the room was last seen playing, so a change can be noticed

function render() {
  var zone = currentZone();
  paintVolume();
  paintControls(zone);
  // The queue face reads Roon's window ONCE; when the room moves on to the next
  // row the window has moved too, and the face is read again in place.
  var playing = zone === null || zone.nowPlaying === null ? '' : zone.id + '|' + zone.nowPlaying.title + '|' + zone.nowPlaying.line2;
  if (playing !== nowKey) {
    nowKey = playing;
    if (browse !== undefined) browse.reloadQueue();
  }
  // The rooms face follows the house: any room starting, stopping or regrouping redraws it in place.
  if (browse !== undefined) browse.refreshRooms();
  if (zone === null) {
    roomName.textContent = '';
    title.textContent = '';
    artist.textContent = '';
    album.textContent = '';
    paintCover(null);
    setProgress(null);
    return;
  }

  roomName.textContent = zone.name;

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
  setProgress(position / length, position, length);
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
  onAxis: function (dir) { axis(dir); },
  onSwitch: function (room) { switchRoom(room); },
  // The rooms face reads the house from the store and acts through the deck.
  zones: function () { var s = store.snapshot(); return s === null ? [] : s.zones; },
  outputId: function () { var output = currentOutput(); return output === null ? null : output.id; },
  fence: function () { var s = store.snapshot(); return s === null ? null : { generation: s.generation, revision: s.revision }; },
  act: function (body) { return command(body).then(function (result) { return result === null; }); },
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
  // In the queue only the HUB plays (Peter, 09-04): a stray tap on the glass
  // must not start a track, where in the library it would merely open a level.
  if (browse.isOpen()) { if (!band && browse.at() !== 'queue') browse.commit(); return; }
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
  axis(dy > 0 ? 1 : -1);
  return true;
}

/**
 * ⚖️ ONE AXIS, THREE FACES — A WHEEL, NOT A LADDER (Peter, 09-04: "an up and a
 * down arrow on that centre circle … navigate between control, browse and
 * queue"). ↓ from the music is the library; ↓ again the queue; ↓ again the
 * music, and ↑ runs the other way — so every face is one swipe from every
 * other and both arrows on the disc always lead somewhere. Climbing a LEVEL
 * inside the library is the title's job ("‹ GENRES"), not the axis's: it used
 * to be ↑, and that is what changed. The library keeps its place while the
 * axis is elsewhere; the music face has nothing to keep.
 */
function axis(dir) {
  var next = nextStop(browse.at(), dir);
  // Landing on the music, the cluster comes up WITH it — a hand that just
  // swiped is about to tap ↑ or ↓ again, and a first tap that only summoned
  // would break the rhythm. (Woken after the library is parked: a sleeping
  // face refuses to wake while a menu is up.)
  if (next === 'play') { browse.park(); wake(); }
  else { wake(); browse.open(next); }
}

glass.addEventListener('pointerdown', function (event) {
  if (event.button !== undefined && event.button !== 0) return;
  // The glass's outer edge IS the wheel — in browse too, where a turn carries
  // the highlight round the ring (Peter, 09-03: "the outer wheel now control
  // selection on browse"). Hand it to the bezel, not the face.
  if (radiusOf(glassMetrics(), event.clientX, event.clientY) >= WHEEL_BAND) {
    beginTurn(event);
    return;
  }
  touch = { x: event.clientX, y: event.clientY, at: Date.now() };
});

function lift(event) {
  if (touch === null) return;
  var start = touch;
  touch = null;
  var dx = event.clientX - start.x;
  var dy = event.clientY - start.y;
  var metrics = glassMetrics();
  if (swiped(dx, dy, metrics.size)) return;
  if (Math.abs(dx) > metrics.size * TAP_SLOP || Math.abs(dy) > metrics.size * TAP_SLOP) return;
  tapped(event.clientX, event.clientY);
}

/**
 * ⚠️ A SWIPE IS JUDGED WHERE IT STARTED, NOT WHERE THE FINGER LIFTS. Every
 * pressable thing on the face stops its pointerup so a tap on it is its own —
 * which meant a MOUSE swipe that ended over the disc, a circle or the credit
 * was swallowed with it (measured: two probe swipes lost, and the keys that
 * followed fell through to the music face). A finger never had the problem:
 * touch lifts go back to where the touch began. Capturing the pointer was
 * tried and Chrome took the capture without retargeting the mouse — so the
 * lift is heard HERE, at the document in the capture phase, which runs before
 * any control's own listener can stop it. A gesture that began on a control
 * never set `touch`, so nothing acts twice.
 */
document.addEventListener('pointerup', lift, true);

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
press(btnMute, function () {
  var output = currentOutput();
  if (output === null || output.volume === null) return;
  haptic(12);
  command({ action: 'mute', output: output.id, muted: !output.volume.muted });
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
 * ⚖️ THE ROOM NAME GOES HOME TO THE WALL (Peter, 09-03: "we need to be able to
 * return to wall etc."). The Wall is where every room and every way of opening
 * one lives — Face, Phone, Puck — so it is the one place a way back should
 * land. On the way it forgets "puck" as this screen's face and restores the one
 * kept beside that memory, so a Face opened from the Wall afterwards does not
 * turn straight round.
 */
function forgetPuckAsFace() {
  try {
    var before = localStorage.getItem('flightdeck.face.before.' + wantedZoneId) || 'presence';
    if (localStorage.getItem('flightdeck.face.' + wantedZoneId) === 'puck') {
      localStorage.setItem('flightdeck.face.' + wantedZoneId, before);
    }
  } catch (error) { /* private mode */ }
}

function goHome() {
  forgetPuckAsFace();
  haptic(10);
  window.location.href = '/';
}

/**
 * ⚖️ THE ZONE PICKER IS THE ROOMS RING (Peter, 09-05: "we need a zone picker,
 * which can be part of the transfer interface"). The hub of the rooms ring
 * chooses which room this puck controls: a tap on it goes to that room's own
 * puck, by its durable output, keeping the size it was opened at.
 */
function switchRoom(room) {
  haptic(10);
  flash('now ' + room.title);
  window.location.href = '/puck/' + encodeURIComponent(room.outputId) + (PINNED === null ? '' : '?px=' + String(PINNED));
}
/**
 * ⚖️ THE ROOM NAME OPENS THE ROOMS (Peter, 09-05: pull from · shift to on the
 * puck). The name IS the room; a tap on it shows the other rooms, the way the
 * credit is the door to the library. The way back to the house is the button
 * beside it.
 */
room.addEventListener('click', function (event) { event.stopPropagation(); haptic(10); browse.open('rooms'); });
homeMark.addEventListener('click', function (event) { event.stopPropagation(); goHome(); });
/**
 * The "faces" door goes to this room's Face, where every face — this puck among
 * them — is chosen. It forgets "puck" first, as goHome does, or the Face would
 * turn straight round and come back here.
 */
faceDoor.addEventListener('click', function (event) {
  event.stopPropagation();
  forgetPuckAsFace();
  var token = wantedSlug !== '' ? wantedSlug : (boundOutputId !== null ? boundOutputId : '');
  window.location.href = token === '' ? '/face' : '/face/' + encodeURIComponent(token);
});
press(btnUp, function () { axis(-1); });
press(btnDown, function () { axis(1); });
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
  // A tap past Roon's limit asks for the limit, never for more.
  if (value > bounds.ceiling) value = bounds.ceiling;
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
    /**
     * ⚖️ IN A MENU THE COG MOVES THE HIGHLIGHT (Peter, 09-05: "use the outer cog
     * to move rapidly through the 8 or so that are displayed" — superseding
     * 09-04's "the cog is the volume in every state"). On the music face the
     * cog is still the volume; a TAP on the scale still sets the level anywhere,
     * a tap being no turn. On the device each detent will tick, and a fast spin
     * will skip — firmware, later.
     */
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
    // The scroll wheel is the desk's cog: in a menu it moves the highlight
    // (Peter, 09-05); on the music face it is the volume. There it is the one
    // input with NO place — a scroll can land on an idle page from a hand that
    // meant another window — so a sleeping face is only woken by it, and the
    // next detent acts; the bezel and its scale never wait.
    if (browse.isOpen()) { browse.move(dir); return; }
    if (wake()) { showTurning(); return; }
    turn(-dir);
  });
}, { passive: true });

/* ---------- the keyboard: the same three verbs, for a desk ---------- */

window.addEventListener('keydown', function (event) {
  var key = event.key;
  var open = browse.isOpen();
  if (key === 'ArrowDown') {
    axis(1);
  } else if (key === 'ArrowUp') {
    axis(-1);
  } else if (key === 'Backspace') {
    if (open) browse.back();   // the title's climb, for a desk
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
