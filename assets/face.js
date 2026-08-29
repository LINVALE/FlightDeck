import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';

/**
 * The Zone Face. Presence is the default (it won every lens in the 25 Aug
 * tournament); every face is user-selectable, per Peter's ruling — an explicit
 * ?face= always wins, otherwise the screen remembers its own choice.
 *
 * ES2018 only; the floor is Chromium 63.
 */

/**
 * Faces that are actually IMPLEMENTED. The list was briefly all five from the
 * design tournament, but only Presence had any code behind it, so choosing the
 * others changed an attribute and nothing else — four dead controls on a TV
 * (Peter, 08-25: "classic presence selections do - I see nothing").
 *
 * A name only belongs here once its layout exists.
 */
var FACES = ['presence', 'classic', 'dial', 'orbit', 'libretto', 'folio', 'plate', 'rondo', 'canvas', 'gallery', 'aurora'];

/**
 * ⚖️ A FACE IS A LAYOUT AND A BACKGROUND, and they are not the same choice
 * (Peter, 08-28: "create an additional one that takes a similar background to
 * canvas but uses classic layout, and one that uses the background of canvas and
 * looks like orbit").
 *
 * Every rule used to be keyed on the face's NAME, so a face that borrowed
 * another's layout would have meant copying twenty-six selectors and keeping
 * them in step forever — the stacked-rules fault, bought in advance. The screen
 * now carries `data-layout` and `data-field` separately, and a face is a pairing
 * of the two. Two more cost four lines here and nothing in the stylesheet.
 *
 * A face not named here lays itself out and has no ambient field.
 */
var LAYOUT = { gallery: 'classic', aurora: 'orbit', folio: 'libretto', plate: 'libretto', rondo: 'libretto' };
var FIELD = { canvas: 1, gallery: 1, aurora: 1, folio: 1 };

/**
 * ⚖️ AND THE GROUND IS A THIRD CHOICE (Peter, 08-28: "libretto can be expanded
 * to three types ... with a background that's not the artist").
 *
 * The backdrop has always been the ARTIST, falling back to the sleeve only when
 * a track has no artist photograph. Libretto's layout — detail left, image
 * right — reads three quite different ways depending on what is behind it, so
 * the three are made rather than argued about:
 *
 *   libretto   the artist, as it has always been
 *   folio      the drifting field, which is of nobody at all
 *   plate      the SLEEVE itself, blurred: still the music, never a face
 *
 * A face not named here uses the artist.
 */
var GROUND = { plate: 'cover' };

/**
 * Faces that DRAW the ring without being built around one. Dial and Orbit
 * compose the whole page from it; Rondo keeps Libretto's page and simply puts
 * the circle round its picture (Peter, 08-28: "one should use the circle as in
 * orbit"), which is why the ring's two jobs are two attributes.
 */
var RING = { rondo: 1 };

function layoutOf(name) { return LAYOUT[name] === undefined ? name : LAYOUT[name]; }
function hasField(name) { return FIELD[name] === 1; }
function groundOf(name) { return GROUND[name] === undefined ? 'artist' : GROUND[name]; }
var STORE_KEY_FACE = 'flightdeck.face.';
var LAMP_MIN = 24, LAMP_MAX = 96;

var root = document.getElementById('face');
var picker = document.getElementById('picker');
/** Where the strip lives on the faces that still use it as a strip. */
var pickerHome = picker.parentNode;
var zoneId = root.getAttribute('data-zone') || '';

/**
 * FOLLOW MODE. A screen on a wall should show the music that is actually
 * playing, not the room someone last opened it on. In follow mode the Face
 * tracks whichever zone is playing — preferring the one that started most
 * recently — and holds the last one when the house goes quiet, so it never
 * blanks between tracks or rooms.
 *
 * Choosing a room by hand is an explicit act and turns following off.
 */
var STORE_KEY_FOLLOW = 'flightdeck.follow.';
var STORE_KEY_ZONE = 'flightdeck.zone.';
function readFlag(key, fallback) {
  try { var raw = localStorage.getItem(key); return raw === null ? fallback : raw === '1'; }
  catch (error) { return fallback; }
}
function writeFlag(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch (error) { /* private mode */ }
}
// /now serves the page with data-follow="1" and no zone: the bookmarkable TV URL.
var followAttr = root.getAttribute('data-follow');
var followParam = /[?&]follow=([01])/.exec(window.location.search);
var following = followAttr !== null ? followAttr === '1'
  : (followParam !== null ? followParam[1] === '1' : readFlag(STORE_KEY_FOLLOW + zoneId, false));
// The zone actually on screen: the pinned one, or whatever following resolves to.
var shownZoneId = zoneId;

/**
 * THE DISPLAY'S OUTPUT. A screen on a wall belongs to a ROOM, and the room is an
 * output — the speaker standing next to the TV. The zone is re-derived from it on
 * every snapshot, so when the room is grouped the screen follows the group it has
 * joined (which is what that speaker is actually playing) instead of stranding on
 * a zone that no longer exists.
 *
 * Cleared when someone browses rooms by hand; the URL restores it on reload.
 */
var boundOutputId = root.getAttribute('data-output') || null;

/**
 * THE SCREEN INTRODUCES ITSELF.
 *
 * An id it makes up once and keeps. That is enough — nothing here is a secret,
 * it is all one LAN, and the alternative is asking somebody to identify their
 * televisions. Without it, Settings could not tell one screen from another, and
 * "this display shows the kitchen" would have nowhere to live.
 *
 * The heartbeat is also how a binding made in Roon reaches a screen nobody is
 * standing in front of: the reply carries what this display is locked to.
 */
var displayId = null;
try {
  displayId = localStorage.getItem('flightdeck.display');
  if (displayId === null || displayId === '') {
    displayId = 'd' + String(Date.now()).slice(-8) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('flightdeck.display', displayId);
  }
} catch (error) { displayId = null; }   // private mode: this screen cannot be bound

var lockedOutputId = null;

function displayName() {
  var slug = root.getAttribute('data-zone-slug');
  var where = root.getAttribute('data-zone') !== '' && slug ? slug : (following ? 'follows the music' : 'wall');
  return where + ' · ' + String(current);
}

function sayHello() {
  if (displayId === null) return;
  fetch('/api/v1/display', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: displayId, name: displayName() }),
  }).then(function (response) {
    return response.ok ? response.json() : null;
  }).then(function (data) {
    if (data === null) return;
    var wanted = data.output || null;
    if (wanted === lockedOutputId) return;
    lockedOutputId = wanted;
    // A lock is a decision made elsewhere and it wins: the screen stops following
    // the music, releases any hand-picked room, and belongs to its speaker.
    if (lockedOutputId !== null) {
      boundOutputId = lockedOutputId;
      following = false;
    }
    root.setAttribute('data-locked', lockedOutputId === null ? '' : '1');
    // A screen locked to a room does not offer the whole house either; that is
    // what locking it means.
    homeMark.hidden = lockedOutputId !== null;
    var snap = store.snapshot();
    if (snap !== null) render(snap, 'snapshot');
  }).catch(function () { /* the server will be back */ });
}

/**
 * ?keys=1 prints every key the device actually sends, with its keyCode. A remote
 * that does nothing is impossible to diagnose from the other end of the house,
 * and TV engines disagree about what they report.
 */
var debugKeys = /[?&]keys=1/.test(location.search);
var keyLog = null;
var keySeen = [];

function reportKey(event, name) {
  if (keyLog === null) {
    keyLog = el('div', 'keylog');
    keyLog.appendChild(el('div', 'keylog-head', 'KEY PROBE  \u00B7  press the buttons you want to use'));
    document.body.appendChild(keyLog);
  }
  var code = event.keyCode || event.which || 0;
  // Report what the key WOULD DO, not the internal name for it: this is read by
  // a person deciding whether their remote is usable.
  var does = {
    left: 'face \u25C0', right: 'face \u25B6', room: 'next room',
    up: 'volume +', down: 'volume \u2212',
    ok: 'artwork', playpause: 'play / pause',
    next: 'next track', previous: 'previous track',
    volup: 'volume +', voldown: 'volume \u2212', stop: 'pause',
  }[name];
  keySeen.unshift({
    key: event.key || '(none)',
    code: code,
    acted: does || 'not used',
  });
  if (keySeen.length > 10) keySeen.length = 10;

  // Report it to FlightDeck as well as the screen: a TV cannot be read from the
  // other end of the house, but it can send what it saw.
  try {
    fetch('/api/v1/keyprobe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: event.key || '(none)', code: code, acted: does || 'not used' }),
    }).catch(function () { /* the on-screen list still stands */ });
  } catch (error) { /* older engine without fetch: the panel is enough */ }

  drawKeyLog();
}

function drawKeyLog() {
  if (keyLog === null) return;
  var rows = [el('div', 'keylog-head', 'PROBE  \u00B7  press buttons and point at things')];
  for (var i = 0; i < keySeen.length; i += 1) {
    var seen = keySeen[i];
    var row = el('div', i === 0 ? 'keylog-row is-new' : 'keylog-row');
    row.appendChild(el('span', 'k-key', seen.key));
    row.appendChild(el('span', 'k-code', 'code ' + seen.code));
    row.appendChild(el('span', seen.acted === 'not used' ? 'k-act k-none' : 'k-act', seen.acted));
    rows.push(row);
  }
  if (keySeen.length === 0) rows.push(el('div', 'keylog-row', 'nothing received yet'));
  keyLog.replaceChildren.apply(keyLog, rows);
}

function zoneForOutput(snapshot) {
  if (boundOutputId === null) return null;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    var outs = snapshot.zones[i].outputs;
    for (var j = 0; j < outs.length; j += 1) {
      if (outs[j].id === boundOutputId) return snapshot.zones[i];
    }
  }
  return null;
}
try {
  var savedZone = localStorage.getItem(STORE_KEY_ZONE + zoneId);
  if (savedZone !== null && savedZone !== '') shownZoneId = savedZone;
} catch (error) { /* private mode */ }

function pickFollowed(snapshot) {
  var best = null;
  var bestAt = -1;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    var zone = snapshot.zones[i];
    if (zone.state !== 'playing') continue;
    var at = zone.runStartedAt === null ? 0 : Date.parse(zone.runStartedAt);
    if (isNaN(at)) at = 0;
    // Stay put while the zone already on screen is still playing: a screen that
    // hops rooms mid-album is worse than one that lags a moment.
    if (zone.id === shownZoneId) return zone.id;
    if (at > bestAt) { bestAt = at; best = zone.id; }
  }
  return best;   // null when the house is quiet: hold what is on screen
}

/* ---------- which face ---------- */
function remembered() {
  try { return localStorage.getItem(STORE_KEY_FACE + zoneId); } catch (error) { return null; }
}
function remember(name) {
  try { localStorage.setItem(STORE_KEY_FACE + zoneId, name); } catch (error) { /* private mode */ }
}
// An explicit ?face= is the durable, pinnable form and always wins.
var pinned = root.getAttribute('data-face-param');
var current = pinned || remembered() || 'presence';
if (FACES.indexOf(current) === -1) current = 'presence';

/* ---------- structure ---------- */
function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * ARTIST VIEW. Peter, 2026-08-25: the blurred backdrop reads as atmosphere but
 * you cannot tell who it is. So the cover is a switch — press OK (or tap it) and
 * the artist comes forward sharp and full bleed while the cover shrinks into the
 * corner; press again for the next artist image; press past the last one to come
 * back to the cover.
 *
 * Cycling rather than a single toggle is deliberate: Roon ships up to four keys
 * per track and which one is the performer rather than the composer has never
 * been verified. Letting a viewer step through them answers "who is this?" and
 * settles that question on screen.
 */
/**
 * TWO views, and OK toggles them (Peter, 08-25: "we just toggle album / artist"):
 *
 *   0  album   the sleeve is the hero, the artist blurred behind it  (default)
 *   1  artist  the artist sharp and full bleed, ROTATING every 10 s
 *
 * There were briefly three, and two of them were both "the cover is the hero" —
 * one merely larger, wearing an ALBUM label. That is a difference a viewer does
 * not care about, so the labelled one is gone and the default IS the album view.
 *
 * Clicking the cover returns to the album view, for screens with a pointer.
 *
 * Step 1 is a user-triggered blur of the album art. That does NOT breach the
 * cover-sacred rule: the sacred cover is the sharp one in the layout, and a
 * blurred copy painted behind it is a derived backdrop — the same reasoning that
 * lets the Wall resize the cover but never tint it.
 *
 * Step 2 exists because artists could come forward and the album never could
 * (Peter, 08-25: "we need to switch album art back and forward somehow"). It is
 * `contain`, NOT `cover`: filling a 16:9 screen with a square sleeve would mean
 * CROPPING it, and the cover is sacred. So it goes as large as it can go whole —
 * full height, uncropped — floating on a blurred copy of itself.
 */
var VIEW_ALBUM = 0;          // the sleeve is the hero; this is the default
var VIEW_ARTIST = 1;
var ROTATE_MS = 10000;       // how long each artist portrait holds
var viewStep = VIEW_ALBUM;
var artistIndex = -1;        // -1 = no portrait on screen
var rotateTimer = null;
var lastTitle = null;
var artistLayer = null;

var bg = el('div', 'bg');
var canvas = document.createElement('canvas');
canvas.width = 96; canvas.height = 54;
bg.appendChild(canvas);
/** AMBIENT CANVAS: slow weather in the sleeve's own colours. Tiny and upscaled,
 *  so a 2019 TV SoC draws ~30k pixels rather than two million. */
var field = document.createElement('canvas');
field.className = 'field';
field.width = 240; field.height = 135;
bg.appendChild(field);
bg.appendChild(el('div', 'wash'));

artistLayer = el('div', 'artistlayer');
bg.appendChild(artistLayer);

var safe = el('div', 'safe');
var head = el('div', 'head');

/**
 * THE WAY BACK TO THE HOUSE.
 *
 * Getting to the whole-house wall meant pressing the room, then finding "the
 * wall" in the list — two presses and a hunt (Peter, 08-28: "we just need a way
 * on now playing to return to the household screen"). It is a mark in the chrome
 * now, first thing on the line, so it is where a viewer already looks when they
 * want to go somewhere.
 *
 * Four squares rather than a house: it is the wall of rooms you are going to,
 * and it matches what you land on.
 */
var homeMark = el('span', 'homemark');
(function () {
  // ⚠️ the literal, not SVG_NS: that constant is declared a hundred lines below
  // this, so at THIS point it is hoisted-but-undefined and the element would be
  // built in the null namespace — which renders 0x0 and looks like a CSS fault.
  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  /**
   * A RETURN ARROW, not four squares. The grid said "where you are going"; an
   * arrow says "back", which is what a viewer is actually looking for and reads
   * without being learned (Peter, 08-28).
   */
  var arrow = document.createElementNS(ns, 'path');
  arrow.setAttribute('d', 'M10.5 5.5 4 12l6.5 6.5');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '2');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(arrow);
  var tail = document.createElementNS(ns, 'path');
  tail.setAttribute('d', 'M4 12h16');
  tail.setAttribute('fill', 'none');
  tail.setAttribute('stroke', 'currentColor');
  tail.setAttribute('stroke-width', '2');
  tail.setAttribute('stroke-linecap', 'round');
  svg.appendChild(tail);
  homeMark.appendChild(svg);
})();
homeMark.setAttribute('title', 'back to every room');
homeMark.setAttribute('aria-label', 'go to the whole house');
pressable(homeMark, function () { location.href = '/'; });

var zoneName = el('span', 'zone');
/**
 * THE WAY INTO GROUPING, and it is already on the screen.
 *
 * Roon names a group "Study RHEOS + 5". That "+ 5" is the only thing on the face
 * that says the room is a group, so it is also the thing you press to change one
 * — no new mark to learn, and it appears exactly when it means something. A room
 * that is NOT grouped but could be gets a dim chain in its place, which invites
 * rather than reports (Peter, 08-28: "any other elegant way to indicate
 * accessing the group picker?").
 */
var groupDoor = el('span', 'groupdoor');
pressable(groupDoor, startGroupPick);
var chipHost = el('span');
var status = el('div', 'status');
/**
 * ⚖️ THE ROOM'S NAME BELONGS OVER THE ARTWORK (Peter, 08-28: "put the room name
 * centered on the circle / artwork and the +x box justified to the edge of the
 * artwork or the circle").
 *
 * Grouped in one mark so it can be given the ARTWORK'S column: the way back at
 * its left edge, the name centred over the picture, the group door on its right
 * edge. That is what it names — this room, this sleeve — and it also keeps the
 * head out of the words' column entirely, which it had been sitting on top of.
 */
var headMark = el('div', 'headmark');
headMark.appendChild(homeMark);
headMark.appendChild(zoneName); headMark.appendChild(groupDoor); headMark.appendChild(chipHost);
head.appendChild(headMark); head.appendChild(status);

var body = el('div', 'body');
var cover = el('div', 'cover');
var coverImg = document.createElement('img');
coverImg.alt = '';
cover.appendChild(coverImg);
var copy = el('div', 'copy');
var title = el('h1', 'title');
var line2 = el('div', 'line2');
var line3 = el('div', 'line3');
copy.appendChild(title); copy.appendChild(line2); copy.appendChild(line3);
/**
 * CLASSIC'S SHELF — controls that live IN the layout rather than over it.
 *
 * Both hosts are in the DOM from the start and hold their space always, so
 * revealing the chrome changes opacity and nothing else: the sleeve and the
 * words do not move under the pointer (Peter, 08-28). The transport sits
 * directly under the metadata; the volume directly above the progress.
 */
var shelfTransport = el('div', 'shelf shelf-transport');
var shelfVolume = el('div', 'shelf shelf-volume');
/**
 * ⚖️ THE BROWSE CHROME STANDS ABOVE THE WORDS (Peter, 08-28: "that could fit
 * beautifully above the metadata mirroring the controls that appear below").
 *
 * Below the words: how to play it. Above them: what to play. The music sits
 * between the two questions, which is the right place for it — and like the two
 * rows below, this one is OUT OF FLOW, so nothing moves when it arrives.
 */
var shelfBrowse = el('div', 'shelf shelf-browse');
copy.appendChild(shelfTransport);
copy.appendChild(shelfBrowse);
copy.appendChild(shelfVolume);
var artistName = el('span', 'artistname');
head.insertBefore(artistName, status);

/**
 * ZONED INTERACTION (Peter, 08-26).
 *
 * Before this, a press ANYWHERE raised one strip — and it appeared under the
 * finger that summoned it, so the next press landed on whatever button had
 * materialised there. That is why play started at random on a touchscreen.
 *
 * Now the screen has places:
 *   the cover        flips album / artist
 *   the title band   opens BROWSE — change what is playing
 *   the lower band   raises TRANSPORT — play, skip, volume
 *   the cog          raises the FACES picker
 *
 * Nothing appears under the press that summoned it, and a freshly raised panel
 * ignores presses for a moment so the summoning touch cannot fall through onto a
 * control.
 */
/**
 * The two indicators. They are not decoration: each NAMES the thing it changes,
 * so the screen explains itself without a legend (Peter, 08-26 — "the top right
 * changes to indicate what face we have... maybe the cog is not needed").
 *
 * Both are hidden at rest. The resting face is the music and nothing else.
 */
var cog = el('span', 'cog');           // top right: the FACE, and where to change it
cog.setAttribute('aria-label', 'change face');
head.appendChild(cog);

var idle = el('div', 'idle');
var idleClock = el('div', 'clock');
var idleNote = el('div', 'note');
idle.appendChild(idleClock); idle.appendChild(idleNote);
idle.style.display = 'none';
// cover and copy share a wrapper so the artist view can put them side by side
// (Peter, 08-25: "position it to the left of the three line info section at the
// same level") while the default view keeps them stacked.
var np = el('div', 'np');
np.appendChild(cover); np.appendChild(copy);
body.appendChild(np); body.appendChild(idle);

var foot = el('div', 'foot');
var elapsed = el('div', 'time');
var lamps = el('div', 'lamps');
var remaining = el('div', 'time');
var ends = el('div', 'time ends');
var rightBox = el('div');
rightBox.appendChild(remaining); rightBox.appendChild(ends);
var bar = el('div', 'bar');
var barFill = el('i');
bar.appendChild(barFill);

/**
 * THE DIAL's ring. SVG stroke-dashoffset, deliberately not conic-gradient: the
 * floor is Chromium 63 and conic-gradient is 69. This works back to Chromium 53
 * and needs no mask.
 */
var SVG_NS = 'http://www.w3.org/2000/svg';
var RING_R = 44;
var RING_C = 2 * Math.PI * RING_R;
var dial = document.createElementNS(SVG_NS, 'svg');
dial.setAttribute('class', 'dial');
dial.setAttribute('viewBox', '0 0 100 100');
var dialTrack = document.createElementNS(SVG_NS, 'circle');
var dialArc = document.createElementNS(SVG_NS, 'circle');
[dialTrack, dialArc].forEach(function (c) {
  c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(RING_R));
  c.setAttribute('fill', 'none'); c.setAttribute('stroke-linecap', 'round');
});
dialTrack.setAttribute('class', 'dial-track');
dialArc.setAttribute('class', 'dial-arc');
dialArc.setAttribute('transform', 'rotate(-90 50 50)');   // start at twelve o'clock
dialArc.setAttribute('stroke-dasharray', String(RING_C));
dialArc.setAttribute('stroke-dashoffset', String(RING_C));
/**
 * A filled disc behind the ring. The sleeve covers the middle, so what shows is the
 * four corners between the square and the circle — exactly where the shape needs to
 * separate itself from the blurred backdrop (Peter, 08-26). Tinted from the art's
 * own deep tone, so it belongs to the picture rather than sitting on it.
 */
var dialFill = document.createElementNS(SVG_NS, 'circle');
dialFill.setAttribute('cx', '50'); dialFill.setAttribute('cy', '50');
dialFill.setAttribute('r', String(RING_R));
dialFill.setAttribute('class', 'dial-fill');
/**
 * A bead riding the head of the arc, so the position reads as a point on a clock
 * rather than as the end of a line (Peter, 08-26). Its centre is the arc's own
 * angle: twelve o'clock is -90 degrees, and the fraction carries it clockwise.
 */
/** What the ring last drew, so a seek can be told from a second passing. */
var lastRingKey = '';
var lastRingFraction = 0;

var dialBead = document.createElementNS(SVG_NS, 'circle');
dialBead.setAttribute('r', '3.1');
dialBead.setAttribute('class', 'dial-bead');
/**
 * A TRANSPARENT CIRCLE THAT EXISTS ONLY TO BE PRESSED. The ring is a 2.2-unit
 * stroke in a 100 viewBox — about 19px on a TV, which is not a thing anybody can
 * hit. This one is drawn on exactly the same circle at twelve units wide, paints
 * nothing, and takes `pointer-events: stroke` so ONLY its band is live: the
 * corners fall through to the face, and the middle belongs to the sleeve.
 */
var dialHit = document.createElementNS(SVG_NS, 'circle');
dialHit.setAttribute('cx', '50'); dialHit.setAttribute('cy', '50');
dialHit.setAttribute('r', String(RING_R));
dialHit.setAttribute('class', 'dial-hit');
dialHit.setAttribute('fill', 'none');
dialHit.setAttribute('stroke', 'transparent');
dialHit.setAttribute('stroke-width', '24');   // ~13% of the circle: a fingertip on a TV
dial.appendChild(dialFill);
dial.appendChild(dialTrack); dial.appendChild(dialArc); dial.appendChild(dialBead);
dial.appendChild(dialHit);                     // last, so it is over the ring it serves
var dialReading = el('div', 'dial-reading');
var dialRemain = el('div', 'dial-remain');
var dialTimes = el('div', 'dial-times');
var dialEnds = el('div', 'dial-ends');
dialReading.appendChild(dialRemain); dialReading.appendChild(dialTimes); dialReading.appendChild(dialEnds);
var dialBox = el('div', 'dialbox');
dialBox.appendChild(dial); dialBox.appendChild(dialReading);
/**
 * The ring lives INSIDE the cover element and CIRCUMSCRIBES it.
 *
 * Peter, 08-26: the art should fill the circle. It cannot be cropped to one — the
 * cover is sacred — so the circle goes round the OUTSIDE of the square instead.
 * A circle drawn around a square of side s has diameter s√2, which is why the ring
 * is 141% of the cover and offset by 20.5% on each side.
 *
 * Being a child means it follows the cover everywhere: full size on the dial face,
 * shrunk into the corner when the artist comes forward, without a line of layout
 * code for either.
 */
cover.appendChild(dialBox);
foot.appendChild(elapsed); foot.appendChild(lamps); foot.appendChild(bar); foot.appendChild(rightBox);

safe.appendChild(head); safe.appendChild(body); safe.appendChild(foot);
root.appendChild(bg); root.appendChild(safe);

/* ---------- the backdrop: blurred artist, recoloured to the cover's tones ----------
   The cover is never touched. The artist image is drawn tiny, blurred at that
   size, then scaled up by CSS. Falls back to the blurred cover when Roon has no
   artist image (internet radio, or the undocumented field having vanished). */
var ctx = canvas.getContext('2d');
var backdropKey = null;
var palette = ['#3a2b24', '#7a4a32', '#e0b070'];

function drawBackdrop(url, tones) {
  var image = new Image();
  image.onload = function () {
    try {
      ctx.save();
      if (typeof ctx.filter === 'string') ctx.filter = 'blur(2.5px)';
      // cover-fit the source into the tiny canvas
      var scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      var w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      ctx.restore();
      // Tint toward the cover's own tones so backdrop and cover never disagree.
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.globalCompositeOperation = 'multiply';
      var gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, tones[1]);
      gradient.addColorStop(1, tones[0]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      canvas.className = 'is-lit';
    } catch (error) { /* a tainted or broken image simply leaves the wash */ }
  };
  image.src = url;
}

/** The palette pass: a 32x32 downsample, bucketed — the image engine v0. */
function readPalette(url, done) {
  var image = new Image();
  image.onload = function () {
    try {
      var pad = document.createElement('canvas');
      pad.width = 32; pad.height = 32;
      var pctx = pad.getContext('2d');
      pctx.drawImage(image, 0, 0, 32, 32);
      var data = pctx.getImageData(0, 0, 32, 32).data;
      var buckets = {};
      for (var i = 0; i < data.length; i += 4) {
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var lightness = (max + min) / 510;
        if (lightness < 0.12 || lightness > 0.86) continue;
        var key = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
        if (buckets[key] === undefined) buckets[key] = { n: 0, r: 0, g: 0, b: 0, sat: max - min };
        buckets[key].n += 1; buckets[key].r += r; buckets[key].g += g; buckets[key].b += b;
      }
      var ranked = [];
      for (var k in buckets) {
        if (!Object.prototype.hasOwnProperty.call(buckets, k)) continue;
        var entry = buckets[k];
        ranked.push({ weight: entry.n * (1 + entry.sat / 255), rgb: [entry.r / entry.n, entry.g / entry.n, entry.b / entry.n] });
      }
      ranked.sort(function (a, b2) { return b2.weight - a.weight; });
      if (ranked.length === 0) { done(palette); return; }
      var toHex = function (rgb, lift) {
        var out = '#';
        for (var c = 0; c < 3; c += 1) {
          var value = Math.max(0, Math.min(255, Math.round(rgb[c] * lift)));
          out += (value < 16 ? '0' : '') + value.toString(16);
        }
        return out;
      };
      /**
       * The accent carries the zone name, the state word and the progress — text
       * that must read from a sofa. Multiplying the dominant tone by a constant
       * does not achieve that: a dark red sleeve yields a dark red accent, and
       * "PAUSED" disappears into the ground.
       *
       * So lift it until it genuinely clears the ground, measuring rather than
       * hoping — WCAG relative luminance against the deck, raised toward white
       * until the contrast ratio passes 4.5:1. The HUE is preserved throughout,
       * so the accent still belongs to the artwork.
       */
      var luminance = function (rgb) {
        var chan = [];
        for (var c = 0; c < 3; c += 1) {
          var v = Math.max(0, Math.min(1, rgb[c] / 255));
          chan.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        }
        return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
      };
      var GROUND = 0.00518;                       // #0a0b0d, the deck
      var contrast = function (rgb) {
        return (luminance(rgb) + 0.05) / (GROUND + 0.05);
      };
      var liftToContrast = function (rgb, target) {
        var out = [rgb[0], rgb[1], rgb[2]];
        // Up to 24 steps of 8% toward white; stops the moment it is legible.
        for (var step = 0; step < 24 && contrast(out) < target; step += 1) {
          for (var c = 0; c < 3; c += 1) out[c] = out[c] + (255 - out[c]) * 0.08;
        }
        return out;
      };
      /**
       * A SECOND accent, for large coloured shapes rather than text.
       *
       * `--accent` is lifted until it clears 4.5:1, which is right for a zone name
       * and wrong for a progress ring: by the time small text is legible the colour
       * has been washed most of the way to white. A ring is hundreds of pixels of
       * line and needs far less lift to be seen, so it keeps its colour (Peter,
       * 08-26: "more coloured, to blend but stand out").
       */
      var rich = toHex(liftToContrast(ranked[0].rgb, 2.6), 1);
      var deep = toHex(ranked[0].rgb, 0.42);
      var mid = toHex(ranked[Math.min(1, ranked.length - 1)].rgb, 0.8);
      var lit = toHex(liftToContrast(ranked[0].rgb, 4.5), 1);
      done([deep, mid, lit, rich]);
    } catch (error) { done(palette); }
  };
  image.src = url;
}

/* ---------- lamps ---------- */
var lampNodes = [];
function ensureLamps(count) {
  while (lampNodes.length < count) {
    var lamp = document.createElement('b');
    lamps.appendChild(lamp);
    lampNodes.push(lamp);
  }
  for (var i = 0; i < lampNodes.length; i += 1) {
    lampNodes[i].style.display = i < count ? 'block' : 'none';
  }
}

/* ---------- render ---------- */
var artKey = null;
function setCover(art) {
  var key = art ? art.key : null;
  if (key === artKey) return;
  artKey = key;
  if (art === null) { coverImg.removeAttribute('src'); return; }
  var next = new Image();
  var swap = function () {
    coverImg.src = next.src;
    // The palette comes from the COVER, always — it is what the backdrop agrees with.
    readPalette(next.src, function (tones) {
      palette = tones;
      var root2 = document.documentElement.style;
      root2.setProperty('--accent', tones[2]);
      root2.setProperty('--accent-rich', tones[3] || tones[2]);
      root2.setProperty('--disc', tones[0]);
    });
  };
  next.onload = swap;
  if ('decode' in HTMLImageElement.prototype) {
    next.decode().then(swap).catch(function () { /* onload covers it */ });
  }
  next.src = art.path;
}

function setBackdrop(zone) {
  var np = zone.nowPlaying;
  var source = null;
  var ground = groundOf(current);
  if (np) {
    // The ARTIST by default, blurred behind the sleeve in the album view and
    // sharp and full bleed in the artist view; the cover is the fallback when a
    // track has no artist image at all (internet radio). A face may ask for the
    // COVER instead, which is a background of the music and not of a person.
    if (ground === 'cover') source = np.art;
    else source = np.artistArt ? np.artistArt : np.art;
  }
  // The ground is part of the key, or switching to a face that wants the sleeve
  // would keep whatever was already painted.
  var key = (source ? source.key : null) + '@' + viewStep + '@' + ground;
  if (key === backdropKey) return;
  backdropKey = key;
  if (source === null || source === undefined) { canvas.className = ''; return; }
  var url = source.path;
  readPalette(np.art ? np.art.path : url, function (tones) {
    palette = tones;
    drawBackdrop(url, tones);
  });
}

function render(snapshot, kind) {
  if (snapshot === null) return;
  var was = shownZoneId;
  if (following) {
    var followed = pickFollowed(snapshot);
    if (followed !== null && followed !== shownZoneId) { shownZoneId = followed; }
  }
  // The room, however Roon has zoned it this second — bound output first, then
  // the remembered id, then the room's own name.
  var zone = resolveZone(snapshot);
  if (zone !== null && zone.id !== was) kind = 'snapshot';
  if (zone === null) {
    /**
     * Hold, don't accuse. Through a regrouping the room really is in no zone for
     * a beat; saying so would put "Zone unavailable" on a wall-mounted screen
     * every single time somebody groups a room, which is not what happened.
     */
    if (Date.now() < settlingUntil) return;
    root.setAttribute('data-state', 'stopped');
    zoneName.textContent = 'Zone unavailable';
    return;
  }
  settlingUntil = 0;

  var away = snapshot.core.state !== 'paired';
  var state = away ? 'away' : zone.state;
  root.setAttribute('data-state', state);

  if (kind !== 'seek') {
    /**
     * Roon writes "Study RHEOS + 5". The name stays the name; the count becomes
     * the door. When there is no count, the door is a chain — shown only where
     * Roon would actually allow a group, so it never offers the impossible.
     */
    var plus = /^(.*?)\s\+\s(\d+)$/.exec(zone.name);
    zoneName.textContent = plus === null ? zone.name : plus[1];
    var island = zone.outputs.length > 0 ? zone.outputs[0].island : '';
    var canGroup = island !== '' && zone.outputs[0].groupableWith.length > 1;
    if (plus !== null) {
      groupDoor.textContent = '+ ' + plus[2];
      groupDoor.className = 'groupdoor grouped';
      groupDoor.setAttribute('title', plus[2] + ' more rooms \u00B7 press to change the group');
      groupDoor.hidden = false;
    } else if (canGroup) {
      groupDoor.replaceChildren(glyph('group'));
      groupDoor.className = 'groupdoor';
      groupDoor.setAttribute('title', 'group ' + zone.name + ' with another room');
      groupDoor.hidden = false;
    } else {
      groupDoor.hidden = true;
    }
    renderShelf(zone);
    /**
     * NO MEMBER NAMES. Roon already names a group "Study RHEOS + 2", which says
     * what the badge needs to say (Peter, 08-28) — the chips repeated it and ran
     * the head off the side of the screen on a group of three. The rooms are
     * named where they can be acted on: the volume disclosure lists them all,
     * each with its own level.
     */
    if (chipHost.childNodes.length > 0) chipHost.replaceChildren();
    /**
     * Only say something WORTH saying (Peter, 08-26: "we don't need to indicate
     * playing or paused, just the name of the face").
     *
     * Playing and paused are already legible from the transport button's own shape
     * and from whether the progress is moving — printing them was noise beside the
     * face name. A Core that has gone away, or a stream still catching up, is not
     * visible anywhere else, so those still speak.
     */
    status.textContent = streamState === 'catching-up' ? 'catching up…'
      : (away ? 'Roon is away' : (zone.state === 'loading' ? 'loading' : ''));

    var np = zone.nowPlaying;
    if (np === null || zone.state === 'stopped') {
      idle.style.display = '';
      /**
       * ⚠️ THE SLEEVE KEEPS ITS FOOTPRINT when there is nothing playing, on the
       * faces that carry their chrome in the layout. Removing the box let the
       * words' column stretch across the whole frame and slide under the room
       * name — so on a stopped room the browse marks were UNDER the head and
       * could not be pressed at all. Nothing else moves when a track ends
       * either, which is the point of these faces.
       */
      if (np === null && hasShelf()) { cover.style.display = ''; cover.style.visibility = 'hidden'; }
      else { cover.style.display = np === null ? 'none' : ''; cover.style.visibility = ''; }
      idleClock.textContent = new Date().toTimeString().slice(0, 5);
      idleNote.textContent = zone.name;
    } else {
      idle.style.display = 'none';
      cover.style.display = ''; cover.style.visibility = '';
      if (np.title !== lastTitle) {
        lastTitle = np.title;
        // A new track means a new artist; never leave a stale face on screen.
        if (viewStep !== VIEW_ALBUM) {
          viewStep = VIEW_ALBUM; artistIndex = -1; backdropKey = null; applyArtistView();
        }
      }
      title.textContent = np.title;
      line2.textContent = np.line2;
      line3.textContent = np.line3;
      setCover(np.art);
      setBackdrop(zone);
    }
  }

  paintVolume();

  var position = store.positionSec(zone);
  var length = zone.nowPlaying ? zone.nowPlaying.lengthSec : null;
  if (position === null || !length) {
    ensureLamps(0);
    elapsed.textContent = ''; remaining.textContent = ''; ends.textContent = '';
    return;
  }
  // Lamp COUNT encodes track length (~1 lamp per 10 s): density tells you how
  // long the piece is before you read a number.
  var count = Math.max(LAMP_MIN, Math.min(LAMP_MAX, Math.round(length / 10)));
  ensureLamps(count);
  var litTo = Math.floor((position / length) * count);
  for (var l = 0; l < count; l += 1) {
    var node = lampNodes[l];
    var wantClass = l < litTo ? 'lit' : (l === litTo && zone.state === 'playing' ? 'head' : '');
    if (node.className !== wantClass) node.className = wantClass;
  }
  var fraction = Math.max(0, Math.min(1, position / length));

  /**
   * A SMOOTH RING, WITHOUT INVENTING A POSITION.
   *
   * The position shown is Roon's reported second, verbatim — that ruling stands
   * (388052d), and it is why the dials stopped wobbling. Interpolating the NUMBER
   * is what went wrong before. This does not: the number is untouched, and only
   * the arc's MOTION between two reported seconds is eased, by the browser, in
   * CSS. It can never run past the latest reported value, because that value is
   * the transition's target — so a repeated second simply has nowhere to go and
   * the ring holds, instead of snapping back.
   *
   * A seek or a track change must not crawl a whole second to its new place, so
   * a jump larger than a second's worth of travel is applied with the easing
   * switched off for that one update.
   */
  var ringKey = zone.id + '|' + String(length) + '|' + (zone.nowPlaying.title || '');
  var perSecond = 1 / Math.max(1, length);
  var jump = ringKey !== lastRingKey || Math.abs(fraction - lastRingFraction) > perSecond * 3;
  if (jump && root.className.indexOf('ring-jump') === -1) root.className += ' ring-jump';
  barFill.style.width = (fraction * 100).toFixed(2) + '%';
  dialArc.setAttribute('stroke-dashoffset', String(RING_C * (1 - fraction)));
  var angle = (-90 + fraction * 360) * Math.PI / 180;
  dialBead.setAttribute('cx', String(50 + RING_R * Math.cos(angle)));
  dialBead.setAttribute('cy', String(50 + RING_R * Math.sin(angle)));
  if (jump) {
    dialArc.getBoundingClientRect();            // land them before easing is restored
    root.className = root.className.replace(' ring-jump', '');
  }
  lastRingKey = ringKey;
  lastRingFraction = fraction;
  dialRemain.textContent = '\u2212' + formatTime(length - position);
  dialTimes.textContent = formatTime(position) + ' / ' + formatTime(length);
  // "ENDS hh:mm" is dropped on the Dial: the ring already says how much is left,
  // and the pair at twelve o'clock says it in numbers (Peter, 08-26).
  dialEnds.textContent = zone.state === 'playing'
    ? 'ENDS ' + new Date(Date.now() + (length - position) * 1000).toTimeString().slice(0, 5) : '';
  elapsed.textContent = formatTime(position);
  remaining.textContent = '−' + formatTime(length - position);
  // ENDS hh:mm — grafted from the Dial face. Practical from a sofa in a way a
  // countdown is not.
  var finish = new Date(Date.now() + (length - position) * 1000);
  ends.textContent = zone.state === 'playing'
    ? 'ENDS ' + finish.toTimeString().slice(0, 5) : '';
}

/* ---------- artist view ---------- */
function slugOf(name) { return String(name).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function currentZone() {
  return resolveZone(store.snapshot());
}

/**
 * ⚖️ THE SCREEN IS ANCHORED ON ITS ROOM, NOT ON A ZONE ID (Peter, 08-28:
 * "make sure it doesn't come up a zone unavailable when grouping / ungrouping is
 * done — anchored always on the group lead ... as in a 'zone'").
 *
 * A zone id is not durable. Grouping and ungrouping both DESTROY the zone and
 * build a new one, so the id this screen was showing is genuinely gone the
 * instant a group forms — which is exactly the moment somebody is watching.
 * What survives is the OUTPUT: a room's speaker keeps its id through every
 * regrouping, and the zone it lands in is the group it is now part of.
 *
 * So the order is: the bound output first (durable), then the remembered id,
 * then the room's own name — and only a room this Core has never heard of ends
 * up with nothing.
 */
function resolveZone(snapshot) {
  if (snapshot === null) return null;
  var byOutput = zoneForOutput(snapshot);
  if (byOutput !== null) { shownZoneId = byOutput.id; return byOutput; }
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    if (snapshot.zones[i].id === shownZoneId) return snapshot.zones[i];
  }
  // The id is gone — a Core restart can renumber zones. Re-find the room BY NAME
  // rather than showing "unavailable" forever on a TV nobody is standing at.
  var slug = root.getAttribute('data-zone-slug');
  if (slug) {
    var pool = [];
    for (var j = 0; j < snapshot.zones.length; j += 1) {
      var zone = snapshot.zones[j];
      // Match the zone's own name AND its OUTPUT names: when rooms are grouped,
      // Roon renames the zone and only the outputs still carry the room's name.
      var names = [slugOf(zone.name)];
      for (var o = 0; o < zone.outputs.length; o += 1) names.push(slugOf(zone.outputs[o].name));
      for (var n = 0; n < names.length; n += 1) {
        if (names[n].indexOf(slug) === 0) { pool.push(zone); break; }
      }
    }
    for (var k = 0; k < pool.length; k += 1) {
      if (pool[k].state === 'playing' || pool[k].state === 'loading') { shownZoneId = pool[k].id; return pool[k]; }
    }
    if (pool.length > 0) { shownZoneId = pool[0].id; return pool[0]; }
  }
  return null;
}

function applyArtistView() {
  var zone = currentZone();
  var shots = zone && zone.nowPlaying ? (zone.nowPlaying.artistArts || []) : [];
  if (artistIndex < 0 || artistIndex >= shots.length) {
    artistIndex = -1;
    stopRotation();
    artistLayer.className = 'artistlayer';
    root.removeAttribute('data-view');
    // Name the backdrop so a viewer knows which one they are looking at.
    // The album view carries no label: it is the resting state, and naming it
    // told a viewer nothing they could not see.
    artistName.textContent = '';
    artistName.hidden = true;
    return;
  }
  var shot = shots[artistIndex];
  root.setAttribute('data-view', 'artist');
  startRotation(shots.length);
  // Decode before showing: a half-painted hero is worse than a beat of delay.
  var probe = new Image();
  var reveal = function () {
    artistLayer.style.backgroundImage = 'url("' + shot.path + '")';
    artistLayer.className = 'artistlayer is-lit';
  };
  probe.onload = reveal;
  probe.onerror = function () { artistIndex = -1; applyArtistView(); };
  if ('decode' in HTMLImageElement.prototype) {
    probe.decode().then(reveal).catch(function () { /* onload covers it */ });
  }
  probe.src = shot.path;
  // No "artist" label: a face full of a photograph of the artist does not need
  // telling (Peter, 08-26). The COUNT is not obvious, though, so it stays when
  // there is more than one shot to rotate through.
  var several = shots.length > 1;
  artistName.textContent = several ? (artistIndex + 1) + ' / ' + shots.length : '';
  artistName.hidden = !several;
}

/**
 * Roon ships up to four images per track and which is the performer has never
 * been verified, so a portrait view that sat on one of them answered "who is
 * this?" badly. Rotating every 10 s shows them all without anyone pressing
 * anything (Peter, 08-25).
 */
function stopRotation() {
  if (rotateTimer !== null) { clearInterval(rotateTimer); rotateTimer = null; }
}
function startRotation(count) {
  stopRotation();
  if (count < 2) return;          // one portrait has nothing to rotate to
  rotateTimer = setInterval(function () {
    var zone = currentZone();
    var shots = zone && zone.nowPlaying ? (zone.nowPlaying.artistArts || []) : [];
    if (viewStep !== VIEW_ARTIST || shots.length < 2) { stopRotation(); return; }
    artistIndex = (artistIndex + 1) % shots.length;
    applyArtistView();
  }, ROTATE_MS);
}

/**
 * The pointer shortcut: pressing the cover FLIPS album <-> artist.
 *
 * It used to only ever go TO the album view, which meant pressing the cover while
 * already showing the album did nothing at all — the commonest case, since album
 * is the default (Peter, 08-25: "just not flipping album artist on clicking on
 * album cover"). With two views, the cover is a toggle.
 */
function flipArtwork() {
  cycleArtist();
}

function cycleArtist() {
  var zone = currentZone();
  var shots = zone && zone.nowPlaying ? (zone.nowPlaying.artistArts || []) : [];
  // A straight toggle. With no portraits for this track there is nothing to
  // toggle to, so the album view simply stays.
  viewStep = (viewStep === VIEW_ALBUM && shots.length > 0) ? VIEW_ARTIST : VIEW_ALBUM;
  artistIndex = viewStep === VIEW_ARTIST ? 0 : -1;
  backdropKey = null;                    // the backdrop source changed
  applyArtistView();
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
  // Deliberately NOT showPicker(): that raises the FACE list, which landed on
  // top of the title in album view. The artwork chip already names the step.
}
// `pressable`, not a bare click: a pointer remote may report the press as
// pointerup/touchend/mouseup, and drifts between down and up — the same fault
// that made the control buttons unresponsive.
pressable(cover, flipArtwork);

/* ---------- the picker: arrow keys, because a TV has a remote ---------- */
var pickerTimer = null;
/**
 * DWELL TO SELECT (Peter, 08-25: "perhaps just highlighting for a second should
 * change rather than having to confirm").
 *
 * Resting on a face applies it after a beat — no second gesture. That suits both
 * ends of the room: a pointer hovers, and a remote's focus lands. Leaving before
 * the beat is up cancels, so passing over a name costs nothing, and the option
 * fills with a line while it arms so the wait is visible rather than mysterious.
 */
var DWELL_MS = 900;
var dwellTimer = null;
var dwellNode = null;

function cancelDwell() {
  if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
  if (dwellNode !== null) { dwellNode.className = dwellNode.className.replace(' arming', ''); dwellNode = null; }
}

function armDwell(node, name) {
  if (name === current) return;            // already showing: nothing to arm
  cancelDwell();
  dwellNode = node;
  node.className += ' arming';
  dwellTimer = setTimeout(function () {
    cancelDwell();
    applyFace(name);
  }, DWELL_MS);
}

function paintFaceName() {
  /**
   * ⚖️ THE BADGE SAYS IT IS A TOOL (Peter, 08-28: "add icon to show the face
   * name is a layout tool").
   *
   * "CLASSIC" alone reads as a label — a thing being told to you, not a thing
   * you can press. The mark beside it is a pane divided the way these faces
   * actually divide: the picture on one side, the words on the other. So it says
   * "this is the LAYOUT, and layouts are a choice" without a second word.
   */
  if (cog === null) return;
  cog.replaceChildren(glyph('layout'), document.createTextNode(current));
}

/** Faces that draw the ring round the sleeve share one marker, so their common
 *  rules need no comma — and a comma in a selector is what silently applied the
 *  cover's size to the whole face. */
function markRing() {
  var layout = layoutOf(current);
  var built = layout === 'dial' || layout === 'orbit';
  if (built || RING[current] === 1) root.setAttribute('data-ring', '1');
  else root.removeAttribute('data-ring');
  if (built) root.setAttribute('data-ringlayout', '1');
  else root.removeAttribute('data-ringlayout');
}

/** The two attributes every rule is keyed on: what it looks like, and what is behind it. */
function markLayout() {
  root.setAttribute('data-layout', layoutOf(current));
  if (hasColumn()) root.setAttribute('data-column', '1');
  else root.removeAttribute('data-column');
  if (hasField(current)) root.setAttribute('data-field', '1');
  else root.removeAttribute('data-field');
}

function applyFace(name) {
  if (FACES.indexOf(name) === -1 || name === current) return;
  current = name;
  remember(current);
  root.setAttribute('data-face', current);
  markLayout();
  markRing();
  paintFaceName();
  fieldRunning(hasField(current) && !document.hidden);
  // The GROUND may have changed under it — the backdrop is cached by key, so
  // without this a face that wants the sleeve keeps whatever was already there
  // until the next track happens along.
  backdropKey = '';
  var snap = store.snapshot();
  if (snap !== null) render(snap, 'snapshot');
  showPicker();
}

function faceOption(name) {
  var node = el('span', name === current ? 'opt now' : 'opt', name);
  node.setAttribute('data-face-option', name);
  node.addEventListener('mouseenter', function () { armDwell(node, name); });
  node.addEventListener('mouseleave', cancelDwell);
  // A tap or click is an explicit choice: apply it at once rather than dwelling.
  pressable(node, function () { cancelDwell(); applyFace(name); });
  return node;
}

/**
 * The strip in one of two modes. Splitting it is the point: pressing low used to
 * raise faces, rooms, transport and a hint all at once, right where the finger
 * was — so the next touch hit whatever had appeared there.
 */
function openPanel(mode) {
  showPicker(mode);
}

/** The title band asks "what is playing?" — so it opens the library, not a strip. */
function openBrowseMenu() {
  if (browsePanel !== null) { closeBrowse(); return; }
  showPicker('browse');
}

/**
 * WHAT TO PLAY, rather than how to play it. Every hierarchy the Browse API
 * offers, plus our own ledger — `browse` is the Core's own Explore tree, the way
 * in to anything not listed separately.
 *
 * Built in one place because it is now drawn in two: in the raised strip on the
 * faces that have one, and standing above the metadata on the faces that carry
 * their chrome in the layout. Two copies of this list would drift.
 */
function buildBrowseRow() {
  var row = el('div', 'row row-browse');
  var entry = function (label, onPress) {
    var b = el('span', 'opt browse-entry');
    b.appendChild(glyph(label));
    b.appendChild(document.createTextNode(label));
    pressable(b, onPress);
    return b;
  };
  row.appendChild(entry('explore', function () { openHierarchy('browse', 'Explore'); }));
  row.appendChild(entry('genres', function () { openHierarchy('genres', 'Genres'); }));
  row.appendChild(entry('albums', function () { openHierarchy('albums', 'Albums'); }));
  row.appendChild(entry('artists', function () { openHierarchy('artists', 'Artists'); }));
  row.appendChild(entry('composers', function () { openHierarchy('composers', 'Composers'); }));
  row.appendChild(entry('playlists', function () { openHierarchy('playlists', 'Playlists'); }));
  row.appendChild(entry('radio', function () { openHierarchy('internet_radio', 'Live radio'); }));
  row.appendChild(entry('recent', openRecent));
  return row;
}

/**
 * Rebuild Classic's shelf. Cheap enough to do on every structural frame — the
 * strip does exactly the same — and it keeps the play/pause glyph, the lit
 * shuffle and repeat, and the levels honest without a separate repaint path.
 */
/**
 * Which faces carry their controls IN the layout rather than under a raised
 * strip. Classic settled the pattern; Orbit takes it (Peter, 08-28: "this
 * layout can be applied to orbit"), and it is asked as a question rather than
 * spelled as `!== 'classic'` in four places, which is how the third face would
 * have been missed.
 */
/**
 * ⚖️ EVERY FACE CARRIES ITS CHROME NOW (Peter, 08-28: "the old chrome control
 * and browse options keep popping up on the old players — remove these").
 *
 * Nothing raises a strip any more. What differs is WHERE the chrome lives: the
 * faces with a words' column beside the artwork put it in that column, and the
 * rest put it in bands above and below the middle of the frame. Both hold their
 * space always and only fade, which is the whole point — a control that appears
 * under the finger that summoned it is the fault this replaces.
 */
function hasShelf() { return true; }

/** Faces whose chrome lives in the words' column rather than in bands. */
function hasColumn() { var l = layoutOf(current); return l === 'classic' || l === 'orbit'; }

function renderShelf(zone) {
  if (!hasShelf() || zone === null) {
    if (shelfTransport.childNodes.length > 0) shelfTransport.replaceChildren();
    if (shelfVolume.childNodes.length > 0) shelfVolume.replaceChildren();
    if (shelfBrowse.childNodes.length > 0) shelfBrowse.replaceChildren();
    root.removeAttribute('data-shelf');
    return;
  }
  root.setAttribute('data-shelf', '1');
  shelfTransport.replaceChildren(buildControls(zone, false));
  // The disclosure lives on the column now, so it is not swept away by replacing
  // the row's children — take the old one out by hand before building the next.
  var stale = copy.querySelectorAll('.member-vols');
  for (var st = 0; st < stale.length; st += 1) {
    if (stale[st].parentNode === copy) copy.removeChild(stale[st]);
  }
  memberVols = null;
  shelfVolume.replaceChildren(buildVolumeOnly(zone));
  // Only once: the entries never change, and rebuilding them every frame would
  // throw away a press that landed mid-repaint.
  if (shelfBrowse.childNodes.length === 0) shelfBrowse.appendChild(buildBrowseRow());
}

/**
 * The volume half: a master for a group with its rooms behind a count, or the
 * one room's own scale. Lifted out of the control line so Classic can put it
 * above its progress bar while the transport sits under its metadata.
 */
function appendVolume(controls, zone, button) {
  var groupOuts = [];
  if (zone !== null && zone.outputs.length > 1) {
    for (var gi = 0; gi < zone.outputs.length; gi += 1) {
      var go = zone.outputs[gi];
      if (go.volume !== null && go.volume.value !== null && go.volume.max !== null
          && go.volume.type !== 'incremental') groupOuts.push(go);
    }
  }
  if (groupOuts.length > 1) {
    var levels = [];
    for (var li = 0; li < groupOuts.length; li += 1) {
      var lv = groupOuts[li].volume;
      var lmin = lv.min === null ? 0 : lv.min;
      levels.push(Math.max(0, Math.min(1, (lv.value - lmin) / Math.max(1, lv.max - lmin))));
    }
    var mean = 0;
    for (var mi = 0; mi < levels.length; mi += 1) mean += levels[mi];
    mean = mean / levels.length;

    var master = groupScale(zone, mean);
    // ALL of them, not any: the name said `anyMuted` and the loop computed the
    // opposite, which is the sort of thing that survives until somebody presses it.
    var allMuted = true;
    for (var qi = 0; qi < groupOuts.length; qi += 1) if (!groupOuts[qi].volume.muted) allMuted = false;
    var masterSpeaker = volumeSpeaker(groupOuts[0], allMuted ? 0 : mean, groupOuts);
    volUi = { speaker: masterSpeaker, scale: master, outputId: groupOuts[0].id, group: true };
    controls.appendChild(masterSpeaker);
    controls.appendChild(master);
    controls.appendChild(roomsToggle(zone, groupOuts));
  } else {

  var output = volumeOutput();
  var vol = output === null ? null : output.volume;
  if (vol === null) {
    volUi = null;
    controls.appendChild(button('minus', 'no volume control', false, function () {}));
    controls.appendChild(button('plus', 'no volume control', false, function () {}));
  } else if (vol.type === 'incremental' || vol.value === null || vol.max === null) {
    var incSpeaker = volumeSpeaker(output, 0.5);
    volUi = { speaker: incSpeaker, scale: null, outputId: output.id };
    controls.appendChild(incSpeaker);
    controls.appendChild(button('minus', 'quieter \u00B7 ' + output.name, true, function () { nudgeVolume(-1); }));
    controls.appendChild(button('plus', 'louder \u00B7 ' + output.name, true, function () { nudgeVolume(1); }));
  } else {
    var min = vol.min === null ? 0 : vol.min;
    var span = Math.max(1, vol.max - min);
    var level = Math.max(0, Math.min(1, (vol.value - min) / span));
    var speakerNode = volumeSpeaker(output, vol.muted ? 0 : level);
    var scaleNode = volumeScale(output, level, min, span);
    volUi = { speaker: speakerNode, scale: scaleNode, outputId: output.id };
    controls.appendChild(speakerNode);
    // The scale is flanked by a quiet speaker and a loud one, and they step the
    // level (Peter, 08-26). They read as the ends of the scale they bracket, so
    // the group says "this is loudness" without a label.
    controls.appendChild(volumeStep(output, 'down'));
    controls.appendChild(scaleNode);
    controls.appendChild(volumeStep(output, 'up'));
  }
  }
}

/**
 * THE CONTROL LINE, built once and mounted wherever a face wants it.
 *
 * Every face but Classic puts it in the floating strip. Classic mounts the
 * transport under its metadata and the volume above its progress, so the same
 * builders serve both and there is one implementation of what a button does.
 * `withVolume` keeps the strip's order exactly as it was — shuffle, prev, play,
 * next, VOLUME, repeat — while the shelf takes the two halves separately.
 */
function buildControls(zone, withVolume) {
  var controls = el('div', 'controls');
  var button = function (label, title, enabled, onPress) {
    var b = el('span', enabled ? 'ctl' : 'ctl off');
    b.appendChild(glyph(label));
    b.setAttribute('title', title);
    b.setAttribute('aria-label', title);
    if (enabled) pressable(b, onPress);
    return b;
  };
  var playing = zone !== null && zone.state === 'playing';
  /**
   * SHUFFLE and REPEAT bracket the line (Peter, 08-26). They are not transport —
   * they say how the queue will be READ — so they sit at the ends rather than
   * among play and volume, and they are LIT rather than pressed-looking: their
   * state is the point, and the state belongs to Roon.
   */
  var settings = zone === null ? null : zone.settings;
  var lit = function (name, title, on, onPress) {
    var b = el('span', settings === null ? 'ctl off' : (on ? 'ctl lit' : 'ctl'));
    b.appendChild(glyph(name));
    b.setAttribute('title', title);
    b.setAttribute('aria-label', title);
    if (settings !== null) pressable(b, onPress);
    return b;
  };
  controls.appendChild(lit('shuffle',
    settings !== null && settings.shuffle ? 'shuffle is on' : 'shuffle',
    settings !== null && settings.shuffle,
    function () { command({ action: 'shuffle', zone: zone.id }); }));
  controls.appendChild(button('prev', 'previous', zone !== null && zone.allowed.previous,
    function () { transport('previous'); }));
  /**
   * PLAY IS THE ONE YOU REACH FOR, so it is a little larger and a little
   * brighter than its neighbours — the same emphasis the wall card gives it.
   * Subtle on purpose: the row still has to read as one line of equals.
   */
  var playBtn = button(playing ? 'pause' : 'play', playing ? 'pause' : 'play',
    zone !== null && (zone.allowed.pause || zone.allowed.play), function () { transport('playpause'); });
  playBtn.className += ' is-play';
  controls.appendChild(playBtn);
  controls.appendChild(button('next', 'next', zone !== null && zone.allowed.next,
    function () { transport('next'); }));

  /**
   * VOLUME, in the runway's own language.
   *
   * A speaker you press to mute, then a scale of segments you press anywhere on.
   * The segments are the same motif as the Approach progress, so volume and
   * position belong to one visual family rather than a slider imported from a
   * different design world. Pressing a position sets it absolutely — dragging with
   * a pointer remote held in the air is miserable, so press-to-position is the
   * gesture and drag is only a bonus where the device supports it.
   *
   * An `incremental` output has no level to show at all — Roon says so — and falls
   * back to plus and minus.
   */
  /**
   * A GROUP HAS ONE LEVEL, AND ROOMS BEHIND IT.
   *
   * Until now a grouped zone had NO volume control here at all: `volumeOutput`
   * returns null the moment a zone has more than one output, so joining two rooms
   * silently took the volume away. Roon's own remote has the same hole from the
   * other side — per-endpoint sliders and no master, asked for since 2018.
   *
   * So: a master scale that moves every room at once, preserving the offsets
   * between them (the quiet room stays quieter — Sonos's documented contract,
   * adopted verbatim), and a room-count button that discloses the individual
   * scales beneath it. The zone master stays visually separate from the member
   * controls, which is the distinction Sonos's guidance draws and RHEOS's own
   * console follows.
   */
  if (withVolume) appendVolume(controls, zone, button);
  // Repeat closes the line. The glyph itself carries which of the three states
  // Roon is in — a bare circuit for "all", a circuit with a 1 for "this track".
  var loop = settings === null ? 'disabled' : settings.loop;
  controls.appendChild(lit(loop === 'loop_one' ? 'repeat-one' : 'repeat',
    loop === 'loop_one' ? 'repeating this track' : (loop === 'loop' ? 'repeating the queue' : 'repeat'),
    loop !== 'disabled',
    function () { command({ action: 'repeat', zone: zone.id }); }));
  return controls;
}

/** The volume half on its own, for a face that sites it away from the transport. */
function buildVolumeOnly(zone) {
  var controls = el('div', 'controls');
  appendVolume(controls, zone, function (label, title, enabled, onPress) {
    var b = el('span', enabled ? 'ctl' : 'ctl off');
    b.appendChild(glyph(label));
    b.setAttribute('title', title);
    b.setAttribute('aria-label', title);
    if (enabled) pressable(b, onPress);
    return b;
  });
  return controls;
}

/**
 * The pause after the last choice, after which the group is simply formed.
 * Long enough to pick a second and third room without hurrying; short enough
 * that nobody wonders whether it heard them.
 */
var GROUP_SETTLE_MS = 2600;
var groupSettleTimer = null;

function cancelGroupSettle() {
  if (groupSettleTimer !== null) { clearTimeout(groupSettleTimer); groupSettleTimer = null; }
}

/**
 * ⚖️ ONE GESTURE, ONE REGROUPING (Peter, 08-28: "don't trigger group with each
 * addition or removal — wait until all done... it causes a playback glitch
 * repeating the first second or so").
 *
 * `groupPick` is the MEMBERSHIP someone is arriving at — the output ids that
 * should be in this group when they stop touching it — not a list of rooms to
 * add. That is what makes adding two and dropping one a single instruction:
 * every press rewrites the same answer, and only the answer is sent.
 *
 * The lead is always first and always in it. Roon keeps the first output's
 * queue, so the lead is the room whose music this is; dropping it would be
 * asking whose music survives, which is a different question with a different
 * gesture (ungroup).
 */
function armGroupSettle(head) {
  cancelGroupSettle();
  groupSettleTimer = setTimeout(function () {
    groupSettleTimer = null;
    if (head === null || head.outputs.length === 0) return;
    var ids = [head.outputs[0].id];
    for (var i = 0; i < groupPick.length; i += 1) {
      if (ids.indexOf(groupPick[i]) === -1) ids.push(groupPick[i]);
    }
    groupPick = [];
    picker.hidden = true;
    // The server works out the smallest set of calls, and sends none at all if
    // this is the membership it already has.
    command({ action: 'regroup', zone: head.id, outputs: ids });
  }, GROUP_SETTLE_MS);
}

/** The membership being chosen, as output ids. Kept across the picker's redraws. */
var groupPick = [];

/** Open the picker on what the group IS, so a press can take a room out of it. */
function startGroupPick() {
  var here = currentZone();
  groupPick = here === null ? [] : here.outputs.map(function (o) { return o.id; });
  showPicker('group');
}

/**
 * A ROOM, drawn as what it is doing rather than as a word.
 *
 * The picker was a wall of identical text chips, and picking a room out of
 * twenty-two of those is reading, not looking (Peter, 08-26). The sleeve it is
 * playing is the fastest possible way to recognise a room you were just
 * listening to, and it costs nothing: it is the same art path the wall already
 * fetched, so the browser has it cached.
 *
 * Square and untinted. It is small, but it is still somebody's album cover.
 */
function roomOption(zone, extra, onPress, label) {
  var node = el('span', 'opt roomcard' + (extra === '' ? '' : ' ' + extra));
  var art = el('span', 'roomcard-art');
  var np = zone.nowPlaying;
  if (np !== null && np.art !== null) {
    var img = document.createElement('img');
    img.alt = '';
    img.src = np.art.path;
    art.appendChild(img);
  } else {
    art.className += ' is-quiet';
    art.appendChild(glyphSpeaker(0.5, false));
  }
  node.appendChild(art);
  var text = el('span', 'roomcard-text');
  text.appendChild(el('span', 'roomcard-name', label === undefined ? zone.name : label));
  /**
   * The state is a MARK, not a word (Peter, 08-26). "paused" spelled out took the
   * whole line and pushed off the one thing that identifies the room to someone
   * who was just listening to it — the track. A play or pause glyph says the same
   * in a character's width, and the title gets the rest.
   */
  var line = el('span', 'roomcard-np');
  if (np !== null) {
    var mark = zone.state === 'playing' || zone.state === 'loading' ? 'play'
      : (zone.state === 'paused' ? 'pause' : null);
    if (mark !== null) {
      var svg = glyph(mark);
      svg.setAttribute('class', 'glyph np-mark');
      line.appendChild(svg);
    }
    line.appendChild(document.createTextNode(np.title));
  }
  text.appendChild(line);
  node.appendChild(text);
  if (onPress !== null) pressable(node, onPress);
  return node;
}

function zoneById(id) {
  var snap = store.snapshot();
  if (snap === null) return null;
  for (var i = 0; i < snap.zones.length; i += 1) if (snap.zones[i].id === id) return snap.zones[i];
  return null;
}

/**
 * What can be DONE with this room, as opposed to which room to look at. Only what
 * is actually possible is offered: no "ungroup" on a room that is not a group, no
 * "group" where Roon has no peer to offer, no "transfer" with nothing playing.
 */
function zoneActionRow(here) {
  var row = el('div', 'row row-actions');
  if (here === null) return row;
  var island = here.outputs.length === 0 ? [] : here.outputs[0].groupableWith;
  var hasPeer = island.length > 1;
  var isGroup = here.outputs.length > 1;

  /**
   * Icon AND word. These three are rare enough that nobody has learned their
   * shapes, and "two circles apart" is only obviously ungroup once you have seen
   * it beside group — so the mark speeds up recognition rather than carrying the
   * meaning on its own (Peter, 08-26: "or replace with icon if meaning is
   * evident" — here it is not).
   */
  var act = function (mark, label, enabled, onPress) {
    var b = el('span', enabled ? 'opt act' : 'opt act off');
    b.appendChild(glyph(mark));
    b.appendChild(document.createTextNode(label));
    if (enabled) pressable(b, onPress);
    return b;
  };
  row.appendChild(act('group', 'group\u2026', hasPeer, startGroupPick));
  row.appendChild(act('ungroup', 'ungroup', isGroup, function () {
    picker.hidden = true;
    command({ action: 'ungroup', zone: here.id });
  }));
  row.appendChild(act('send-to', 'send to\u2026', here.nowPlaying !== null, function () { showPicker('transfer'); }));
  return row;
}

function showPicker(mode) {
  cancelDwell();
  mode = mode || 'transport';
  /**
   * Two rows, deliberately. Everything shared one wrapping flex container, so the
   * fifth face fell onto the second line and sat among the transport buttons — an
   * accident of width, not a grouping (Peter, 08-25: "keep all faces on top line
   * and second line should select other options").
   *
   * Row one is what the screen IS. Row two is what it DOES — and row two is where
   * browse, grouping, genre and recently-played will go.
   */
  var nodes = [];

  /**
   * ROOMS. A screen bound to a room still wants to look at another one
   * occasionally, and the Wall is a different page — going there loses your place.
   * So this lists the rooms, with the Wall offered explicitly at the end for when
   * the whole house is what you want.
   */
  if (mode === 'rooms') {
    var roomRow = el('div', 'row row-faces');
    var snapshot = store.snapshot();
    var zones = snapshot === null ? [] : snapshot.zones;
    var here = currentZone();
    /**
     * A LOCKED SCREEN DOES NOT OFFER OTHER ROOMS — that is the whole point of
     * locking it. It still shows the room it is bound to, and it still gets the
     * group and send-to actions, because the room joining a group is exactly the
     * case the binding was designed to follow.
     */
    if (lockedOutputId !== null) {
      if (here !== null) roomRow.appendChild(roomOption(here, 'now is-playing', null));
      roomRow.appendChild(el('span', 'opt off', 'locked to this room'));
      nodes.push(roomRow);
      nodes.push(zoneActionRow(here));
      picker.replaceChildren.apply(picker, nodes);
      picker.className = 'picker mode-' + mode;
      picker.hidden = false;
      panelShownAt = Date.now();
      if (pickerTimer !== null) clearTimeout(pickerTimer);
      pickerTimer = setTimeout(function () { picker.hidden = true; }, 22000);
      return;
    }
    for (var r = 0; r < zones.length; r += 1) {
      (function (z) {
        var opt = roomOption(z,
          ((here !== null && z.id === here.id) ? 'now' : '') + (z.state === 'playing' ? ' is-playing' : ''),
          function () {
            shownZoneId = z.id;
            boundOutputId = null;        // a deliberate look elsewhere releases the binding
            following = false;
            picker.hidden = true;
            var snap = store.snapshot();
            if (snap !== null) render(snap, 'snapshot');
          });
        roomRow.appendChild(opt);
      })(zones[r]);
    }
    var wall = el('span', 'opt', 'the wall');
    pressable(wall, function () { location.href = '/'; });
    roomRow.appendChild(wall);
    nodes.push(roomRow);
    nodes.push(zoneActionRow(here));
  }

  /**
   * PICKING ROOMS TO GROUP.
   *
   * Roon partitions grouping by protocol and says so per output, so a room
   * outside this zone's island is drawn GREYED rather than hidden: "why is the
   * Study not in this list" is a worse question than seeing it there, unavailable,
   * and understanding that Roon will not join those two.
   *
   * The zone we came from is the head, and Roon preserves the head's queue — so
   * grouping from a room that is playing carries that music to the others, which
   * is what pressing "group" from a playing room ought to mean.
   */
  if (mode === 'group') {
    var head = currentZone();
    var island = head === null || head.outputs.length === 0 ? '' : head.outputs[0].island;
    var pickRow = el('div', 'row row-faces row-column');
    /**
     * THIS ROOM COMES FIRST, and pressing it lets the others go (Peter, 08-28).
     * It reads as a list of members with the one you are standing in at the top,
     * so releasing them is where your eye already is. It is only offered when
     * there IS a group — a room on its own has nothing to release.
     *
     * ⚠️ The room name in the HEADER still goes to the wall. These are two
     * different objects in two different places, which is how the same word can
     * mean "leave here" up there and "let them go" down here.
     */
    /**
     * THE LEAD COMES FIRST and is never a checkbox (Peter, 08-28: "anchored
     * always on the group lead"). It owns the queue, so it is what the group IS;
     * pressing it lets every room go at once, which is the one grouping action
     * that should not wait for a settle.
     */
    if (head !== null) {
      var lead = head.outputs[0];
      var isGroup = head.outputs.length > 1;
      var mine = roomOption(head, isGroup ? 'now is-lead' : 'now is-lead solo', isGroup ? function () {
        cancelGroupSettle();
        groupPick = [];
        picker.hidden = true;
        command({ action: 'ungroup', zone: head.id });
      } : null, lead.name);
      mine.setAttribute('title', isGroup
        ? lead.name + ' leads \u00B7 press to let every room go'
        : lead.name + ' \u00B7 the room you are in');
      pickRow.appendChild(mine);
      // The row that leads the group must be the one you see first: something
      // was scrolling it 34px out of sight the moment the column was built.
      setTimeout(function () { pickRow.scrollTop = 0; }, 0);

      /**
       * THE ROOMS ALREADY IN, shown as what they are — chosen. Unchoosing one is
       * a removal that waits with everything else, so adding two rooms and
       * dropping one is still a single instruction to Roon.
       */
      for (var m = 1; m < head.outputs.length; m += 1) {
        (function (o) {
          var held = groupPick.indexOf(o.id) !== -1;
          pickRow.appendChild(roomOption(head, held ? 'now' : 'leaving', function () {
            var at = groupPick.indexOf(o.id);
            if (at === -1) groupPick.push(o.id); else groupPick.splice(at, 1);
            showPicker('group');
          }, o.name));
        })(head.outputs[m]);
      }
    }
    var snap2 = store.snapshot();
    var all = snap2 === null ? [] : snap2.zones;
    for (var g = 0; g < all.length; g += 1) {
      (function (z) {
        if (head !== null && z.id === head.id) return;
        // One island per zone: every output of a grouped zone is in the same one,
        // because Roon could not have grouped them otherwise.
        var joinable = island !== '' && z.outputs.length > 0 && z.outputs.every(function (o) {
          return o.island === island;
        });
        // A room Roon will not join is simply NOT HERE (Peter, 08-26). Showing it
        // greyed explained the rule but made the list twice as long to read, and
        // the list is what you are trying to choose from.
        if (!joinable) return;
        var ids = z.outputs.map(function (o) { return o.id; });
        var chosen = ids.every(function (id) { return groupPick.indexOf(id) !== -1; });
        pickRow.appendChild(roomOption(z, chosen ? 'now' : '', function () {
          for (var k = 0; k < ids.length; k += 1) {
            var at = groupPick.indexOf(ids[k]);
            if (chosen) { if (at !== -1) groupPick.splice(at, 1); }
            else if (at === -1) groupPick.push(ids[k]);
          }
          showPicker('group');
        }));
      })(all[g]);
    }
    nodes.push(pickRow);

    /**
     * ⚖️ THE SELECTION SETTLES AND FIRES ITSELF (Peter, 08-28: "should be after
     * x secs of the input being made... the chrome closes and the grouping
     * actually happens").
     *
     * No confirm button: choosing rooms IS the instruction, and a button only
     * asks you to say it twice. The clock restarts on every choice, so picking
     * five rooms is one settle, not five — and cancel still stops it, which is
     * what keeps an automatic commit honest.
     *
     * It says what it is about to do and counts down while it does, because an
     * action that fires on its own must never be a surprise.
     */
    var doneRow = el('div', 'row row-faces');
    /**
     * WHAT IS ABOUT TO HAPPEN, in the words of the change rather than the count:
     * "adding 2 rooms" and "letting 1 room go" are different enough that reading
     * the wrong one is a mistake, and this line is the only warning there is.
     */
    var inNow = head === null ? [] : head.outputs.map(function (o) { return o.id; });
    var adding = 0, dropping = 0;
    for (var ai = 0; ai < groupPick.length; ai += 1) if (inNow.indexOf(groupPick[ai]) === -1) adding += 1;
    for (var di = 1; di < inNow.length; di += 1) if (groupPick.indexOf(inNow[di]) === -1) dropping += 1;
    var roomWord = function (n) { return String(n) + (n === 1 ? ' room' : ' rooms'); };
    var said = adding === 0 && dropping === 0
      ? (head !== null && head.outputs.length > 1 ? 'this group is as it is' : 'choose the rooms to add')
      : (adding > 0 && dropping > 0
        ? 'adding ' + roomWord(adding) + ', letting ' + roomWord(dropping) + ' go\u2026'
        : (adding > 0 ? 'adding ' + roomWord(adding) + '\u2026'
          : 'letting ' + roomWord(dropping) + ' go\u2026'));
    var settling = adding > 0 || dropping > 0;
    var form = el('span', settling ? 'opt settling' : 'opt off settling', said);
    doneRow.appendChild(form);
    if (head !== null && head.outputs.length > 1) {
      var dissolve = el('span', 'opt', 'ungroup');
      pressable(dissolve, function () {
        // Immediately, and the list stays open showing every room unselected —
        // which is the truth the moment the group is gone.
        cancelGroupSettle();
        groupPick = [];
        command({ action: 'ungroup', zone: head.id });
        setTimeout(function () { if (!picker.hidden) startGroupPick(); }, 900);
      });
      doneRow.appendChild(dissolve);
    }
    var cancel = el('span', 'opt', 'cancel');
    pressable(cancel, function () { cancelGroupSettle(); groupPick = []; showPicker('rooms'); });
    doneRow.appendChild(cancel);

    // Nothing to send is nothing to count down: the clock only runs when a real
    // change is waiting, so opening the picker to look never regroups anything.
    if (settling && head !== null) armGroupSettle(head); else cancelGroupSettle();
    nodes.push(doneRow);
  }

  /** WHERE SHOULD THIS MUSIC GO? One press, and the queue and position go with it. */
  if (mode === 'transfer') {
    var fromZone = currentZone();
    var toRow = el('div', 'row row-faces');
    var snap3 = store.snapshot();
    var others = snap3 === null ? [] : snap3.zones;
    for (var x = 0; x < others.length; x += 1) {
      (function (z) {
        if (fromZone !== null && z.id === fromZone.id) return;
        toRow.appendChild(roomOption(z, '', function () {
          picker.hidden = true;
          command({ action: 'transfer', zone: fromZone.id, to: z.id });
          shownZoneId = z.id;
        }));
      })(others[x]);
    }
    nodes.push(toRow);
  }

  if (mode === 'faces') {
    var faceRow = el('div', 'row row-faces');
    for (var f = 0; f < FACES.length; f += 1) faceRow.appendChild(faceOption(FACES[f]));
    nodes.push(faceRow);
  }

  var actionRow = el('div', 'row row-actions');
  var rooms = null;
  // The room lives in the top-left indicator now, not in this bar.


  var zone = currentZone();
  var controls = buildControls(zone, true);
  actionRow.appendChild(controls);
  if (mode === 'transport') nodes.push(actionRow);

  // Row three: what to play, rather than how to play it.
  if (mode === 'browse') nodes.push(buildBrowseRow());
  if (mode === 'faces') {
    nodes.push(el('em', 'hint', 'keys:  space play  \u00B7  n next  \u00B7  b back  \u00B7  u / d volume  \u00B7  f face  \u00B7  a artwork'));
  }
  /**
   * ⚖️ THE PICKERS ARE WINDOWS ON THE COLUMN TOO (Peter, 08-28: "the options for
   * faces should occupy the same space on the right as the other pop up
   * windows").
   *
   * Browse and the room levels already land there; a strip across the bottom of
   * the frame for the faces was the odd one out, and it covered the artwork on
   * its way past. On a face that carries its chrome in the layout every panel
   * now opens in the same rectangle, so there is one place to look and one place
   * to press away from.
   */
  var host = hasShelf() ? copy : pickerHome;
  if (picker.parentNode !== host) host.appendChild(picker);
  picker.replaceChildren.apply(picker, nodes);
  picker.className = 'picker mode-' + mode;
  picker.hidden = false;
  panelShownAt = Date.now();
  if (pickerTimer !== null) clearTimeout(pickerTimer);
  // Choosing several rooms takes longer than choosing one face, and a strip that
  // vanishes mid-choice loses the choice. Touch has no hover to hold it open.
  var linger = (mode === 'group' || mode === 'transfer' || mode === 'rooms') ? 22000 : 8000;
  pickerTimer = setTimeout(function () { picker.hidden = true; }, linger);
}

// Hovering anywhere in the strip holds it open — it must not vanish mid-choice.
picker.addEventListener('mouseenter', function () {
  if (pickerTimer !== null) { clearTimeout(pickerTimer); pickerTimer = null; }
});
picker.addEventListener('mouseleave', function () {
  cancelDwell();
  if (pickerTimer !== null) clearTimeout(pickerTimer);
  pickerTimer = setTimeout(function () { picker.hidden = true; }, 1500);
});
function cycleFace(delta) {
  var index = FACES.indexOf(current);
  applyFace(FACES[(index + delta + FACES.length) % FACES.length]);
  showPicker();
}

/** Up/Down walk the house, in the Wall's order, from a remote. */
/**
 * Up/Down walk one list: [Following] then every room in the Wall's order. Making
 * "following" the first position means it stays reachable from a remote without
 * spending a key the remote may not have.
 */
function cycleZone(delta) {
  var snapshot = store.snapshot();
  if (snapshot === null || snapshot.zones.length === 0) return;
  var stops = [null];   // null = the Following position
  for (var i = 0; i < snapshot.zones.length; i += 1) stops.push(snapshot.zones[i].id);
  var at = following ? 0 : Math.max(0, stops.indexOf(shownZoneId));
  var next = (at + delta + stops.length) % stops.length;
  var chosen = stops[next];
  if (chosen === null) {
    following = true;
    writeFlag(STORE_KEY_FOLLOW + zoneId, true);
    try { localStorage.removeItem(STORE_KEY_ZONE + zoneId); } catch (error) { /* private mode */ }
  } else {
    following = false;
    shownZoneId = chosen;
    // Browsing by hand releases the room binding for this session — otherwise the
    // next snapshot would snap the screen straight back to its own room.
    boundOutputId = null;
    writeFlag(STORE_KEY_FOLLOW + zoneId, false);
    try { localStorage.setItem(STORE_KEY_ZONE + zoneId, chosen); } catch (error) { /* private mode */ }
  }
  viewStep = VIEW_ALBUM;
  artistIndex = -1;
  backdropKey = null;
  applyArtistView();
  render(snapshot, 'snapshot');
  showPicker();
}

function toggleFollow() {
  following = !following;
  writeFlag(STORE_KEY_FOLLOW + zoneId, following);
  if (following) {
    try { localStorage.removeItem(STORE_KEY_ZONE + zoneId); } catch (error) { /* private mode */ }
    var snapshot = store.snapshot();
    if (snapshot !== null) render(snapshot, 'snapshot');
  }
  showPicker();
}

/* ---------- the ambient field (the Canvas face) ----------
 * Slow drifting lights in the sleeve's own tones. Drawn at 240x135 and upscaled
 * by CSS, at 8 fps, and only while the Canvas face is showing — a living-room
 * wall does not need a physics engine, and a 2019 TV cannot afford one.
 */
var fieldCtx = field.getContext('2d');
var blobs = [];
var fieldTimer = null;

function seedField() {
  blobs = [];
  // Many small, faint lights read as depth; a few large bright ones read as
  // polka dots — which is what the first attempt looked like.
  for (var i = 0; i < 40; i += 1) {
    blobs.push({
      x: Math.random() * field.width,
      y: Math.random() * field.height,
      r: 4 + Math.random() * 13,
      dx: (Math.random() - 0.5) * 0.14,
      dy: (Math.random() - 0.5) * 0.09,
      tone: i % 3,
      alpha: 0.05 + Math.random() * 0.07,
    });
  }
}

function drawField() {
  if (fieldCtx === null) return;
  fieldCtx.globalCompositeOperation = 'source-over';
  fieldCtx.fillStyle = 'rgba(7,8,10,0.22)';         // a soft trail, never a hard clear
  fieldCtx.fillRect(0, 0, field.width, field.height);
  fieldCtx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < blobs.length; i += 1) {
    var b = blobs[i];
    b.x += b.dx; b.y += b.dy;
    if (b.x < -b.r) b.x = field.width + b.r;
    if (b.x > field.width + b.r) b.x = -b.r;
    if (b.y < -b.r) b.y = field.height + b.r;
    if (b.y > field.height + b.r) b.y = -b.r;
    var grad = fieldCtx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    // Fading well before the edge is what makes a light look out of focus rather
    // than drawn: a hard rim is the whole difference.
    grad.addColorStop(0, palette[b.tone] || '#3a2b24');
    grad.addColorStop(0.45, palette[b.tone] || '#3a2b24');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    fieldCtx.globalAlpha = b.alpha;
    fieldCtx.fillStyle = grad;
    fieldCtx.beginPath();
    fieldCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    fieldCtx.fill();
    fieldCtx.globalAlpha = 1;
  }
}

function fieldRunning(on) {
  if (on && fieldTimer === null) {
    if (blobs.length === 0) seedField();
    // A settled first frame: an empty canvas fading in reads as a fault.
    for (var warm = 0; warm < 40; warm += 1) drawField();
    fieldTimer = setInterval(drawField, 125);       // 8 fps
  } else if (!on && fieldTimer !== null) {
    clearInterval(fieldTimer); fieldTimer = null;
  }
}
// Never animate a screen nobody is looking at.
document.addEventListener('visibilitychange', function () {
  if (document.hidden) fieldRunning(false);
  else fieldRunning(hasField(current));
});

/**
 * SVG, not characters. U+23F8 and friends are EMOJI codepoints, so a browser
 * substitutes a colour emoji font and the pause button arrived bright blue
 * (Peter, 08-25: "keep black and white simple pause symbol"). A path inherits
 * currentColor and cannot be re-coloured by a font.
 */
/**
 * A press, however the device chooses to report one.
 *
 * A Samsung pointer remote is not a mouse: depending on the set it may emit
 * pointerup, touchend, mouseup or click, and clicking with it can fail to produce
 * a `click` at all if the pointer drifts a pixel between down and up — which it
 * does, because it is held in the air (Peter, 08-25: "the browser isn't responding
 * to the click enter button when its over a part of the screen").
 *
 * So bind them all, and de-duplicate: one physical press must never fire twice.
 */
function pressable(node, onPress) {
  var last = 0;

  /**
   * A TAP IS NOT A SCROLL.
   *
   * Every touch that ended on a row counted as a press, so dragging a long list
   * fired whatever the finger happened to lift over — and the list barely moved,
   * because the press also called preventDefault. Scrolling browse worked with a
   * mouse and not with a finger (Peter, 08-26).
   *
   * A touch that MOVED more than a few pixels is a scroll and is not a press.
   */
  var touchStart = null;
  node.addEventListener('touchstart', function (event) {
    var t = event.touches && event.touches[0];
    touchStart = t ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });

  var fire = function (event) {
    if (event && event.type === 'touchend' && touchStart !== null) {
      var t = event.changedTouches && event.changedTouches[0];
      if (t) {
        var moved = Math.abs(t.clientX - touchStart.x) + Math.abs(t.clientY - touchStart.y);
        touchStart = null;
        if (moved > 12) return;        // a drag, not a tap
      }
    }
    var now = Date.now();
    if (now - last < 400) return;      // the same press arriving under another name
    // The touch that summoned a panel must not fall through onto a control that
    // appeared beneath it — the cause of music starting at random.
    if (panelJustAppeared()) return;
    last = now;
    if (event && event.stopPropagation) event.stopPropagation();
    // preventDefault on a touchend cancels the browser's own momentum, so it is
    // only used where it is needed to stop a duplicate synthetic click.
    if (event && event.preventDefault && event.type !== 'touchend') event.preventDefault();
    onPress();
  };
  node.addEventListener('click', fire);
  node.addEventListener('pointerup', fire);
  node.addEventListener('touchend', fire);
  node.addEventListener('mouseup', fire);
  // A remote's centre button while hovering can arrive as a key, with the pointer
  // position deciding the target. Accept a press on a focused/hovered node too.
  node.addEventListener('keyup', fire);
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'button');
}

function glyphSpeaker(level, muted) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var cone = document.createElementNS(SVG_NS, 'path');
  cone.setAttribute('fill', 'currentColor');
  cone.setAttribute('d', 'M4 9.5h3.4L12 5.4v13.2L7.4 14.5H4z');
  svg.appendChild(cone);
  var wave = function (d) {
    var w = document.createElementNS(SVG_NS, 'path');
    w.setAttribute('fill', 'none');
    w.setAttribute('stroke', 'currentColor');
    w.setAttribute('stroke-width', '1.5');
    w.setAttribute('stroke-linecap', 'round');
    w.setAttribute('d', d);
    return w;
  };
  if (muted) {
    // A bold bar THROUGH the whole icon, not a small cross beside it: the first
    // attempt read as a volume symbol rather than a muted one (Peter, 08-26).
    var cross = document.createElementNS(SVG_NS, 'path');
    cross.setAttribute('stroke', 'currentColor');
    cross.setAttribute('stroke-width', '2.4');
    cross.setAttribute('stroke-linecap', 'round');
    cross.setAttribute('d', 'M14.6 8.6l6.2 6.8');
    svg.appendChild(cross);
    var cross2 = document.createElementNS(SVG_NS, 'path');
    cross2.setAttribute('stroke', 'currentColor');
    cross2.setAttribute('stroke-width', '2.4');
    cross2.setAttribute('stroke-linecap', 'round');
    cross2.setAttribute('d', 'M20.8 8.6l-6.2 6.8');
    svg.appendChild(cross2);
  } else {
    // The cone alone means silence; each wave is a step of loudness, so the icon
    // says roughly how loud it is before the scale beside it is even read.
    if (level > 0.02) svg.appendChild(wave('M14.6 10.2a3.4 3.4 0 0 1 0 3.6'));
    if (level > 0.34) svg.appendChild(wave('M16.9 8.4a6.6 6.6 0 0 1 0 7.2'));
    if (level > 0.67) svg.appendChild(wave('M19.2 6.6a9.8 9.8 0 0 1 0 10.8'));
  }
  return svg;
}

/**
 * Icons for browse rows that have no artwork — genres, composers, actions,
 * categories. Drawn here rather than imported: the CSP is `default-src 'none'`,
 * so an icon font or a CDN set is not reachable, and self-hosting a whole family
 * for eight glyphs is a lot of weight for very little. Drawing them also keeps
 * them on the same line as the transport controls, and raises no licence question.
 */
var BROWSE_ICONS = {
  dot:      'M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z',
  note:     'M9 18.2a2.4 2.4 0 1 0 2.4-2.4V6.4l7.2-1.6v8.6a2.4 2.4 0 1 0 2.4 2.4V3l-12 2.6z',
  person:   'M12 12.4a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8zm0 1.9c-3.5 0-7 1.8-7 4v1.4h14v-1.4c0-2.2-3.5-4-7-4z',
  tag:      'M11.6 3.5H20a.5.5 0 0 1 .5.5v8.4a1 1 0 0 1-.3.7l-7.4 7.4a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1 0-1.4l7.5-7.3a1 1 0 0 1 .7-.3zm5.4 3.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
  // A musical score, drawn rather than borrowed from U+1F3BC — that codepoint is an
  // EMOJI, so a browser substitutes a colour font and it arrives in full colour,
  // exactly as the pause button once did. Staff lines with a note sitting on them.
  score:    'M2.6 5.2h18.8v1.5H2.6zm0 3.6h18.8v1.5H2.6zm0 3.6h18.8v1.5H2.6zm0 3.6h18.8v1.5H2.6z'
            + 'M13.4 3.6v8.7a2.6 2.6 0 1 0 1.7 2.4V7.4l4.3-1v5.4a2.6 2.6 0 1 0 1.7 2.4V2.6z',
  list:     'M3.5 5.6h13v2h-13zm0 5.4h13v2h-13zm0 5.4h9v2h-9zM19 11l2.5 2-2.5 2z',
  radio:    'M12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM7.8 5.4a8.4 8.4 0 0 0 0 13.2l1.3-1.6a6.4 6.4 0 0 1 0-10zm8.4 0-1.3 1.6a6.4 6.4 0 0 1 0 10l1.3 1.6a8.4 8.4 0 0 0 0-13.2z',
  album:    'M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6zm0 11a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z',
  folder:   'M3.5 5.8h6l1.8 2.2H20.5v10H3.5z',
  playnow:  'M8 5.5v13l11-6.5z',
  addnext:  'M3.5 6.4h10v2h-10zm0 4.6h10v2h-10zm0 4.6h7v2h-7zM17.4 8.8h2v3.4h3.4v2h-3.4v3.4h-2v-3.4H14v-2h3.4z',
  queue:    'M3.5 5.6h13v2h-13zm0 4.6h13v2h-13zm0 4.6h8v2h-8zM17 12.4v7l5.4-3.5z',
  shuffle:  'M16.6 4.6 21 8l-4.4 3.4V9H14c-1 0-1.7.5-2.4 1.5l-.7 1-1.2-1.7.6-.9C11.3 7.4 12.5 6.6 14 6.6h2.6zM3 6.6h3.2c1.4 0 2.6.8 3.6 2.3l3.4 5c.7 1 1.4 1.5 2.4 1.5h2.2v-2.5L22 16l-4.2 3.4v-2.5h-2.2c-1.5 0-2.7-.8-3.7-2.3l-3.4-5c-.7-1-1.3-1.5-2.3-1.5H3z',
};

/**
 * A GENRE GETS ITS OWN INSTRUMENT (Peter, 08-26: "guitar for rock, sax for jazz").
 *
 * Matched on substrings, longest-first, because Roon's genre names are compound —
 * "Pop/Rock", "Jazz Vocal", "Adult Alternative Pop/Rock". Anything unmatched keeps
 * the musical score, so a library of unusual genres degrades to something sensible
 * rather than to blanks.
 */
var GENRE_ICONS = [
  ['jazz', 'mic-vocal'], ['blues', 'guitar'], ['classical', 'piano'], ['opera', 'theater'],
  ['metal', 'zap'], ['punk', 'zap'], ['rock', 'guitar'], ['pop', 'disc-3'],
  ['electronic', 'audio-lines'], ['dance', 'audio-lines'], ['techno', 'audio-lines'],
  ['hip hop', 'speaker'], ['hip-hop', 'speaker'], ['rap', 'speaker'],
  ['r&b', 'speaker'], ['soul', 'heart'], ['funk', 'drum'], ['reggae', 'sun'],
  ['country', 'guitar'], ['folk', 'guitar'], ['bluegrass', 'guitar'],
  ['gospel', 'church'], ['spiritual', 'church'], ['religious', 'church'],
  ['world', 'globe'], ['international', 'globe'], ['latin', 'globe'], ['african', 'globe'],
  ['vocal', 'mic-vocal'], ['soundtrack', 'clapperboard'], ['film', 'clapperboard'],
  ['stage', 'theater'], ['screen', 'clapperboard'], ['comedy', 'theater'],
  ['children', 'baby'], ['holiday', 'snowflake'], ['christmas', 'snowflake'],
  ['new age', 'sparkles'], ['ambient', 'wind'], ['easy listening', 'wind'],
  ['sea', 'ship'], ['shanty', 'ship'], ['fusion', 'flame'],
  ['spoken', 'mic-vocal'], ['audiobook', 'mic-vocal'],
  ['electronica', 'audio-lines'], ['house', 'audio-lines'],

  // The gaps found against Peter's own 56 genres, 08-26. Each is a real match
  // rather than a filler: "Score" is a film score, "Suite" and "Symphonic" are
  // written forms, "Norteño" is regional, "Karaoke" is a microphone and nothing
  // else. Only the genuinely unclassified ones fall through.
  ['alternative', 'guitar'], ['indie', 'guitar'], ['acoustic', 'guitar'],
  ['symphonic', 'music-4'], ['suite', 'file-music'], ['score', 'clapperboard'],
  ['ballad', 'heart'], ['karaoke', 'mic-vocal'], ['avant', 'venetian-mask'],
  ['norteño', 'globe'], ['norteno', 'globe'], ['tejano', 'globe'], ['mariachi', 'globe'],
  ['chamber', 'file-music'], ['choral', 'church'], ['sacred', 'church'],
  ['march', 'drum'], ['big band', 'mic-vocal'], ['swing', 'mic-vocal'],
  ['bossa', 'globe'], ['samba', 'globe'], ['salsa', 'globe'], ['tango', 'globe'],
  ['celtic', 'guitar'], ['americana', 'guitar'], ['singer', 'mic-vocal'],
  ['soundtrack', 'clapperboard'], ['musical', 'theater'], ['broadway', 'theater'],
  ['disco', 'disc-3'], ['lounge', 'wind'], ['chill', 'wind'], ['meditation', 'sparkles'],
  ['experimental', 'shapes'], ['noise', 'shapes'], ['minimal', 'shapes'],
];

function genreIcon(title) {
  var t = String(title || '').toLowerCase();
  var best = null;
  var bestLen = 0;
  for (var i = 0; i < GENRE_ICONS.length; i += 1) {
    var term = GENRE_ICONS[i][0];
    if (t.indexOf(term) >= 0 && term.length > bestLen) { best = GENRE_ICONS[i][1]; bestLen = term.length; }
  }
  return best;
}

/** The vendored Lucide set, fetched from OUR OWN origin at boot. */
var LUCIDE = {};
fetch('/assets/icons/lucide.json')
  .then(function (r) { return r.json(); })
  .then(function (data) { LUCIDE = data || {}; })
  .catch(function () { /* the drawn fallbacks still cover every row */ });

/**
 * A treble clef, stroked. Lucide has no clef, and this is the case where drawing
 * one is reasonable — a single distinctive shape rather than two dozen instruments.
 * Composers WRITE music, so a clef says something a portrait does not (Peter,
 * 08-26).
 */
var CLEF_PATH = 'M12.9 21.8c-1.9 0-3.2-1.2-3.2-2.8 0-1.3 1-2.3 2.3-2.3 1.1 0 1.9.8 1.9 1.8 0 .9-.6 1.5-1.4 1.5'
  + 'M13.5 2.6c-2.2 1.9-3.4 4.1-3.4 6.4 0 1.9.6 3.4 2 5.6 1.2 1.9 1.8 3.2 1.8 4.6'
  + 'M13.9 2.6c1.4 1 2.1 2.4 2.1 4 0 2.5-1.7 4.4-4.4 5.6-2.2 1-3.6 2.5-3.6 4.4 0 2 1.6 3.5 3.9 3.5'
  + '2.4 0 4.1-1.6 4.1-3.9 0-1.6-.9-2.9-2.4-3.5';

function drawnStroke(d) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph browse-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function browseIcon(name) {
  if (name === 'clef') return drawnStroke(CLEF_PATH);
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph browse-icon');
  svg.setAttribute('aria-hidden', 'true');

  // Lucide draws with strokes rather than fills, which is why its icons carry a
  // consistent weight; ours are filled paths. Both are accepted so the vendored
  // set and the hand-drawn fallbacks can sit in one list.
  if (Object.prototype.hasOwnProperty.call(LUCIDE, name)) {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = LUCIDE[name];
    return svg;
  }
  var d = BROWSE_ICONS[name];
  if (d === undefined) return null;
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

/** Which icon suits a row, from what Roon says it is and what it is called. */
function iconFor(item, hierarchy) {
  var title = String(item.title || '').toLowerCase();
  if (item.hint === 'action') {
    if (title.indexOf('play') === 0) return 'playnow';
    if (title.indexOf('add') === 0) return 'addnext';
    if (title.indexOf('queue') >= 0) return 'queue';
    if (title.indexOf('radio') >= 0) return 'shuffle';
    return 'playnow';
  }
  if (title.indexOf('play ') === 0) return 'playnow';
  if (hierarchy === 'genres') return genreIcon(item.title) || 'score';
  // A composer WRITES the music; a performer plays it. Different icons.
  if (hierarchy === 'composers') return 'clef';
  if (hierarchy === 'artists') return 'person';
  if (hierarchy === 'playlists') return 'list';
  if (hierarchy === 'internet_radio') return 'radio';
  if (hierarchy === 'albums') return 'album';
  // The Explore tree names its own categories.
  if (title.indexOf('genre') >= 0) return 'score';
  if (title.indexOf('composer') >= 0) return 'clef';
  if (title.indexOf('artist') >= 0) return 'person';
  if (title.indexOf('playlist') >= 0) return 'list';
  if (title.indexOf('radio') >= 0) return 'radio';
  if (title.indexOf('album') >= 0) return 'album';
  if (title.indexOf('track') >= 0 || /^\d+\./.test(String(item.title || ''))) return 'note';
  return item.hint === 'list' ? 'folder' : 'note';
}

function glyphCog() {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zm0 5.6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z'
    + 'M20.6 12c0-.5 0-1-.1-1.4l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.5-1.4L15.3 2.7h-4l-.4 2.6c-.9.3-1.7.8-2.5 1.4l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-1c.8.6 1.6 1.1 2.5 1.4l.4 2.6h4l.4-2.6c.9-.3 1.7-.8 2.5-1.4l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.4z');
  svg.appendChild(path);
  return svg;
}

var glyph = function (name) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var d = {
    prev: 'M7 6h2.2v12H7zm10 0v12l-8-6z',
    next: 'M17 6h-2.2v12H17zM7 6v12l8-6z',
    play: 'M8 5.5v13l11-6.5z',
    pause: 'M8 5.5h3.1v13H8zm5 0h3.1v13H13z',
    minus: 'M5.5 10.9h13v2.2h-13z',
    plus: 'M10.9 5.5h2.2v13h-2.2zM5.5 10.9h13v2.2h-13z',
    left: 'M15 5.5 8.5 12 15 18.5z',
    right: 'M9 5.5 15.5 12 9 18.5z',
  }[name];
  if (d === undefined) {
    /**
     * Shuffle and repeat are LINES, not solids: two crossing paths and a circuit
     * with arrowheads. Drawn here rather than vendored because the icon set we
     * carry has neither, and a face must never fetch anything at runtime.
     */
    var strokes = {
      shuffle: [
        'M3.6 7.5h2.7c1.8 0 2.9 1.2 3.9 2.8l2.2 3.4c1 1.6 2.1 2.8 3.9 2.8h3.2',
        'M3.6 16.5h2.7c1.8 0 2.9-1.2 3.9-2.8l2.2-3.4c1-1.6 2.1-2.8 3.9-2.8h3.2',
        'M18.2 5.6 20.6 7.5 18.2 9.4',
        'M18.2 14.6 20.6 16.5 18.2 18.4',
      ],
      repeat: [
        'M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14',
        'M16 13.8 18 16 20 13.8',
        'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10',
        'M4 10.2 6 8 8 10.2',
      ],
      /* A CHAIN, whole and broken. Two circles overlapping vs two circles apart
         read as the same small "oo" at 20px — the difference was the gap, which
         is exactly what vanishes at that size. A link is also already Peter's own
         word for a group: the fixed groups are named 🔗 Garden, 🔗 Downstairs. */
      group: [
        'M10.2 13.8a3.7 3.7 0 0 0 5.2 0l3.3-3.3a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4',
        'M13.8 10.2a3.7 3.7 0 0 0-5.2 0l-3.3 3.3a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4',
      ],
      ungroup: [
        'M14.5 9.5 16.8 7.2a3.6 3.6 0 1 1 5.1 5.1l-2.3 2.3',
        'M9.5 14.5 7.2 16.8a3.6 3.6 0 1 1-5.1-5.1l2.3-2.3',
      ],
      /* out of this room, into another */
      'send-to': [
        'M12.6 5.5H6.4A1.9 1.9 0 0 0 4.5 7.4v9.2a1.9 1.9 0 0 0 1.9 1.9h6.2',
        'M10.8 12h9.1',
        'M16.8 8.7 20.3 12l-3.5 3.3',
      ],
      /**
       * FADERS — three tracks at three different levels. It says "there is more
       * than one level behind this" without a word, which is what the disclosure
       * actually opens (Peter, 08-28: "rather than 'x rooms' can we find a
       * symbol that indicates multi volume controls").
       *
       * Not a speaker: a speaker is already the thing to its left, and repeating
       * it would say "volume" twice and "several" never.
       */
      faders: [
        'M6 5.2v13.6', 'M3.7 10.4h4.6',
        'M12 5.2v13.6', 'M9.7 14.6h4.6',
        'M18 5.2v13.6', 'M15.7 8.6h4.6',
      ],
      /**
       * ══ THE BROWSE MARKS ══════════════════════════════════════════════════
       * One for each way into the library. They sit BESIDE the words, never
       * instead of them — Peter's 08-26 rule is that an icon only replaces a
       * word when the meaning is evident, and "composers" is not a shape anyone
       * would guess. What they buy is RECOGNITION: at a glance across a room the
       * eye finds the disc or the clock long before it reads the label.
       *
       * All drawn here, as strokes in the same hand as shuffle and repeat, since
       * a face must never fetch anything at runtime — and never as emoji, which
       * a colour font would hijack (the pause button once arrived bright blue).
       */
      /* a compass: the needle points somewhere you have not been */
      explore: [
        'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 1 0 0-15.6',
        'M15.4 8.6 10.5 10.5 8.6 15.4 13.5 13.5z',
      ],
      /* a luggage tag — a genre is a label tied on, not a place */
      genres: [
        'M4.6 11.4V5.7a1.1 1.1 0 0 1 1.1-1.1h5.7l7.9 7.9a1.2 1.2 0 0 1 0 1.7l-5.6 5.6a1.2 1.2 0 0 1-1.7 0z',
        'M8.4 8.4a.35 .35 0 1 0 0 .7 .35 .35 0 1 0 0-.7',
      ],
      /* THE RECORD ITSELF, hole and all. It was a square round a circle first,
         which at 22px is the universal "picture" icon and said photograph, not
         album. The clock is the only other disc here and it has hands. */
      albums: [
        'M12 4.4a7.6 7.6 0 1 0 0 15.2 7.6 7.6 0 1 0 0-15.2',
        'M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2',
      ],
      /* whoever is singing it */
      artists: [
        'M12 4.7a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 1 0 0-6.8',
        'M5.6 19.4a6.4 6.4 0 0 1 12.8 0',
      ],
      /* a nib: whoever WROTE it, which is a different question */
      composers: [
        'M4.8 19.2l.8-3.2L16.1 5.5a1.9 1.9 0 0 1 2.7 2.7L8.3 18.7z',
        'M14.7 7.1l2.7 2.7',
      ],
      /* a list with the play mark at its foot — the lines stop short of it, or
         the triangle grows a tail and the whole thing reads as an arrow */
      playlists: [
        'M4.6 6.8h12', 'M4.6 11.2h12', 'M4.6 15.6h6.6',
        'M14 15.4v6l5-3z',
      ],
      /* something broadcasting: a point, and the air going out from it */
      radio: [
        'M12 10.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 1 0 0-2.2',
        'M9.1 9.1a4.1 4.1 0 0 0 0 5.8', 'M14.9 9.1a4.1 4.1 0 0 1 0 5.8',
        'M6.3 6.3a8.1 8.1 0 0 0 0 11.4', 'M17.7 6.3a8.1 8.1 0 0 1 0 11.4',
      ],
      /* A PANE DIVIDED — the shape these faces actually make, picture on one
         side and words on the other. It marks the face badge as a chooser
         rather than a caption. */
      layout: [
        'M4.6 5.8h14.8a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1V6.8a1 1 0 0 1 1-1z',
        'M10.4 5.8v12.4',
      ],
      /* a clock, because "recent" is a question about time */
      recent: [
        'M12 4.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 1 0 0-14.8',
        'M12 8.1V12.2l2.9 1.8',
      ],
      'repeat-one': [
        'M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14',
        'M16 13.8 18 16 20 13.8',
        'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10',
        'M4 10.2 6 8 8 10.2',
        'M11 11.2 12.6 10.2V14',
      ],
    }[name] || [];
    for (var i = 0; i < strokes.length; i += 1) {
      var line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', strokes[i]);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', '1.7');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(line);
    }
    return svg;
  }
  var path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
};

/* ---------- browse ----------
 * A list overlay driven by Roon's Browse tree, plus our own recent-plays ledger.
 * Shapes captured from a live Core on 2026-08-25 (docs/browse-shapes.md):
 * `browse` returns the list, `load` returns the items, and item keys are
 * session-scoped positions in a server-side stack — never cached.
 */
var browsePanel = null;
var browseUniform = false;
var browseCtx = null;      // { hierarchy, trail: [titles] }

function browseCall(body) {
  return fetch('/api/v1/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) { return r.json().catch(function () { return {}; }); });
}

/**
 * The panel closes itself when nobody is using it (Peter, 08-25: "the window needs
 * to disappear after no activity rather than needing to be x'd out"). A browse
 * list left open on a wall is a screen showing the wrong thing.
 *
 * Generously timed and reset by ANY sign of life — a press, a scroll, a pointer
 * crossing it — because reading a list of two thousand albums is legitimate use
 * and being dismissed mid-read is worse than never closing at all.
 */
var BROWSE_IDLE_MS = 45000;
var browseIdleTimer = null;

function browseAlive() {
  if (browseIdleTimer !== null) clearTimeout(browseIdleTimer);
  if (browsePanel === null) return;
  browseIdleTimer = setTimeout(function () { closeBrowse(); }, BROWSE_IDLE_MS);
}

function closeBrowse() {
  if (browseIdleTimer !== null) { clearTimeout(browseIdleTimer); browseIdleTimer = null; }
  if (browsePanel !== null) { browsePanel.parentNode.removeChild(browsePanel); browsePanel = null; }
  browseCtx = null;
}

function browseShell(title, canGoBack) {
  /**
   * ⚖️ THE BROWSE CASCADE IS A WINDOW ON THE COLUMN (Peter, 08-28: "the browse
   * menu cascades with sliders and the volume controls take the same real estate
   * that overlays the controls and metadata we have now created, landing exactly
   * on top as a new window").
   *
   * On a face that carries its chrome in the layout, the words and the two rows
   * of controls already occupy a rectangle beside the artwork. That rectangle is
   * where the answer to "what shall I play instead" belongs — landing on the
   * question rather than floating over the middle of the screen and covering the
   * artwork with it. Everywhere else it stays the centred panel it was.
   */
  var host = hasShelf() ? copy : document.body;
  if (browsePanel === null) {
    browsePanel = el('div', 'browse');
    host.appendChild(browsePanel);
    // Any sign of life resets the clock, including simply scrolling a long list.
    ['pointermove', 'mousemove', 'scroll', 'click', 'touchstart', 'wheel', 'keydown']
      .forEach(function (kind) { browsePanel.addEventListener(kind, browseAlive, true); });
  } else if (browsePanel.parentNode !== host) {
    host.appendChild(browsePanel);        // the face changed under an open panel
  }
  var head = el('div', 'browse-head');
  var back = el('span', canGoBack ? 'ctl small' : 'ctl small off');
  back.appendChild(glyph('left'));
  back.setAttribute('aria-label', 'back');
  if (canGoBack) pressable(back, browseBack);
  head.appendChild(back);
  head.appendChild(el('span', 'browse-title', title));
  var shut = el('span', 'ctl small', '\u2715');
  pressable(shut, closeBrowse);
  head.appendChild(shut);
  var list = el('div', 'browse-list', 'loading\u2026');
  // The list and the alphabet rail share a row INSIDE the column panel. Making the
  // panel itself a row removed the list's height constraint, so it grew to its
  // content and pushed the rail thousands of pixels off screen.
  var body = el('div', 'browse-body');
  body.appendChild(list);
  browsePanel.replaceChildren(head, body);
  browseAlive();
  return list;
}

function browseRow(item, onPick) {
  var row = el('div', 'browse-row');
  var thumbBox = el('span', 'browse-thumb');
  if (item.art) {
    var img = document.createElement('img');
    img.alt = '';
    img.src = item.art;
    thumbBox.appendChild(img);
  } else {
    thumbBox.className = 'browse-thumb is-empty';
    // The uniform-list dot is gone: a list of genres carrying the SAME icon is fine
    // once that icon is a good one. Peter chose a musical score, which answers
    // "they all look the same" by making the sameness worth looking at.
    var icon = browseIcon(iconFor(item, browseCtx === null ? '' : browseCtx.hierarchy));
    if (icon !== null) thumbBox.appendChild(icon);
  }
  row.appendChild(thumbBox);
  row.appendChild(el('span', 'browse-name', item.title || '(untitled)'));
  if (item.subtitle) row.appendChild(el('span', 'browse-sub', item.subtitle));
  pressable(row, function () { onPick(item); });
  return row;
}

/**
 * An icon earns its place by DISTINGUISHING rows. In a list of genres every row is
 * a genre, so a wall of identical tags is decoration — and read as such (Peter,
 * 08-26: "all icons appear the same... a simple filled circle would be good").
 *
 * So: distinct icons where the list is mixed (Explore, an album's actions and
 * tracks), and a quiet dot where they would all be the same.
 */
function uniformIcon(items, hierarchy) {
  if (items.length < 2) return false;
  var first = iconFor(items[0], hierarchy);
  for (var i = 1; i < items.length; i += 1) {
    if (iconFor(items[i], hierarchy) !== first) return false;
  }
  return true;
}

function browseRows(list, items, onPick) {
  if (items.length === 0) { list.replaceChildren(el('div', 'browse-empty', 'nothing here')); return; }
  browseUniform = uniformIcon(items, browseCtx === null ? '' : browseCtx.hierarchy);
  // One row builder for both the first page and every page after it, so an icon
  // never appears on one and not the other.
  var rows = items.map(function (item) { return browseRow(item, onPick); });
  list.replaceChildren.apply(list, rows);
}

/**
 * Draw whatever level the Core is currently on.
 *
 * Roon keeps the browse stack SERVER-side, so the client holds only a trail of
 * titles for the heading — it never replays calls. Re-running an earlier call was
 * the first attempt and it could not work: item keys are session-scoped positions
 * in that same stack, so a remembered key means something different once the
 * stack has moved. Back is `pop_levels`, which is Roon's own mechanism.
 */
/**
 * PAGING. Roon reports the list's true size and `load` takes an offset, but the
 * client asked for one page of 200 and stopped — so 2095 of Peter's 2295 albums,
 * and 6095 of his 6295 composers, simply did not exist as far as the screen was
 * concerned. A library browser that silently shows the first 8% is worse than one
 * that admits it cannot page.
 *
 * Pages arrive as the list is scrolled, and the heading carries the real total so
 * the size of the thing is never a mystery.
 */
var PAGE = 100;
var browsePaging = false;

function browseAttachPaging(list, hierarchy, total, onPick, startOffset) {
  // After an alphabet jump the rows on screen begin partway down the list, so
  // paging continues from THERE rather than from the count of visible rows.
  var loaded = typeof startOffset === 'number'
    ? startOffset : list.querySelectorAll('.browse-row').length;
  var more = function () {
    if (browsePaging || loaded >= total) return;
    browsePaging = true;
    var marker = el('div', 'browse-empty', 'loading\u2026');
    list.appendChild(marker);
    browseCall({ hierarchy: hierarchy, load: true, count: PAGE, offset: loaded, sessionKey: 'flightdeck-face' })
      .then(function (data) {
        if (marker.parentNode === list) list.removeChild(marker);
        var items = data.items || [];
        for (var i = 0; i < items.length; i += 1) list.appendChild(browseRow(items[i], onPick));
        loaded += items.length;
        browsePaging = false;
        browseAlive();
        // A short page means the list is exhausted whatever the count claimed.
        if (items.length === 0) loaded = total;
      })
      .catch(function () {
        if (marker.parentNode === list) list.removeChild(marker);
        browsePaging = false;
      });
  };
  list.addEventListener('scroll', function () {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 400) more();
  });
  // A tall screen can show the first page without ever scrolling.
  if (list.scrollHeight <= list.clientHeight + 40) more();
}

/**
 * THE ALPHABET RAIL.
 *
 * 2295 albums and 6295 composers cannot be reached by scrolling. The lists are
 * alphabetical and `load` takes an offset, so a letter is found by BINARY SEARCH
 * over the offsets — about a dozen single-item probes instead of paging through
 * thousands of rows.
 */
var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function firstLetter(title) {
  var t = String(title || '').toUpperCase();
  // Roon sorts "The Beatles" under B, and numbers ahead of letters.
  t = t.replace(/^(THE|A|AN)\s+/, '');
  var c = t.charAt(0);
  return (c >= 'A' && c <= 'Z') ? c : '#';
}

function probeTitle(hierarchy, offset) {
  return browseCall({ hierarchy: hierarchy, load: true, count: 1, offset: offset, sessionKey: 'flightdeck-face' })
    .then(function (data) {
      var items = data.items || [];
      return items.length > 0 ? items[0].title : null;
    });
}

/** The offset of the first item at or after `letter`, by bisection. */
function findLetter(hierarchy, letter, total, done) {
  var low = 0;
  var high = Math.max(0, total - 1);
  var best = null;
  var steps = 0;
  var step = function () {
    if (low > high || steps > 14) { done(best); return; }
    steps += 1;
    var mid = Math.floor((low + high) / 2);
    probeTitle(hierarchy, mid).then(function (title) {
      if (title === null) { high = mid - 1; step(); return; }
      if (firstLetter(title) >= letter) { best = mid; high = mid - 1; }
      else { low = mid + 1; }
      step();
    }).catch(function () { done(best); });
  };
  step();
}

function alphabetRail(hierarchy, total, onPick) {
  var rail = el('div', 'alpha');
  var letters = ['#'].concat(LETTERS);
  for (var i = 0; i < letters.length; i += 1) {
    (function (letter) {
      var node = el('span', 'alpha-key', letter);
      pressable(node, function () { onPick(letter); });
      rail.appendChild(node);
    })(letters[i]);
  }
  return rail;
}

function browseDraw(result) {
  var hierarchy = browseCtx.hierarchy;
  var listInfo = result.list || {};
  var heading = listInfo.title || browseCtx.trail[browseCtx.trail.length - 1] || 'Browse';
  var zone = currentZone();
  if (listInfo.hint === 'action_list' && zone !== null) heading += '  \u2192  ' + zone.name;
  var total = typeof listInfo.count === 'number' ? listInfo.count : 0;
  if (total > PAGE) heading += '   ' + total;
  var list = browseShell(heading, browseCtx.trail.length > 1);
  var pick = function (item) { browseInto(item); };
  // Only where it helps: a long list, and one Roon sorts alphabetically.
  var alphabetical = total > 150 && listInfo.hint !== 'action_list';
  if (alphabetical) {
    browsePanel.className = 'browse has-alpha';
    var body = browsePanel.querySelector('.browse-body');
    body.appendChild(alphabetRail(hierarchy, total, function (letter) {
      list.replaceChildren(el('div', 'browse-empty', 'finding \u2026'));
      findLetter(hierarchy, letter, total, function (offset) {
        if (offset === null) { list.replaceChildren(el('div', 'browse-empty', 'nothing under ' + letter)); return; }
        browseCall({ hierarchy: hierarchy, load: true, count: PAGE, offset: offset, sessionKey: 'flightdeck-face' })
          .then(function (data) {
            browseRows(list, data.items || [], pick);
            list.scrollTop = 0;
            if (total > offset + (data.items || []).length) {
              browseAttachPaging(list, hierarchy, total, pick, offset + (data.items || []).length);
            }
          });
      });
    }));
  } else {
    browsePanel.className = 'browse';
  }
  browseCall({ hierarchy: hierarchy, load: true, count: PAGE, sessionKey: 'flightdeck-face' })
    .then(function (data) {
      browseRows(list, data.items || [], pick);
      if (total > (data.items || []).length) browseAttachPaging(list, hierarchy, total, pick);
    })
    .catch(function () { list.replaceChildren(el('div', 'browse-empty', 'could not load that')); });
}

function openHierarchy(hierarchy, title) {
  browseCtx = { hierarchy: hierarchy, trail: [title] };
  browseShell(title, false);
  browseCall({ hierarchy: hierarchy, popAll: true, sessionKey: 'flightdeck-face' })
    .then(function (result) { browseDraw(result); })
    .catch(function () { closeBrowse(); flash('browse unavailable'); });
}

function browseInto(item) {
  if (browseCtx === null) return;
  var zone = currentZone();
  var call = { hierarchy: browseCtx.hierarchy, itemKey: item.itemKey, sessionKey: 'flightdeck-face' };
  if (zone !== null) call.zoneId = zone.id;
  browseCall(call).then(function (result) {
    // An `action` item has already done its thing — there is no list coming.
    if (result.action === 'none' || result.action === 'message') {
      flash(result.message || (item.title + ' \u2713'));
      closeBrowse();
      return;
    }
    browseCtx.trail.push(item.title || 'Browse');
    browseDraw(result);
  }).catch(function () { flash('could not open that'); });
}

function browseBack() {
  if (browseCtx === null || browseCtx.trail.length <= 1) { closeBrowse(); return; }
  browseCtx.trail.pop();
  browseCall({ hierarchy: browseCtx.hierarchy, popLevels: 1, sessionKey: 'flightdeck-face' })
    .then(function (result) { browseDraw(result); })
    .catch(function () { closeBrowse(); });
}

/** Recently played needs no Browse at all: FlightDeck keeps its own ledger. */
function openRecent() {
  browseCtx = null;
  var list = browseShell('Recently played', false);
  fetch('/api/v1/recent').then(function (r) { return r.json(); }).then(function (data) {
    var tracks = (data.tracks || []).map(function (t) {
      return { title: t.title, subtitle: t.zoneName + ' \u00B7 ' + new Date(t.at).toTimeString().slice(0, 5) };
    });
    browseRows(list, tracks, function () { flash('recently played is a record, not a queue'); });
  }).catch(function () { list.replaceChildren(el('div', 'browse-empty', 'no history yet')); });
}

/* ---------- transport ----------
 * Every gesture is a USER ACTION translated into a ROON-LED instruction: the
 * button posts to FlightDeck, FlightDeck asks the Core, and the new state arrives
 * on the ordinary zone subscription. Nothing is applied optimistically, so the
 * screen can never show a state the Core does not agree with.
 *
 * Volume acts on the BOUND OUTPUT only — the speaker in this room — so a screen
 * in the study cannot turn up a whole grouped house.
 */
/**
 * ⚖️ REGROUPING IS A KNOWN GAP, NOT A FAULT.
 *
 * Roon destroys the zone and builds a new one, and for a beat in between this
 * room is in no zone at all. That is not "unavailable" — it is a change we
 * asked for, and the screen should hold what it was showing until the new zone
 * arrives rather than announcing a failure to somebody who just pressed group.
 */
var settlingUntil = 0;
var REGROUP_GRACE_MS = 9000;

function command(body) {
  if (body.action === 'group' || body.action === 'ungroup' || body.action === 'regroup') {
    settlingUntil = Date.now() + REGROUP_GRACE_MS;
  }
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

function flash(message) {
  artistName.textContent = message;
  artistName.hidden = false;
  setTimeout(function () { if (artistName.textContent === message) artistName.hidden = true; }, 2600);
}

function transport(action) {
  var zone = currentZone();
  if (zone === null) return;
  if (action === 'next' && !zone.allowed.next) { flash('next is not available here'); return; }
  if (action === 'previous' && !zone.allowed.previous) { flash('previous is not available here'); return; }
  command({ action: action, zone: zone.id });
}

/** The output this screen belongs to, falling back to the zone's first output. */
function volumeOutput() {
  var zone = currentZone();
  if (zone === null) return null;
  if (boundOutputId !== null) {
    for (var i = 0; i < zone.outputs.length; i += 1) {
      if (zone.outputs[i].id === boundOutputId) return zone.outputs[i];
    }
  }
  return zone.outputs.length === 1 ? zone.outputs[0] : null;
}

/**
 * The master scale. Same 44-segment motif as a room's own, so the eye reads it
 * as loudness without a label — but it sends the GROUP verb, and the server
 * computes each room's new level from the offsets it already has.
 */
function groupScale(zone, level) {
  var node = el('span', 'vol-scale group');
  node.setAttribute('title', 'volume \u00B7 ' + zone.name + ' (all rooms)');
  node.setAttribute('aria-label', 'group volume for ' + zone.name);
  // the segments have to exist before they can be painted
  for (var i = 0; i < SEGMENTS; i += 1) node.appendChild(el('b'));
  paintScale(node, level, false);
  var last = 0;
  var setFrom = function (clientX) {
    var box = node.getBoundingClientRect();
    if (box.width <= 0) return;
    var now = Date.now();
    if (now - last < 250) return;
    last = now;
    var want = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    paintScale(node, want, false);                // answer the press at once
    command({ action: 'group-volume', zone: zone.id, level: want });
  };
  var press = function (event) {
    if (panelJustAppeared()) return;
    var x = typeof event.clientX === 'number' ? event.clientX
      : (event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : null);
    if (x === null) return;
    setFrom(x);
    event.preventDefault(); event.stopPropagation();
  };
  node.addEventListener('pointerup', press);
  node.addEventListener('click', press);
  return node;
}

/** The room count, and behind it every room's own scale. */
/**
 * ⚖️ Whether the rooms' own levels are showing. Module-level, not a closure
 * variable, because `renderShelf` rebuilds this control on every structural
 * frame — and changing a room's volume IS a structural frame. So the disclosure
 * destroyed itself the instant anybody used it (Peter, 08-28: "multi output
 * volume controls disappear on trying to use them once they open").
 */
var memberVolsOpen = false;
/**
 * The rooms' window, once it hangs off the column rather than off the row that
 * opened it. Press routing has to be able to name it: a press inside it was
 * landing in `.copy`, and `.copy` means "browse", so touching a room's level
 * raised the old browse strip (Peter, 08-28: "clicking on volume brings up the
 * old browse options").
 */
var memberVols = null;
var memberVolsButton = null;
var memberVolsTimer = null;

/**
 * ⚖️ A WINDOW YOU CAN GET OUT OF (Peter, 08-28: "I need to click / time out of
 * volume controls"). It covers the words and the controls while it is up, so
 * there has to be a way back that does not require finding the one small button
 * that opened it: a press anywhere outside closes it, and so does leaving it
 * alone. Touching anything inside puts the clock back to the start.
 */
var MEMBER_VOLS_MS = 12000;

function closeMemberVols() {
  memberVolsOpen = false;
  if (memberVolsTimer !== null) { clearTimeout(memberVolsTimer); memberVolsTimer = null; }
  if (memberVols !== null) memberVols.hidden = true;
  if (memberVolsButton !== null) memberVolsButton.className = 'ctl ctl-faders';
}

function keepMemberVols() {
  if (!memberVolsOpen) return;
  if (memberVolsTimer !== null) clearTimeout(memberVolsTimer);
  memberVolsTimer = setTimeout(closeMemberVols, MEMBER_VOLS_MS);
}

function roomsToggle(zone, outs) {
  var wrap = el('span', 'rooms-toggle');
  var b = el('span', 'ctl ctl-faders');
  b.appendChild(glyph('faders'));
  b.setAttribute('title', 'a level for each of the ' + String(outs.length) + ' rooms');
  b.setAttribute('aria-label', 'show the volume of each of the ' + String(outs.length) + ' rooms');
  var list = el('div', 'member-vols');
  list.hidden = !memberVolsOpen;
  /**
   * ⚖️ A WINDOW HAS A CLOSE (Peter, 08-28: "we need an exit from the volume
   * control window — just an x at top right to simulate closing a window").
   * A press outside works and so does leaving it, but neither is VISIBLE, and a
   * panel covering the whole column should say how to get out of it.
   */
  var shut = el('span', 'member-shut', '\u00D7');
  shut.setAttribute('title', 'close');
  shut.setAttribute('aria-label', 'close the room levels');
  pressable(shut, closeMemberVols);
  list.appendChild(shut);
  /**
   * ⚖️ THE SCALE SAYS WHERE ITS ENDS ARE, and each room says where it is on it
   * (Peter, 08-28: "could even show a 0 / 100 at the top of the controls and
   * there's room for indicating the actual numeric number on the slider or at
   * the end").
   *
   * The ends are the DEVICE'S OWN, not a guessed 0–100: Roon reports min and max
   * per output and they are not always a percentage — a preamp on a dB scale
   * runs −80 to 0, and printing "0 / 100" over that would be a lie. When the
   * rooms disagree about their range there is no honest shared header, so it
   * says nothing and lets each row's own number do the talking.
   */
  var lo = null, hi = null, agree = true;
  for (var r = 0; r < outs.length; r += 1) {
    var rv = outs[r].volume;
    var rlo = rv.min === null ? 0 : rv.min;
    if (lo === null) { lo = rlo; hi = rv.max; }
    else if (lo !== rlo || hi !== rv.max) agree = false;
  }
  if (agree && lo !== null) {
    var head = el('div', 'member-vol member-head');
    head.appendChild(el('span', 'member-headpad'));
    head.appendChild(el('span', 'member-name'));
    var ends = el('span', 'member-ends');
    ends.appendChild(el('span', 'member-end', String(lo)));
    ends.appendChild(el('span', 'member-end', String(hi)));
    head.appendChild(ends);
    head.appendChild(el('span', 'member-read'));
    list.appendChild(head);
  }
  for (var i = 0; i < outs.length; i += 1) {
    (function (o) {
      var row = el('div', 'member-vol');
      var v = o.volume;
      var mn = v.min === null ? 0 : v.min;
      var sp = Math.max(1, v.max - mn);
      var lvl = Math.max(0, Math.min(1, (v.value - mn) / sp));
      row.appendChild(volumeSpeaker(o, v.muted ? 0 : lvl));
      row.appendChild(el('span', 'member-name', o.name));
      row.appendChild(volumeScale(o, lvl, mn, sp));
      // Muted is a state the number cannot show: 66 and silent is not 66.
      // The number in a disc (Peter, 08-28). Muted is the SPEAKER's job to say —
      // it is crossed through at the other end of the row — so the disc keeps
      // showing the level the room will return to, and only changes colour.
      var read = el('span', v.muted ? 'member-read is-muted' : 'member-read', String(v.value));
      if (v.muted) read.setAttribute('title', o.name + ' is muted at ' + String(v.value));
      row.appendChild(read);
      list.appendChild(row);
    })(outs[i]);
  }
  if (memberVolsOpen) b.className = 'ctl ctl-faders now';
  pressable(b, function () {
    if (memberVolsOpen) { closeMemberVols(); return; }
    memberVolsOpen = true;
    list.hidden = false;
    b.className = 'ctl ctl-faders now';
    keepMemberVols();
  });
  wrap.appendChild(b);
  /**
   * ⚖️ THE WINDOW HANGS OFF THE COLUMN, not off the row that opens it. The
   * volume shelf is itself absolutely positioned against `.copy`, so a panel
   * inside it resolves to the SHELF — 65px tall — and the rooms were clipped
   * into a slot instead of filling the column Peter asked them to land on.
   */
  (hasShelf() ? copy : wrap).appendChild(list);
  memberVols = list;
  memberVolsButton = b;
  // Any sign of life resets the clock, including simply moving over it.
  ['pointermove', 'mousemove', 'click', 'pointerup', 'touchstart', 'wheel']
    .forEach(function (kind) { list.addEventListener(kind, keepMemberVols, true); });
  // Only if nothing is already counting: the shelf repaints on every structural
  // frame, and re-arming there meant the clock was reset forever and the window
  // never timed out at all.
  if (memberVolsOpen && memberVolsTimer === null) keepMemberVols();
  return wrap;
}

function nudgeVolume(steps) {
  var output = volumeOutput();
  if (output === null) { flash('this screen is not bound to one speaker'); return; }
  if (!output.volume) { flash(output.name + ' has no volume control'); return; }
  command({ action: 'volume', output: output.id, steps: steps });
}

/**
 * POINTER PROBE (?keys=1). The key probe settled which keys a television sends;
 * this settles the same question for a pointer remote, which is a different
 * device pretending to be a mouse. Reports what actually fires and on what.
 */
function startPointerProbe() {
  var counts = {};
  var note = function (kind, target) {
    // An SVG element's className is an SVGAnimatedString, which stringifies to
    // "[object ...]" — useless in a probe someone has to read.
    var cls = '';
    if (target && typeof target.className === 'string') cls = target.className.split(' ')[0];
    else if (target && target.getAttribute) cls = target.getAttribute('class') || '';
    var where = cls !== '' ? cls.split(' ')[0] : (target ? String(target.nodeName).toLowerCase() : '?');
    var label = kind + ' on .' + where;
    counts[label] = (counts[label] || 0) + 1;
    if (counts[label] > 3 && kind === 'mousemove') return;   // movement is noisy; a few is enough
    reportPointer(label, counts[label]);
  };
  ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'mousemove']
    .forEach(function (kind) {
      document.addEventListener(kind, function (event) { note(kind, event.target); }, true);
    });
}

function reportPointer(label, count) {
  if (keyLog === null) return;
  keySeen.unshift({ key: label, code: count, acted: 'pointer' });
  if (keySeen.length > 12) keySeen.length = 12;
  drawKeyLog();
  try {
    fetch('/api/v1/keyprobe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: label, code: count, acted: 'POINTER' }),
    }).catch(function () { /* the panel still shows it */ });
  } catch (error) { /* older engine */ }
}

/**
 * SEEK BY PRESSING THE PROGRESS.
 *
 * The runway, the bar and the leader all mean the same thing — where you are in
 * the track — so pressing one anywhere means "go there". Roon says whether the
 * zone can seek at all (a live stream cannot), and the refusal is shown rather
 * than swallowed.
 */
/**
 * ⚖️ SEEKING ON THE RING (Peter, 08-28: "no bottom progress bar on this, so seek
 * should be done by touching the progress circle").
 *
 * The ring IS the track, so a press on it means "go there" — the same sentence
 * the progress bar speaks, in polar. Twelve o'clock is zero and it runs
 * clockwise, which is where the arc already starts and which way the bead
 * already travels; nobody has to be told.
 *
 * ONLY THE BAND, never the middle: the sleeve sits over the centre and a press
 * there is a press on the artwork, which opens the music. The SVG is behind the
 * image, so the middle never reaches this at all — but a press in the four
 * corners between the circle and the square does, and that is not the ring
 * either, so the radius is checked.
 */
function seekFromRing(clientX, clientY) {
  var zone = currentZone();
  if (zone === null || zone.nowPlaying === null) return false;
  var box = dial.getBoundingClientRect();
  if (box.width <= 0) return false;
  var cx = box.left + box.width / 2;
  var cy = box.top + box.height / 2;
  // The hit circle's stroke already IS the band; this only rejects a press that
  // reached here some other way, such as a synthetic event aimed at the middle.
  var radius = Math.sqrt(Math.pow(clientX - cx, 2) + Math.pow(clientY - cy, 2)) / (box.width / 2);
  if (radius < 0.62 || radius > 1.14) return false;
  if (!zone.allowed.seek) { flash('this cannot be scrubbed'); return true; }
  var length = zone.nowPlaying.lengthSec;
  if (!length) { flash('no track length to seek within'); return true; }
  // atan2 measures from three o'clock; the ring starts at twelve.
  var angle = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;
  var fraction = Math.max(0, Math.min(1, angle / (Math.PI * 2)));
  command({ action: 'seek', zone: zone.id, seconds: Math.round(fraction * length) });
  return true;
}

function seekFromPress(clientX) {
  var zone = currentZone();
  if (zone === null || zone.nowPlaying === null) return;
  if (!zone.allowed.seek) { flash('this cannot be scrubbed'); return; }
  var length = zone.nowPlaying.lengthSec;
  if (!length) { flash('no track length to seek within'); return; }
  var box = foot.getBoundingClientRect();
  if (box.width <= 0) return;
  var fraction = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
  command({ action: 'seek', zone: zone.id, seconds: Math.round(fraction * length) });
}

/**
 * The volume widgets, kept so they can be REPAINTED.
 *
 * They were built once when the panel opened and never touched again, so turning
 * the volume up worked but the scale sat still and the mute button never lit
 * (Peter, 08-26: "they work but not reflected on screen"). The level arrives on
 * the ordinary zone subscription like everything else; it just had nothing
 * listening for it.
 */
var volUi = null;

function paintVolume() {
  if (volUi === null || picker.hidden) return;
  var output = volumeOutput();
  var vol = output === null ? null : output.volume;
  if (vol === null || output.id !== volUi.outputId) return;

  var muted = !!vol.muted;
  var min0 = vol.min === null ? 0 : vol.min;
  var span0 = Math.max(1, (vol.max === null ? 100 : vol.max) - min0);
  var level0 = vol.value === null ? 0.5 : Math.max(0, Math.min(1, (vol.value - min0) / span0));
  if (volUi.speaker !== null) {
    var want = muted ? 'ctl vol-speaker is-muted' : 'ctl vol-speaker';
    if (volUi.speaker.className !== want) volUi.speaker.className = want;
    // Swap the SYMBOL, not just the colour: repainting only the class left a
    // crossed speaker sitting there after unmuting (Peter, 08-26).
    var shownMuted = volUi.speaker.getAttribute('data-muted') === '1';
    var shownLevel = volUi.speaker.getAttribute('data-level');
    var levelKey = String(Math.round(level0 * 3));
    if (shownMuted !== muted || shownLevel !== levelKey) {
      volUi.speaker.setAttribute('data-muted', muted ? '1' : '0');
      volUi.speaker.setAttribute('data-level', levelKey);
      volUi.speaker.replaceChildren(glyphSpeaker(level0, muted));
      var label = (muted ? 'unmute \u00B7 ' : 'mute \u00B7 ') + output.name;
      volUi.speaker.setAttribute('aria-label', label);
      volUi.speaker.setAttribute('title', label);
    }
  }
  if (volUi.scale !== null && vol.value !== null && vol.max !== null) {
    paintScale(volUi.scale, level0, muted);
    volUi.scale.setAttribute('title', 'volume ' + Math.round(level0 * 100) + '%  \u00B7  ' + output.name);
  }
}

/** The speaker doubles as the mute control, and shows roughly how loud it is. */
/** An output as it is RIGHT NOW, anywhere in the house — it may have been regrouped. */
function outputById(id) {
  var snap = store.snapshot();
  if (snap === null) return null;
  for (var i = 0; i < snap.zones.length; i += 1) {
    var outs = snap.zones[i].outputs;
    for (var j = 0; j < outs.length; j += 1) if (outs[j].id === id) return outs[j];
  }
  return null;
}

/**
 * `governs` names every output this speaker speaks for. A room's own speaker
 * governs itself; a GROUP's master governs all of them, because muting a group
 * from its master and having one room keep playing is not muting the group.
 */
function volumeSpeaker(output, level, governs) {
  var muted = !!(output.volume && output.volume.muted);
  var node = el('span', muted ? 'ctl vol-speaker is-muted' : 'ctl vol-speaker');
  // The glyph SAYS THE STATE: crossed when muted, sounding when not. What keeps it
  // from reading as a third volume control is its own filled frame, not its shape —
  // an always-crossed icon told you what the button does but never what it had done.
  node.appendChild(glyphSpeaker(level, muted));
  node.setAttribute('aria-label', muted ? 'unmute ' + output.name : 'mute ' + output.name);
  node.setAttribute('title', node.getAttribute('aria-label'));
  pressable(node, function () {
    /**
     * ⚖️ READ THE STATE OF THE OUTPUT THIS BUTTON IS FOR (Peter, 08-28: "unmute
     * is not working").
     *
     * It read `volumeOutput()` instead, which returns NULL the moment a zone has
     * more than one output — so on any group, and on every room row inside the
     * volume disclosure, `isMuted` was false whatever the truth was and the
     * button sent `mute: true` forever. A fix for exactly this bug was written
     * once already, at build time vs press time; it moved the read to press time
     * but read the WRONG OUTPUT, so the latch survived on grouped zones. That is
     * why it looked fixed on a solo room and never worked in the Study.
     */
    var ids = [];
    if (governs === undefined || governs.length === 0) ids.push(output.id);
    else for (var g = 0; g < governs.length; g += 1) ids.push(governs[g].id);
    // Muted only when they ALL are: one room still sounding means the group is
    // not muted, and the press should silence it rather than un-silence the rest.
    var allMuted = true;
    for (var i = 0; i < ids.length; i += 1) {
      var live = outputById(ids[i]);
      if (!(live && live.volume && live.volume.muted)) allMuted = false;
    }
    /**
     * ONE AT A TIME. Fired in the same tick, two mutes against the same zone
     * lost one of them: measured 08-28 on the silent pair — the group's LEAD
     * stayed sounding while the member muted, and each of them muted correctly
     * when sent on its own. So they are chained.
     */
    var wanted = !allMuted;
    var sendOne = function (at) {
      if (at >= ids.length) return;
      command({ action: 'mute', output: ids[at], muted: wanted })
        .then(function () { sendOne(at + 1); });
    };
    sendOne(0);
  });
  return node;
}

/** The ends of the scale: a quiet speaker and a loud one, which step the level. */
function volumeStep(output, direction) {
  var node = el('span', 'ctl vol-step');
  node.appendChild(glyphSpeaker(direction === 'up' ? 1 : 0.2, false));
  var label = (direction === 'up' ? 'louder \u00B7 ' : 'quieter \u00B7 ') + output.name;
  node.setAttribute('aria-label', label);
  node.setAttribute('title', label);
  pressable(node, function () { nudgeVolume(direction === 'up' ? 1 : -1); });
  return node;
}

/** A pressable level, segmented like the runway. */
var SEGMENTS = 44;

/**
 * Paint a level onto the segments.
 *
 * The lit run is the whole segments, and the ONE at the boundary carries the
 * remainder as partial brightness. Without that a single step of 1 in 100 rarely
 * crossed a segment edge, so the scale sat still for two or three presses and the
 * control felt broken (Peter, 08-26).
 */
function paintScale(scale, level, muted) {
  var segs = scale.childNodes;
  var exact = level * segs.length;
  var whole = Math.floor(exact);
  var part = exact - whole;
  for (var i = 0; i < segs.length; i += 1) {
    var cls = '';
    var alpha = '';
    if (!muted) {
      if (i < whole) cls = 'on';
      else if (i === whole && part > 0.04) { cls = 'on'; alpha = String(0.25 + part * 0.75); }
    }
    if (segs[i].className !== cls) segs[i].className = cls;
    if (segs[i].style.opacity !== alpha) segs[i].style.opacity = alpha;
  }
}

function volumeScale(output, level, min, span) {
  var scale = el('span', 'vol-scale');
  scale.setAttribute('aria-label', 'volume \u00B7 ' + output.name);
  scale.setAttribute('title', 'volume ' + Math.round(level * 100) + '%  \u00B7  ' + output.name);
  for (var i = 0; i < SEGMENTS; i += 1) scale.appendChild(el('b'));
  paintScale(scale, level, !!(output.volume && output.volume.muted));
  var setFrom = function (clientX) {
    var box = scale.getBoundingClientRect();
    if (box.width <= 0) return;
    var fraction = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    command({ action: 'volume', output: output.id, value: Math.round(min + fraction * span) });
  };
  /**
   * ⚖️ PRESS TO POSITION, NEVER DRAG (Peter, 08-28: "don't allow drag on volume
   * — click on the scale or touch only"). Drag used to be offered here as a
   * bonus; it is gone, so the Wall and the Face share one grammar and a
   * horizontal movement anywhere is unambiguously something else.
   */
  scale.addEventListener('pointerup', function (event) {
    if (panelJustAppeared()) return;
    setFrom(event.clientX); event.preventDefault(); event.stopPropagation();
  });
  // Devices without pointer events still get press-to-position.
  scale.addEventListener('click', function (event) {
    if (panelJustAppeared()) return;
    setFrom(event.clientX); event.stopPropagation();
  });
  return scale;
}

/* ---------- the remote ----------
 * A TV browser is not a desktop one. Two things broke the D-pad here:
 *
 *  - the handler listened on `document` in the BUBBLE phase, so the browser's own
 *    spatial navigation saw the arrows first and could swallow or scroll on them;
 *  - it read only `event.key`, and TV engines are old (the floor is Chromium 63)
 *    and inconsistent about populating it for remote keys.
 *
 * So: capture phase on window, keyCode as a fallback, and preventDefault on
 * anything we act on so the page never scrolls underneath the viewer.
 */
var KEY_LEFT = 37, KEY_UP = 38, KEY_RIGHT = 39, KEY_DOWN = 40, KEY_ENTER = 13, KEY_SPACE = 32;

function keyName(event) {
  var code = event.keyCode || event.which || 0;
  var key = event.key || '';
  if (key === 'ArrowLeft' || code === KEY_LEFT) return 'left';
  if (key === 'ArrowRight' || code === KEY_RIGHT) return 'right';
  if (key === 'ArrowUp' || code === KEY_UP) return 'up';
  if (key === 'ArrowDown' || code === KEY_DOWN) return 'down';
  if (key === 'Enter' || code === KEY_ENTER) return 'ok';
  // Media keys: present on most keyboards and reported by many TV remotes.
  if (key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause'
      || key === ' ' || code === KEY_SPACE || code === 179) return 'playpause';
  if (key === 'MediaTrackNext' || code === 176) return 'next';
  if (key === 'MediaTrackPrevious' || code === 177) return 'previous';
  if (key === 'AudioVolumeUp' || code === 175) return 'volup';
  if (key === 'AudioVolumeDown' || code === 174) return 'voldown';
  if (key === 'MediaStop' || code === 178) return 'stop';

  /**
   * TV remote codes. A television's own volume and channel keys are handled by
   * its firmware and never reach a browser — that is why volume moved to the
   * D-pad. These are the ones that CAN arrive on Tizen and webOS, mapped
   * defensively: costing nothing if the device never sends them.
   *
   * Use ?keys=1 on a Face to see what a given remote actually reports.
   */
  if (code === 415 || code === 10252) return 'playpause';   // Tizen Play / PlayPause
  if (code === 413) return 'stop';                          // Tizen Stop
  if (code === 417 || code === 228) return 'next';          // FastForward
  if (code === 412 || code === 227) return 'previous';      // Rewind
  if (code === 403) return 'previous';                      // red
  if (code === 404) return 'playpause';                     // green
  if (code === 405) return 'voldown';                       // yellow
  if (code === 406) return 'volup';                         // blue

  /**
   * LETTER KEYS, and they are not a convenience — on this television they are the
   * only thing that works.
   *
   * Probed on Peter's set, 2026-08-25: the browser received codes
   * [32, 65-90, 189] and NOTHING else. No arrows, no Enter, no media keys, no
   * coloured buttons — the TV's own navigation consumes every one of them before
   * the page exists. A keyboard reaches it perfectly.
   *
   * So every control has a letter, chosen to be reachable one-handed and not to
   * collide: there is no text input anywhere on a Face, so a letter is free.
   */
  var letter = String.fromCharCode(code).toLowerCase();
  if (letter === 'k') return 'playpause';
  if (letter === 'n' || letter === 'j') return 'next';
  if (letter === 'b') return 'previous';
  if (letter === 'f') return 'right';                       // next face
  if (letter === 'g') return 'left';                        // previous face
  if (letter === 'a') return 'ok';                          // artwork
  if (letter === 'r') return 'room';                        // next room
  if (letter === 'u' || code === 187 || code === 107) return 'volup';
  if (letter === 'd' || code === 189 || code === 109) return 'voldown';
  return '';
}

function onKey(event) {
  var name = keyName(event);
  if (debugKeys) {
    // In probe mode, REPORT rather than act: pressing play to find its code
    // should not also start the music.
    reportKey(event, name);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (name === '') { showPicker(); return; }
  if (name === 'left') cycleFace(-1);
  else if (name === 'right') cycleFace(1);
  // UP/DOWN IS VOLUME, not room. A TV steals the hard volume keys before the
  // browser ever sees them (Peter, 08-25: "seem to control tv volume"), and this
  // screen is BOUND to its room — changing room is a setup-time act, while volume
  // is reached for constantly. Room moved to the on-screen strip.
  else if (name === 'up') nudgeVolume(1);
  else if (name === 'down') nudgeVolume(-1);
  else if (name === 'ok') cycleArtist();
  else if (name === 'playpause') transport('playpause');
  else if (name === 'next') transport('next');
  else if (name === 'previous') transport('previous');
  else if (name === 'stop') transport('pause');
  else if (name === 'volup') nudgeVolume(1);
  else if (name === 'voldown') nudgeVolume(-1);
  else if (name === 'room') cycleZone(1);
  event.preventDefault();
  event.stopPropagation();
}

// Capture on window AND document: some TV browsers deliver to only one of them.
window.addEventListener('keydown', onKey, true);
document.addEventListener('keydown', onKey, true);
// A page with nothing focusable can be skipped by a TV's key routing entirely.
root.setAttribute('tabindex', '0');
try { root.focus(); } catch (error) { /* not focusable on this engine */ }
window.addEventListener('load', function () { try { root.focus(); } catch (error) { /* ignore */ } });

/**
 * RAISING THINGS IS A DELIBERATE ACT, AND WHERE YOU PRESS DECIDES WHAT APPEARS.
 *
 * Movement only REVEALS the affordances — the room name and the cog fade in so a
 * viewer can see there is something to press — it never opens a panel. Opening is
 * a press, and the press's position chooses between browse, transport and faces.
 */
var CHROME_MS = 6000;
var chromeTimer = null;
var panelShownAt = 0;
/** Set by closeSettings: no reveal until the dismissing gesture is fully over. */
var chromeHeldUntil = 0;

function revealChrome() {
  if (Date.now() < chromeHeldUntil) return;
  paintFaceName();
  root.className = root.className.indexOf('show-chrome') >= 0 ? root.className : root.className + ' show-chrome';
  // The transport bar belongs to the revealed state, not to a press: once the
  // screen is showing its controls, the commonest ones should already be there.
  // Classic carries its transport and volume in its own layout, so raising the
  // chrome there must not also raise a strip saying the same thing.
  if (picker.hidden && browsePanel === null && !hasShelf()) showPicker('transport');
  if (chromeTimer !== null) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(function () {
    root.className = root.className.replace(' show-chrome', '');
    if (picker.className.indexOf('mode-transport') >= 0) picker.hidden = true;
  }, CHROME_MS);
}

/** True while a panel is too freshly raised to be pressed by the touch that raised it. */
function panelJustAppeared() { return Date.now() - panelShownAt < 500; }

function inNode(target, node) {
  while (target !== null && target !== document.body) {
    if (target === node) return true;
    target = target.parentNode;
  }
  return false;
}

/**
 * Put EVERYTHING away and go back to the music.
 *
 * Hiding the strip alone was not enough. A touch ends with the browser's
 * compatibility mouse events — mousemove, then click — and the mousemove reveals
 * the chrome again before the finger has left the glass, so the screen appeared
 * not to dismiss at all. The reveal is therefore held off for the rest of the
 * gesture, and the badges go with the strip: "back to now playing" means the
 * resting face, not a quieter version of the controls.
 */
function closeSettings() {
  closeBrowse();
  if (pickerTimer !== null) { clearTimeout(pickerTimer); pickerTimer = null; }
  picker.hidden = true;
  if (chromeTimer !== null) { clearTimeout(chromeTimer); chromeTimer = null; }
  root.className = root.className.replace(' show-chrome', '');
  chromeHeldUntil = Date.now() + 900;
}

var lastZonePress = 0;
function onFacePress(event) {
  var now = Date.now();
  if (now - lastZonePress < 400) return;     // one press, however many names it arrives under
  // Read this BEFORE revealing: revealChrome raises the transport bar itself, so
  // afterwards every press would look like a press with the chrome already up.
  var wasUp = !picker.hidden || browsePanel !== null;
  revealChrome();

  var target = event ? event.target : null;
  /**
   * THE WAY BACK TO THE MUSIC IS TO TOUCH PAST WHAT IS UP (Peter, 08-26).
   *
   * Anything raised — the transport bar, the faces list, the rooms list, the
   * browser — is put away by a press outside it, and that press does nothing
   * else. Without this an outside press was routed by height like any other, so
   * leaving a panel meant landing in another one.
   *
   * `panelJustAppeared` is what keeps the zones working: the touch that raises
   * the chrome is the SAME gesture as the press that follows it, so that first
   * press still routes. Only a later one dismisses.
   *
   * ⚠️ EVERYTHING THAT OWNS A PRESS MUST BE LISTED HERE, and the COPY was not.
   * The chrome is up whenever anyone has just moved or touched — which is always,
   * in use — so pressing the title, artist or album put the chrome away instead
   * of opening browse, and browse looked like it had been lost entirely
   * (Peter, 08-28). It was reachable only from a cold page nobody had touched,
   * which is exactly the state a headless test starts in: the fault survived
   * testing because the test never raised the chrome first.
   */
  if (wasUp && !panelJustAppeared() && target !== null
      && !inNode(target, cover) && !inNode(target, picker) && !inNode(target, foot)
      && !inNode(target, copy) && !inNode(target, homeMark) && !inNode(target, shelfVolume)
      && !inNode(target, shelfBrowse)
      && (memberVols === null || !inNode(target, memberVols))
      && !inNode(target, groupDoor)
      && !inNode(target, cog) && !inNode(target, zoneName) && !inNode(target, chipHost)
      && (browsePanel === null || !inNode(target, browsePanel))) {
    lastZonePress = now;
    closeSettings();
    return;
  }
  // Anything that handles its own presses is not a zone. Classic's shelf is part
  // of the layout rather than a panel over it, so it has to say so here too.
  if (target !== null && (inNode(target, cover) || inNode(target, picker) || inNode(target, foot)
      || inNode(target, shelfVolume) || inNode(target, shelfBrowse)
      || (memberVols !== null && inNode(target, memberVols))
      || (browsePanel !== null && inNode(target, browsePanel)))) return;
  lastZonePress = now;

  if (target !== null && inNode(target, homeMark)) return;   // it has its own job
  if (target !== null && inNode(target, groupDoor)) return;  // and so has this
  if (target !== null && inNode(target, cog)) { openPanel('faces'); return; }
  if (target !== null && (inNode(target, zoneName) || inNode(target, chipHost))) { openPanel('rooms'); return; }

  /**
   * ⚖️ THE WORDS ARE A TARGET, NOT A BAND.
   *
   * Pressing where the music is NAMED asks "what is playing?", which is browse.
   * That used to be a height band — 16% to 72% of the frame — and the bands
   * drifted as the faces changed until the title sat at exactly 0.72 and every
   * press on it fell through to the transport instead (Peter, 08-28: "we seem to
   * have lost the browse capability when clicking on metadata area, all
   * screens"). A band has to be re-tuned every time a face moves; the element
   * cannot drift away from itself.
   *
   * The bands remain for the EMPTY parts of the frame, where there is nothing to
   * hit and only position can say what was meant.
   */
  /**
   * ⚖️ A FACE THAT CARRIES ITS CHROME IN THE LAYOUT RAISES NOTHING (Peter,
   * 08-28: "clicking outside areas is still bringing up old chrome — now
   * redundant").
   *
   * The browse marks stand above the words and the controls below them; there is
   * nothing a raised strip could offer that is not already on the screen, so a
   * press on empty space only wakes the chrome and stops. The named targets
   * still do their jobs — the room badge, the face badge, the group door — and
   * every OTHER face keeps the strips, because it still needs them.
   */
  if (hasShelf()) return;

  if (target !== null && inNode(target, copy)) { openBrowseMenu(); return; }

  var y = event && typeof event.clientY === 'number' ? event.clientY : 0;
  var height = window.innerHeight || 1080;
  if (y < height * 0.16) { openPanel('faces'); return; }
  if (y < height * 0.72) { openBrowseMenu(); return; }
  // The lower band is where the transport bar lives, and revealChrome has already
  // put it there — pressing again would only re-raise it under the finger.
  showPicker('transport');
}

['click', 'pointerup', 'touchend', 'mouseup'].forEach(function (kind) {
  document.addEventListener(kind, onFacePress);
});

/**
 * ⚖️ A press outside the rooms' window puts it away, and does nothing else —
 * the same grammar as every other raised thing here.
 *
 * In CAPTURE, because the window fills the column and everything genuinely
 * outside it — the artwork above all — handles its own presses and stops them
 * before a document listener would ever see one.
 */
['click', 'pointerup', 'touchend', 'mouseup'].forEach(function (kind) {
  document.addEventListener(kind, function (event) {
    if (!memberVolsOpen) return;
    var target = event.target;
    if (memberVols !== null && inNode(target, memberVols)) return;
    if (memberVolsButton !== null && inNode(target, memberVolsButton)) return;
    closeMemberVols();
    event.stopPropagation();
    if (event.type !== 'touchend' && event.preventDefault) event.preventDefault();
  }, true);
});

// The progress row is its own zone: pressing it seeks.
var lastSeekPress = 0;
['click', 'pointerup', 'touchend'].forEach(function (kind) {
  foot.addEventListener(kind, function (event) {
    var now = Date.now();
    if (now - lastSeekPress < 400 || panelJustAppeared()) return;
    lastSeekPress = now;
    var x = typeof event.clientX === 'number' ? event.clientX
      : (event.changedTouches && event.changedTouches[0] ? event.changedTouches[0].clientX : 0);
    seekFromPress(x);
    event.stopPropagation();
  });
});
foot.setAttribute('title', 'press to seek');

// And the ring is the same zone in polar: on the ring faces it IS the progress
// row, so pressing it seeks. The guard is shared, so a press cannot be counted
// by both.
/**
 * ⚖️ THE RING OWNS ITS OWN PRESSES (Peter, 08-28: "a click on the circle should
 * seek — not enable artist; that should be with the artwork").
 *
 * The ring lives INSIDE the cover, and the cover flips to the artist view when
 * pressed, so a press on the ring was doing both — and the artist view is the
 * louder of the two, so that is all anyone saw. The band therefore stops the
 * event dead whether or not it can seek: a track that cannot be scrubbed says so
 * and still does not become a portrait.
 *
 * All four names for one press, `mouseup` included — leaving it off was the whole
 * fault, since `pressable` listens for it and the other three were being stopped.
 */
['click', 'pointerup', 'touchend', 'mouseup'].forEach(function (kind) {
  dialHit.addEventListener(kind, function (event) {
    event.stopPropagation();                     // the ring, not the artwork
    var now = Date.now();
    if (now - lastSeekPress < 400 || panelJustAppeared()) return;
    var touch = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null;
    var x = typeof event.clientX === 'number' ? event.clientX : (touch ? touch.clientX : null);
    var y = typeof event.clientY === 'number' ? event.clientY : (touch ? touch.clientY : null);
    if (x === null || y === null) return;
    if (!seekFromRing(x, y)) return;
    lastSeekPress = now;
  });
});
dialHit.setAttribute('title', 'press the ring to seek');
// Movement reveals the affordances but opens nothing.
['mousemove', 'pointermove', 'touchstart'].forEach(function (kind) {
  document.addEventListener(kind, revealChrome, true);
});

/* ---------- keep the screen awake ---------- */
function keepAwake() {
  if (!('wakeLock' in navigator) || !window.isSecureContext) return;
  // webOS HANGS this promise rather than rejecting, so it is raced against a timeout.
  var request = navigator.wakeLock.request('screen');
  var timeout = new Promise(function (resolve) { setTimeout(resolve, 5000); });
  Promise.race([request, timeout]).catch(function () { /* not available: the drill covers device setup */ });
}
document.addEventListener('visibilitychange', function () { if (!document.hidden) keepAwake(); });
keepAwake();

root.setAttribute('data-face', current);
markLayout();
markRing();
paintFaceName();
fieldRunning(hasField(current));
sayHello();
// Every twenty seconds: cheap, and it is how a binding set in Roon arrives.
setInterval(sayHello, 20000);
if (debugKeys) { reportKey({ key: 'probe ready', keyCode: 0 }, ''); startPointerProbe(); }
var store = createStore(render);
store.hydrate();
var streamState = 'live';
createStream(store, function (state) {
  streamState = state;
  if (state === 'catching-up') status.textContent = 'catching up…';
  else { var snap = store.snapshot(); if (snap !== null) render(snap, 'snapshot'); }
});
setInterval(function () {
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'seek');
}, 500);
