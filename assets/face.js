import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { createIdleDelayPolicy } from './idle-delay.js';
import { coverTransitionReceipt, shouldFlipCover, stableCoverReceipt } from './cover-transition.js';
import { seekTargetSecond } from './seek-target.js';
import { createSeekIntentGate } from './seek-intent.js';
import { chooseCoverEffect } from './cover-effects.js';

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
var STORE_KEY_TRANSITION = 'flightdeck.cover-transition.';
var TRANSITIONS = ['random', 'flip', 'slide', 'dissolve', 'lift', 'none'];
var LAMP_MIN = 24, LAMP_MAX = 96;

var root = document.getElementById('face');
var picker = document.getElementById('picker');
// Silk inherits Android's fading overlay scrollbar, which is only a hairline on
// a television. Mark that browser narrowly so Browse can keep a proper native
// drag rail without changing the already-good Samsung and desktop renderings.
if (/\bSilk\//i.test(String(navigator.userAgent || ''))) root.setAttribute('data-silk', '1');
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
 * Replaced when someone browses to another room by hand: the selected room's
 * output becomes the session's new durable anchor, so a later grouping cannot
 * strand the display on the zone id Roon just destroyed. The URL restores the
 * original room on reload.
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

// Roon's Browse stack lives server-side and is keyed by `multi_session_key`.
// Sharing one literal key made two screens move each other's Back/Into position.
// A private-mode screen still gets an isolated key for this page lifetime.
var browseSessionKey = 'face-' + (displayId || ('private-' + String(Date.now()).slice(-8)
  + Math.random().toString(36).slice(2, 8)));

// Recent's station lookup owns a DIFFERENT Roon Browse stack. It may refresh the
// Live Radio root while an ordinary album/search stack is still on screen, and
// those two questions must never move one another's Back/Into position.
var recentRadioSessionKey = 'recent-radio-' + String(Date.now()).slice(-8)
  + Math.random().toString(36).slice(2, 8);

var lockedOutputId = null;

/**
 * A move picker freezes the OUTPUT at the side that must survive Roon replacing
 * either zone. Merely opening a picker changes neither playback nor the player
 * on this display; the frozen identity is only a durable description of intent.
 */
var transferSourceOutputId = null;
var pullDestinationOutputId = null;

function displayName() {
  var slug = root.getAttribute('data-zone-slug');
  var where = root.getAttribute('data-zone') !== '' && slug ? slug : (following ? 'follows the music' : 'wall');
  // The browser id is the physical screen; Canvas, Libretto and the other faces
  // are merely its clothes. Keep one stable human name and therefore one room
  // binding and idle policy for the whole family of faces.
  return where;
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
    // Settings arrive on the same heartbeat as room binding. Apply the delay
    // BEFORE the unchanged-output return, or changing only the saver setting
    // would never reach a screen already locked to the right room.
    var delayChanged = idlePolicy.setDelay(data.idleDelayMinutes);
    root.setAttribute('data-idle-delay-minutes', String(idlePolicy.delay()));
    var wanted = data.output || null;
    var outputChanged = wanted !== lockedOutputId;
    if (!outputChanged && !delayChanged) return;
    if (outputChanged) lockedOutputId = wanted;
    // A lock is a decision made elsewhere and it wins: the screen stops following
    // the music, releases any hand-picked room, and belongs to its speaker.
    if (outputChanged && lockedOutputId !== null) {
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

function zoneForOutputId(snapshot, outputId) {
  if (snapshot === null || outputId === null) return null;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    var outs = snapshot.zones[i].outputs;
    for (var j = 0; j < outs.length; j += 1) {
      if (outs[j].id === outputId) return snapshot.zones[i];
    }
  }
  return null;
}

function zoneForOutput(snapshot) {
  return zoneForOutputId(snapshot, boundOutputId);
}
// An explicit Face URL is a fresh room choice and must win over the room this
// browser happened to visit from that Face in an earlier session. Only an
// unbound page may restore its last in-page choice.
if (zoneId === '' && boundOutputId === null) {
  try {
    var savedZone = localStorage.getItem(STORE_KEY_ZONE + zoneId);
    if (savedZone !== null && savedZone !== '') shownZoneId = savedZone;
  } catch (error) { /* private mode */ }
}

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
/**
 * ⚖️ THE PUCK IS A NORMAL FACE OPTION (Peter, 09-03, twice). It is NOT drawn
 * inside this page — face.css is `vw` for a 16:9 television and a circle sized
 * off the short side has no business inside those rules — so choosing it here
 * means going to its own page, and a screen that remembers "puck" goes there
 * the moment it loads. The face it left is kept beside the memory, so the way
 * back from the puck lands on that face and not on the puck again.
 */
var STORE_KEY_FACE_BEFORE = 'flightdeck.face.before.';
function puckHref() {
  return '/puck/' + encodeURIComponent(boundOutputId || zoneId || '');
}
/** Chosen from the list: keep the face being left, remember the puck, go. */
function leaveForPuck() {
  try { localStorage.setItem(STORE_KEY_FACE_BEFORE + zoneId, FACES.indexOf(current) === -1 ? 'presence' : current); }
  catch (error) { /* private mode */ }
  remember('puck');
  window.location.replace(puckHref());
}
// Remembered from a previous visit: go, and touch NOTHING — the face kept
// beside the memory is the one the person chose the puck from, and writing
// over it here sent every way back to presence.
if (current === 'puck') { window.location.replace(puckHref()); }
if (FACES.indexOf(current) === -1) current = 'presence';

function rememberedTransition(face) {
  try { return localStorage.getItem(STORE_KEY_TRANSITION + face); } catch (error) { return null; }
}
function transitionForFace(face) {
  var stored = rememberedTransition(face);
  return TRANSITIONS.indexOf(stored) === -1 ? 'random' : stored;
}
function rememberTransition(face, name) {
  try { localStorage.setItem(STORE_KEY_TRANSITION + face, name); } catch (error) { /* private mode */ }
}
var transitionMode = transitionForFace(current);
root.setAttribute('data-cover-transition', transitionMode);

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
var lastTrackIdentity = null;
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
function goToWall() { location.href = '/'; }
pressable(homeMark, goToWall, 'header-wall');

/**
 * THE HEADER HAS THREE MUSIC-GEOGRAPHY DOORS (Peter, 08-31):
 *
 *   Queue  |  current room  |  group
 *
 * The face chooser moves into the artwork mark those two room controls used to
 * occupy.  Queue is deliberately its own door: Recent is listening history;
 * this is Roon's live forward play queue.
 */
var queueDoor = el('span', 'queuedoor', 'queue');
queueDoor.setAttribute('title', 'show the Roon queue');
queueDoor.setAttribute('aria-label', 'show the Roon queue');
pressable(queueDoor, openQueuePanel, 'header-queue');

var zoneName = el('span', 'zone');
zoneName.setAttribute('title', 'choose a room to display');
zoneName.setAttribute('aria-label', 'choose a room to display');
// The name answers "which player am I looking at?"; the adjacent chain/count
// answers "how is that player grouped?". Keeping those two targets distinct
// makes a room switch safe and predictable on touch, mouse and TV remotes.
function openDisplayPicker() { openPanel('rooms'); }
pressable(zoneName, openDisplayPicker, 'header-rooms');
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
pressable(groupDoor, startGroupPick, 'header-group');
var cog = el('span', 'cog');
cog.setAttribute('aria-label', 'change face');
pressable(cog, function () { openPanel('faces'); }, 'header-faces');
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
headMark.appendChild(cog);
var headTools = el('div', 'headtools');
headTools.appendChild(queueDoor);
headTools.appendChild(zoneName);
headTools.appendChild(groupDoor);
headTools.appendChild(chipHost);
head.appendChild(headMark); head.appendChild(status); head.appendChild(headTools);

var body = el('div', 'body');
var cover = el('div', 'cover');
var sleeveFlip = el('div', 'sleeveflip');
var sleeveFront = el('div', 'sleeveside sleevefront');
var coverImg = document.createElement('img');
coverImg.alt = '';
var sleeveBack = el('div', 'sleeveside sleeveback');
var coverNextImg = document.createElement('img');
coverNextImg.alt = '';
sleeveFront.appendChild(coverImg);
sleeveBack.appendChild(coverNextImg);
sleeveFlip.appendChild(sleeveFront);
sleeveFlip.appendChild(sleeveBack);
cover.appendChild(sleeveFlip);
/**
 * THE VISIBLE SLEEVE IS ALWAYS THE WAY BACK FROM ARTIST VIEW.
 *
 * The transition planes deliberately ignore pointer events, and Dial puts a
 * separately pressable seek ring around them. Relying on the outer cover for
 * the return therefore made the smallest artist-view sleeve an ambiguous hit:
 * some television pointer stacks landed on the ring/cover choreography instead
 * of changing the view. This exact square sits above the sleeve only in artist
 * view. The ring outside it remains seekable and album view still uses the
 * outer cover to enter artist view.
 */
var albumReturn = el('span', 'album-return');
albumReturn.setAttribute('aria-label', 'return to album artwork');
cover.appendChild(albumReturn);
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
 *   the face badge   raises the FACES picker
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
var idle = el('div', 'idle');
var idleClock = el('div', 'clock');
var idleNote = el('div', 'note');
idle.appendChild(idleClock); idle.appendChild(idleNote);
idle.style.display = 'none';

/**
 * Pausing is not an instruction to erase the music. Hold the exact room's last
 * composition until its per-display deadline, then become the low-light clock.
 * The controller uses an absolute deadline so snapshot and seek traffic cannot
 * postpone it, and its callback always re-reads the current store.
 */
var idlePolicy = createIdleDelayPolicy({
  delayMinutes: 15,
  now: function () { return Date.now(); },
  setTimer: function (callback, delay) { return setTimeout(callback, delay); },
  clearTimer: function (timer) { clearTimeout(timer); },
  onDue: function () {
    var snapshot = store === undefined ? null : store.snapshot();
    if (snapshot !== null) render(snapshot, 'snapshot');
  },
});
root.setAttribute('data-idle-delay-minutes', String(idlePolicy.delay()));

/** Keep the idle face a real clock, with a tiny five-minute drift for OLED care. */
function updateIdleClock() {
  if (root.getAttribute('data-idle') !== '1') return;
  var now = new Date();
  idleClock.textContent = now.toTimeString().slice(0, 5);
  var shifts = [[-0.35, -0.28], [0.32, -0.2], [0.28, 0.3], [-0.3, 0.24]];
  var shift = shifts[Math.floor(now.getTime() / 300000) % shifts.length];
  idle.style.transform = 'translate(' + String(shift[0]) + 'vw,' + String(shift[1]) + 'vh)';
}
setInterval(updateIdleClock, 30000);
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
/**
 * The progress head is a little pearl rather than a flat painted dot. A plain
 * SVG radial gradient is cheap on a TV GPU and predates our Chromium 63 floor;
 * no filter, mask or second moving element can lag behind the real position.
 */
var dialDefs = document.createElementNS(SVG_NS, 'defs');
var dialPearl = document.createElementNS(SVG_NS, 'radialGradient');
dialPearl.setAttribute('id', 'dial-pearl');
dialPearl.setAttribute('cx', '32%'); dialPearl.setAttribute('cy', '28%');
dialPearl.setAttribute('r', '72%'); dialPearl.setAttribute('fx', '28%'); dialPearl.setAttribute('fy', '24%');
[
  ['0%', 'dial-pearl-glint'], ['30%', 'dial-pearl-light'],
  ['68%', 'dial-pearl-tone'], ['100%', 'dial-pearl-depth'],
].forEach(function (spec) {
  var stop = document.createElementNS(SVG_NS, 'stop');
  stop.setAttribute('offset', spec[0]); stop.setAttribute('class', spec[1]);
  dialPearl.appendChild(stop);
});

/**
 * The ring is the pearl drawn out into a cord. A radial gradient centred on the
 * disc shades ACROSS the existing stroke: RING_R=44 samples 88% of an r=50
 * gradient, so the five close stops make a raised cross-section all the way
 * round without another circle, filter, mask or animated paint layer.
 */
function dialRingGradient(id, classes) {
  var gradient = document.createElementNS(SVG_NS, 'radialGradient');
  gradient.setAttribute('id', id);
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  gradient.setAttribute('cx', '50'); gradient.setAttribute('cy', '50');
  gradient.setAttribute('r', '50');
  var offsets = ['84%', '86.5%', '88%', '89.5%', '92%'];
  for (var i = 0; i < offsets.length; i += 1) {
    var stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', offsets[i]); stop.setAttribute('class', classes[i]);
    gradient.appendChild(stop);
  }
  return gradient;
}
var dialRingProgress = dialRingGradient('dial-ring-progress', [
  'dial-ring-depth', 'dial-ring-tone', 'dial-ring-light', 'dial-ring-tone', 'dial-ring-depth',
]);
var dialRingTrack = dialRingGradient('dial-ring-track', [
  'dial-track-depth', 'dial-track-tone', 'dial-track-light', 'dial-track-tone', 'dial-track-depth',
]);
dialDefs.appendChild(dialPearl);
dialDefs.appendChild(dialRingProgress); dialDefs.appendChild(dialRingTrack);
dial.appendChild(dialDefs);
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

/**
 * A live stream has no fraction. Clear EVERY surface that can remember the
 * previous finite track before saying that plainly; otherwise radio inherits a
 * convincing-looking bar, bead or ring from whatever happened to play before it.
 */
function resetProgress(zone) {
  ensureLamps(0);
  for (var i = 0; i < lampNodes.length; i += 1) lampNodes[i].className = '';
  barFill.style.width = '0%';
  dialArc.setAttribute('stroke-dashoffset', String(RING_C));
  dialBead.style.display = 'none';
  dialBead.removeAttribute('cx');
  dialBead.removeAttribute('cy');
  root.className = root.className.replace(' ring-jump', '');
  lastRingKey = '';
  lastRingFraction = 0;

  var isLive = zone.nowPlaying !== null
    && zone.allowed.seek === false
    && (zone.state === 'playing' || zone.state === 'loading');
  var live = isLive ? 'LIVE' : '';
  elapsed.textContent = live;
  remaining.textContent = '';
  ends.textContent = '';
  dialRemain.textContent = '';
  dialTimes.textContent = live;
  dialEnds.textContent = '';
}

/* ---------- render ---------- */
var artKey = null;
var paintedArtKey = null;
var coverReceipt = null;
var coverLoadEpoch = 0;
var coverFlipEpoch = 0;
var coverFlipTargetKey = null;
var coverFlipTimer = null;
var lastCoverEffectByFace = {};
var COVER_TRANSITION_MS = 760;

function reducedCoverMotion() {
  try {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) { return false; }
}

function coverPalette(url, request, key) {
  readPalette(url, function (tones) {
    if (request !== coverLoadEpoch || key !== artKey) return;
    palette = tones;
    var root2 = document.documentElement.style;
    root2.setProperty('--accent', tones[2]);
    root2.setProperty('--accent-rich', tones[3] || tones[2]);
    root2.setProperty('--disc', tones[0]);
  });
}

/** Land the reverse side, then reset the card with both paints identical. */
function finishCoverFlip(epoch) {
  if (epoch !== coverFlipEpoch || coverFlipTargetKey === null) return;
  if (coverFlipTimer !== null) { clearTimeout(coverFlipTimer); coverFlipTimer = null; }
  var nextSource = coverNextImg.getAttribute('src');
  sleeveFlip.className = 'sleeveflip is-resetting';
  if (nextSource === null || nextSource === '') coverImg.removeAttribute('src');
  else coverImg.src = nextSource;
  coverNextImg.removeAttribute('src');
  paintedArtKey = coverFlipTargetKey;
  coverFlipTargetKey = null;
  // No second return-flip: reset at zero while front and back are the same paint.
  sleeveFlip.getBoundingClientRect();
  sleeveFlip.className = 'sleeveflip';
}

function settleCoverFlip() {
  if (coverFlipTargetKey !== null) finishCoverFlip(coverFlipEpoch);
  else sleeveFlip.className = 'sleeveflip';
}

function showCoverNow(source, key, request) {
  settleCoverFlip();
  coverImg.src = source;
  coverNextImg.removeAttribute('src');
  paintedArtKey = key;
  coverPalette(source, request, key);
}

function beginCoverTransition(source, key, request, effect) {
  settleCoverFlip();
  coverNextImg.src = source;
  sleeveFlip.className = 'sleeveflip effect-' + effect;
  sleeveFlip.getBoundingClientRect();       // establish the unturned side
  coverFlipEpoch += 1;
  var epoch = coverFlipEpoch;
  coverFlipTargetKey = key;
  sleeveFlip.className = 'sleeveflip effect-' + effect + ' is-flipped';
  coverPalette(source, request, key);
  coverFlipTimer = setTimeout(function () { finishCoverFlip(epoch); }, COVER_TRANSITION_MS + 100);
}

function setCover(art, receipt, kind, albumView) {
  var previous = coverReceipt;
  var key = art ? art.key : null;
  var sameArt = key === artKey;
  var animate = !sameArt && shouldFlipCover(previous, receipt, kind, paintedArtKey,
    document.hidden !== true, albumView === true);
  coverReceipt = stableCoverReceipt(previous, receipt, kind, sameArt);
  if (key === artKey) return;
  artKey = key;
  coverLoadEpoch += 1;
  var request = coverLoadEpoch;
  settleCoverFlip();
  if (art === null) {
    coverImg.removeAttribute('src');
    coverNextImg.removeAttribute('src');
    paintedArtKey = null;
    return;
  }
  var next = new Image();
  var committed = false;
  var commitOnce = function () {
    if (committed || request !== coverLoadEpoch || key !== artKey) return;
    committed = true;
    // Decode and onload may both report success. Exactly one of them owns paint.
    if (animate && transitionMode !== 'none' && !reducedCoverMotion()
        && paintedArtKey === previous.artKey && coverImg.getAttribute('src') !== null) {
      var previousEffect = lastCoverEffectByFace[current] || '';
      var effect = chooseCoverEffect(transitionMode, previousEffect, Math.random());
      if (effect === null) showCoverNow(next.src, key, request);
      else {
        lastCoverEffectByFace[current] = effect;
        beginCoverTransition(next.src, key, request, effect);
      }
    } else showCoverNow(next.src, key, request);
  };
  next.onload = commitOnce;
  next.src = art.path;
  if ('decode' in HTMLImageElement.prototype) {
    next.decode().then(commitOnce).catch(function () { /* onload covers it */ });
  }
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
  refreshStructuralPicker(kind);
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
      groupDoor.setAttribute('aria-disabled', 'false');
      groupDoor.setAttribute('title', plus[2] + ' more rooms \u00B7 press to change the group');
      groupDoor.setAttribute('aria-label', 'edit group for ' + zone.name);
      groupDoor.hidden = false;
    } else if (canGroup) {
      groupDoor.replaceChildren(glyph('group'));
      groupDoor.className = 'groupdoor';
      groupDoor.setAttribute('aria-disabled', 'false');
      groupDoor.setAttribute('title', 'group ' + zone.name + ' with another room');
      groupDoor.setAttribute('aria-label', 'group ' + zone.name + ' with another room');
      groupDoor.hidden = false;
    } else {
      // The three-door order never jumps.  A disabled chain answers why Group
      // is absent without moving Queue or the room name into its old place.
      groupDoor.replaceChildren(glyph('group'));
      groupDoor.className = 'groupdoor unavailable';
      groupDoor.setAttribute('aria-disabled', 'true');
      groupDoor.setAttribute('title', zone.name + ' cannot be grouped');
      groupDoor.setAttribute('aria-label', zone.name + ' cannot be grouped');
      groupDoor.hidden = false;
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
    if (np === null) {
      // A short playing/loading gap is part of Roon's ordinary successor
      // sequence. Keep the receipt for the still-painted old sleeve so the new
      // cover can turn from it. Pause, stop and an authoritative baseline end
      // that evidence immediately.
      if (kind !== 'update' || (zone.state !== 'playing' && zone.state !== 'loading')) {
        coverReceipt = null;
        lastTrackIdentity = null;
      }
    }
    var inactive = np === null || zone.state === 'paused' || zone.state === 'stopped';
    var idleNow = idlePolicy.reconcile(zone.id, inactive, np !== null);
    root.setAttribute('data-idle', idleNow ? '1' : '0');
    if (idleNow) {
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
      idleNote.textContent = zone.name;
      updateIdleClock();
    } else {
      idle.style.display = 'none';
      cover.style.display = ''; cover.style.visibility = '';
      // A stopped zone commonly drops nowPlaying. During its grace period retain
      // only this same room's already-painted composition; progress is still
      // cleared below, so no old position masquerades as live playback.
      if (np !== null) {
        var nextCoverReceipt = coverTransitionReceipt(snapshot, zone);
        var wasAlbumView = viewStep === VIEW_ALBUM;
        if (nextCoverReceipt !== null && nextCoverReceipt.trackKey !== lastTrackIdentity) {
          lastTrackIdentity = nextCoverReceipt.trackKey;
          // A new track means a new artist; never leave a stale face on screen.
          if (viewStep !== VIEW_ALBUM) {
            viewStep = VIEW_ALBUM; artistIndex = -1; backdropKey = null; applyArtistView();
          }
        }
        title.textContent = np.title;
        line2.textContent = np.line2;
        line3.textContent = np.line3;
        setCover(np.art, nextCoverReceipt, kind, wasAlbumView);
        setBackdrop(zone);
        idlePolicy.markPainted(zone.id);
      }
    }
  }

  paintVolume();

  var position = store.positionSec(zone);
  var length = zone.nowPlaying ? zone.nowPlaying.lengthSec : null;
  if (position === null || typeof position !== 'number' || !isFinite(position)
      || typeof length !== 'number' || !isFinite(length) || length <= 0) {
    resetProgress(zone);
    return;
  }
  // Lamp COUNT encodes track length (~1 lamp per 10 s): density tells you how
  // long the piece is before you read a number.
  var count = Math.max(LAMP_MIN, Math.min(LAMP_MAX, Math.round(length / 10)));
  ensureLamps(count);
  var litTo = Math.floor((position / length) * count);
  for (var l = 0; l < count; l += 1) {
    var node = lampNodes[l];
    // This state must not be called `head`: the page header uses that class for
    // absolute positioning, which pulled the first runway lamp over elapsed time.
    var wantClass = l < litTo ? 'lit' : (l === litTo && zone.state === 'playing' ? 'lamp-head' : '');
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
  dialBead.style.display = '';
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
  // The painted DOM is the user's truth. If an asynchronous image/render frame
  // ever leaves the bookkeeping a beat behind, a press on a visible artist view
  // must still go home instead of trying to enter artist view again.
  if (root.getAttribute('data-view') === 'artist') { returnToAlbum(); return; }
  cycleArtist();
}

function returnToAlbum() {
  if (viewStep === VIEW_ALBUM && root.getAttribute('data-view') !== 'artist') return;
  viewStep = VIEW_ALBUM;
  artistIndex = -1;
  backdropKey = null;
  applyArtistView();
  var snapshot = store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
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
pressable(albumReturn, returnToAlbum, 'artist-album-return');
// It is a pointer target, not a second D-pad stop nested inside the cover.
albumReturn.setAttribute('tabindex', '-1');

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
var pickerNavigationCurrent = null;

function cancelDwell() {
  if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
  if (dwellNode !== null) { dwellNode.className = dwellNode.className.replace(' arming', ''); dwellNode = null; }
}

/** Enabled, visible picker controls in DOM order — the order a D-pad walks. */
function pickerNavigationChoices() {
  var nodes = picker.querySelectorAll('[role="button"]');
  var choices = [];
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    var classes = ' ' + (node.getAttribute('class') || '') + ' ';
    if (node.getAttribute('aria-disabled') === 'true' || classes.indexOf(' off ') !== -1) continue;
    var parent = node;
    var visible = false;
    while (parent !== null) {
      if (parent.hidden === true || parent.getAttribute('aria-hidden') === 'true') break;
      if (parent === picker) { visible = true; break; }
      parent = parent.parentNode;
    }
    if (visible) choices.push(node);
  }
  return choices;
}

/** A semantic identity survives a structural picker repaint; a node does not. */
function pickerNavigationIdentity(node) {
  if (node === null) return '';
  var names = ['data-picker-key', 'data-face-option', 'data-transition-option', 'data-room-zone', 'data-group-zone', 'data-queue-item',
    'data-output', 'aria-label', 'title'];
  for (var i = 0; i < names.length; i += 1) {
    var value = node.getAttribute(names[i]);
    if (value !== null && value !== '') return names[i] + ':' + value;
  }
  return 'text:' + String(node.textContent || '').replace(/^\s+|\s+$/g, '');
}

function setPickerNavigation(node) {
  if (pickerNavigationCurrent !== null) pickerNavigationCurrent.classList.remove('picker-key-current');
  pickerNavigationCurrent = node;
  if (node === null) return;
  node.classList.add('picker-key-current');
  try { node.focus(); } catch (error) { /* old TV engine: the visible mark still works */ }
  if (typeof node.scrollIntoView === 'function') {
    try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (error) { node.scrollIntoView(false); }
  }
}

/** Seed the current choice on open; retain the same choice through live repaint. */
function seedPickerNavigation(preferred) {
  var choices = pickerNavigationChoices();
  if (choices.length === 0) { setPickerNavigation(null); return null; }
  var chosen = null;
  if (preferred !== '') {
    for (var p = 0; p < choices.length; p += 1) {
      if (pickerNavigationIdentity(choices[p]) === preferred) { chosen = choices[p]; break; }
    }
  }
  if (chosen === null) {
    for (var c = 0; c < choices.length; c += 1) {
      var classes = ' ' + (choices[c].getAttribute('class') || '') + ' ';
      if (classes.indexOf(' now ') !== -1 || classes.indexOf(' is-current ') !== -1
          || choices[c].getAttribute('aria-pressed') === 'true') {
        chosen = choices[c];
        break;
      }
    }
  }
  if (chosen === null) chosen = choices[0];
  setPickerNavigation(chosen);
  return chosen;
}

function movePickerNavigation(delta) {
  var choices = pickerNavigationChoices();
  if (choices.length === 0) return false;
  var at = -1;
  for (var i = 0; i < choices.length; i += 1) {
    if (choices[i] === pickerNavigationCurrent) { at = i; break; }
  }
  if (at === -1) {
    setPickerNavigation(delta < 0 ? choices[choices.length - 1] : choices[0]);
  } else {
    setPickerNavigation(choices[(at + delta + choices.length) % choices.length]);
  }
  return true;
}

function activatePickerNavigation() {
  var choices = pickerNavigationChoices();
  var active = false;
  for (var i = 0; i < choices.length; i += 1) {
    if (choices[i] === pickerNavigationCurrent) { active = true; break; }
  }
  if (!active && seedPickerNavigation('') === null) return false;
  if (typeof pickerNavigationCurrent.click === 'function') pickerNavigationCurrent.click();
  else {
    var event = document.createEvent('MouseEvents');
    event.initEvent('click', true, true);
    pickerNavigationCurrent.dispatchEvent(event);
  }
  return true;
}

function handlePickerNavigation(name) {
  // Browse is its own full window. Do not drive the picker left behind it.
  if (picker.hidden || browsePanel !== null) return false;
  // The transport strip is not a selection menu. Let Up/Down remain room volume
  // and OK remain artwork even while the chrome is visible; otherwise revealing
  // the strip with the first key silently changes the meaning of the next one.
  if (picker.className.indexOf('mode-transport') >= 0) return false;
  if (name === 'up') return movePickerNavigation(-1);
  if (name === 'down') return movePickerNavigation(1);
  if (name === 'ok') return activatePickerNavigation();
  return false;
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
/**
 * FORM FACTOR IS ROUTE-OWNED. `/phone` is the phone; `/now` and `/face` are
 * displays. A Fire TV may report a 960x540 CSS viewport, so viewport size cannot
 * decide which interface it receives: that classified the television as a phone,
 * made all chrome permanent and deliberately removed its face chooser.
 */
function markOrientation() {
  var w = window.innerWidth || 0;
  var h = window.innerHeight || 0;
  root.removeAttribute('data-size');
  root.setAttribute('data-orient', h >= w ? 'portrait' : 'landscape');
}

window.addEventListener('resize', markOrientation);
window.addEventListener('orientationchange', function () { setTimeout(markOrientation, 120); });

function markLayout() {
  markOrientation();
  root.setAttribute('data-layout', layoutOf(current));
  if (hasColumn()) root.setAttribute('data-column', '1');
  else root.removeAttribute('data-column');
  if (hasFlank()) root.setAttribute('data-flank', '1');
  else root.removeAttribute('data-flank');
  /**
   * ⚖️ A NARROW PLACE FOR THE ROOMS' LEVELS. A flank is about 400-600px and a
   * phone is 393 — both too narrow for speaker, name, scale and reading on one
   * line, and both wanting the same answer: who the room is on top, how loud
   * underneath. Named once so the rules are written once.
   */
  if (hasFlank()) root.setAttribute('data-narrow', '1');
  else root.removeAttribute('data-narrow');
  if (hasField(current)) root.setAttribute('data-field', '1');
  else root.removeAttribute('data-field');
}

function applyFace(name) {
  if (FACES.indexOf(name) === -1) return;
  // Pointer and dwell choices must move the remote's current mark too. Without
  // this, the new face was .now while the old face retained the focus outline,
  // and the next Up/Down continued from the wrong choice after the rebuild.
  if (!picker.hidden && picker.className.indexOf('mode-faces') >= 0) {
    var faceChoices = picker.querySelectorAll('[data-face-option]');
    for (var fc = 0; fc < faceChoices.length; fc += 1) {
      if (faceChoices[fc].getAttribute('data-face-option') === name) {
        setPickerNavigation(faceChoices[fc]);
        break;
      }
    }
  }
  if (name === current) return;
  current = name;
  remember(current);
  transitionMode = transitionForFace(current);
  root.setAttribute('data-face', current);
  root.setAttribute('data-cover-transition', transitionMode);
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
  /**
   * ⚖️ CHANGING FACE RAISES NOTHING (Peter, 08-29: "on transition between skins
   * I get a large box with control buttons popping up — it should not").
   *
   * This used to call `showPicker()` bare, which means the TRANSPORT mode: back
   * when the chrome was a thin strip along the bottom, re-raising it after a
   * face change was invisible. Now every panel opens as a window on the screen,
   * so the same call threw a boxful of buttons over the artwork every time
   * somebody looked at another skin. The picker is only REDRAWN, and only if it
   * was already open — which is what keeps the faces list showing the new choice
   * when the choice was made from the faces list.
   */
  refreshPicker();
}

function faceOption(name) {
  var node = el('span', name === current ? 'opt now' : 'opt', name);
  node.setAttribute('data-face-option', name);
  node.addEventListener('mouseenter', function () { armDwell(node, name); });
  node.addEventListener('mouseleave', cancelDwell);
  // A tap or click is an explicit choice: apply it at once rather than dwelling.
  // The choice rebuilds this node. A semantic press key lets the shared echo
  // gate consume the pointerup/mouseup/click tail on the replacement node.
  pressable(node, function () { cancelDwell(); applyFace(name); }, 'face:' + name);
  return node;
}

/** The puck, offered beside the faces. Choosing it leaves for its own page. */
function puckOption() {
  var node = el('span', 'opt', 'puck');
  node.setAttribute('data-face-option', 'puck');
  pressable(node, function () { cancelDwell(); leaveForPuck(); }, 'face:puck');
  return node;
}

function applyTransition(name) {
  if (TRANSITIONS.indexOf(name) === -1) return;
  // Keep pointer and remote navigation on the same semantic choice when the
  // menu repaints. The face is part of the identity because every face owns an
  // independent preference.
  if (!picker.hidden && picker.className.indexOf('mode-faces') >= 0) {
    var transitionChoices = picker.querySelectorAll('[data-transition-option]');
    var wanted = 'transition:' + current + ':' + name;
    for (var tc = 0; tc < transitionChoices.length; tc += 1) {
      if (transitionChoices[tc].getAttribute('data-picker-key') === wanted) {
        setPickerNavigation(transitionChoices[tc]);
        break;
      }
    }
  }
  if (name === transitionMode) return;
  transitionMode = name;
  rememberTransition(current, name);
  root.setAttribute('data-cover-transition', name);
  refreshPicker();
}

function transitionOption(name) {
  var label = name === 'random' ? 'tasteful random' : name;
  var node = el('span', name === transitionMode ? 'opt now' : 'opt', label);
  var key = 'transition:' + current + ':' + name;
  node.setAttribute('data-transition-option', name);
  node.setAttribute('data-picker-key', key);
  pressable(node, function () { applyTransition(name); }, key);
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
  var entry = function (icon, label, onPress) {
    var b = el('span', 'opt browse-entry');
    b.appendChild(glyph(icon));
    b.appendChild(document.createTextNode(label));
    b.setAttribute('aria-label', label);
    pressable(b, onPress, 'browse-entry:' + icon);
    return b;
  };
  var search = entry('search', 'search Roon', openRoonSearch);
  search.className += ' browse-search-entry';
  search.setAttribute('title', 'find artists, albums and tracks in your library and connected services');
  row.appendChild(search);
  row.appendChild(entry('explore', 'explore', function () { openHierarchy('browse', 'Explore'); }));
  row.appendChild(entry('genres', 'genres', function () { openHierarchy('genres', 'Genres'); }));
  row.appendChild(entry('albums', 'albums', function () { openHierarchy('albums', 'Albums'); }));
  row.appendChild(entry('artists', 'artists', function () { openHierarchy('artists', 'Artists'); }));
  row.appendChild(entry('composers', 'composers', function () { openHierarchy('composers', 'Composers'); }));
  row.appendChild(entry('playlists', 'playlists', function () { openHierarchy('playlists', 'Playlists'); }));
  row.appendChild(entry('radio', 'radio', function () { openHierarchy('internet_radio', 'Live radio'); }));
  row.appendChild(entry('recent', 'recent', openRecent));
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

/**
 * ⚖️ FACES WHOSE CHROME GOES BESIDE THE ARTWORK (Peter, 08-29: "get presence and
 * dial to work as elegantly now — keeping the main artwork and metadata blocks
 * but working controls around them without changing size or position").
 *
 * Measured at rest, both of them: the artwork is centred and the words run the
 * full width under it, so the space above and below is already spoken for — but
 * there are 429px of nothing to the LEFT of Dial's ring and 614px beside
 * Presence's sleeve, top to bottom, on both sides. That is where the controls
 * go, and then nothing has to move or shrink to make room for them.
 */
function hasFlank() {
  var l = layoutOf(current);
  // Canvas joins them: its artwork is centred and its words run under it, which
  // is the same shape — and at 22vw the picture is too big to leave room for a
  // band above it without taking size off it, which is the trade we do not make.
  return l === 'presence' || l === 'dial' || l === 'canvas';
}

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
  var muteOuts = [];
  if (zone !== null && zone.outputs.length > 1) {
    for (var gi = 0; gi < zone.outputs.length; gi += 1) {
      var go = zone.outputs[gi];
      if (go.volume !== null) muteOuts.push(go);
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
    var allMuted = true;
    for (var qi = 0; qi < muteOuts.length; qi += 1) if (!muteOuts[qi].volume.muted) allMuted = false;
    var masterSpeaker = groupVolumeSpeaker(zone, muteOuts, allMuted);
    volUi = {
      speaker: masterSpeaker, scale: master, outputId: groupOuts[0].id, group: true,
      scaleOutputIds: groupOuts.map(function (o) { return o.id; }),
    };
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
    var incSpeaker = volumeSpeaker(output);
    volUi = { speaker: incSpeaker, scale: null, outputId: output.id };
    controls.appendChild(incSpeaker);
    controls.appendChild(button('minus', 'quieter \u00B7 ' + output.name, true,
      function () { nudgeVolume(-1); }, 'volume-down:' + output.id));
    controls.appendChild(button('plus', 'louder \u00B7 ' + output.name, true,
      function () { nudgeVolume(1); }, 'volume-up:' + output.id));
  } else {
    var min = vol.min === null ? 0 : vol.min;
    var span = Math.max(1, vol.max - min);
    var level = Math.max(0, Math.min(1, (vol.value - min) / span));
    var speakerNode = volumeSpeaker(output);
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
  var zoneKey = zone === null ? '' : zone.id;
  var button = function (label, title, enabled, onPress, pressKey) {
    var b = el('span', enabled ? 'ctl' : 'ctl off');
    b.appendChild(glyph(label));
    b.setAttribute('title', title);
    b.setAttribute('aria-label', title);
    if (enabled) pressable(b, onPress, pressKey);
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
  var lit = function (name, title, on, onPress, pressKey) {
    var b = el('span', settings === null ? 'ctl off' : (on ? 'ctl lit' : 'ctl'));
    b.appendChild(glyph(name));
    b.setAttribute('title', title);
    b.setAttribute('aria-label', title);
    if (settings !== null) pressable(b, onPress, pressKey);
    return b;
  };
  controls.appendChild(lit('shuffle',
    settings !== null && settings.shuffle ? 'shuffle is on' : 'shuffle',
    settings !== null && settings.shuffle,
    function () { command({ action: 'shuffle', zone: zone.id }); }, 'shuffle:' + zoneKey));
  var previousBtn = button('prev', 'previous', zone !== null && zone.allowed.previous,
    function () { transport('previous'); }, 'previous:' + zoneKey);
  previousBtn.className += ' is-skip';
  controls.appendChild(previousBtn);
  /**
   * PLAY IS THE ONE YOU REACH FOR, so it is a little larger and a little
   * brighter than its neighbours — the same emphasis the wall card gives it.
   * Subtle on purpose: the row still has to read as one line of equals.
   */
  var playBtn = button(playing ? 'pause' : 'play', playing ? 'pause' : 'play',
    zone !== null && (zone.allowed.pause || zone.allowed.play), function () { transport('playpause'); },
    'playpause:' + zoneKey);
  playBtn.className += ' is-play';
  controls.appendChild(playBtn);
  var nextBtn = button('next', 'next', zone !== null && zone.allowed.next,
    function () { transport('next'); }, 'next:' + zoneKey);
  nextBtn.className += ' is-skip';
  controls.appendChild(nextBtn);

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
    function () { command({ action: 'repeat', zone: zone.id }); }, 'repeat:' + zoneKey));
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
 * The zones selected in the explicit group editor, in selection order.
 *
 * A Roon zone is the object the viewer sees: a solo output is one card and an
 * existing group is one card. The first selected zone leads, so its outputs are
 * flattened first when Group is pressed and its queue is the one Roon keeps.
 * Merely selecting never changes playback.
 */
var groupPick = [];

/** Open a fresh explicit selection. The X/outside press remains cancellation. */
function startGroupPick() {
  var here = currentZone();
  if (here === null) { flash('no room is available'); return; }
  var head = here.outputs.length > 0 ? here.outputs[0] : null;
  var canEdit = here.outputs.length > 1
    || (head !== null && head.island !== '' && head.groupableWith.length > 1);
  if (!canEdit) { flash(here.name + ' cannot be grouped'); return; }
  groupPick = [];
  showPicker('group');
}

/**
 * One owner for dissolving a whole group. Every visible Ungroup route comes
 * through here so the explicit button and the optional double-click shortcut
 * cannot drift into different control behaviour.
 */
function ungroupWhole(zone, reopenEditor) {
  if (zone === null || zone.outputs.length < 2) return;
  groupPick = [];
  if (!reopenEditor) picker.hidden = true;
  command({ action: 'ungroup', zone: zone.id });
  if (reopenEditor) {
    setTimeout(function () { if (!picker.hidden) startGroupPick(); }, 900);
  }
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

/** A visible verb on a room card: the card no longer hides what pressing does. */
function roomCardAction(node, mark, label) {
  var action = el('span', 'roomcard-action');
  action.appendChild(glyph(mark));
  action.appendChild(document.createTextNode(label));
  node.appendChild(action);
}

function zoneById(id) {
  var snap = store.snapshot();
  if (snap === null) return null;
  for (var i = 0; i < snap.zones.length; i += 1) if (snap.zones[i].id === id) return snap.zones[i];
  return null;
}

function outputInZone(zone, outputId) {
  if (zone === null || outputId === null) return null;
  for (var i = 0; i < zone.outputs.length; i += 1) {
    if (zone.outputs[i].id === outputId) return zone.outputs[i];
  }
  return null;
}

/** The room this display means when its current player is a multi-room zone. */
function displayedOutput(zone) {
  if (zone === null) return null;
  var preferred = lockedOutputId !== null ? lockedOutputId : boundOutputId;
  var exact = outputInZone(zone, preferred);
  return exact !== null ? exact : (zone.outputs.length > 0 ? zone.outputs[0] : null);
}

function hasPullSource(destination) {
  var snapshot = store.snapshot();
  if (snapshot === null || destination === null) return false;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    var zone = snapshot.zones[i];
    if (zone.id !== destination.id
        && zone.nowPlaying !== null && zone.outputs.length > 0) return true;
  }
  return false;
}

function startTransferFrom(zone) {
  if (lockedOutputId !== null || zone === null || zone.nowPlaying === null) return;
  var source = displayedOutput(zone);
  if (source === null) return;
  transferSourceOutputId = source.id;
  groupPick = [];
  showPicker('transfer');
}

function startPullInto(zone) {
  var destination = displayedOutput(zone);
  if (destination === null) return;
  pullDestinationOutputId = destination.id;
  showPicker('pull');
}

/*
 * DRAG A SOLO ROOM ONTO ANOTHER ROOM OR GROUP.
 *
 * This is deliberately an enhancement to the explicit Group editor, never a
 * second control protocol. A completed drop is already an explicit instruction,
 * so it sends one `group` call immediately. The drop target's outputs go first,
 * which keeps its queue and lets the dragged solo room join it.
 *
 * A small handle owns the gesture. The rest of the card remains a reliable
 * click/Enter target, and a touch can still scroll a long room list normally.
 */
var roomDrag = null;
var roomDragSuppressUntil = 0;
var ROOM_DRAG_ARM = 10;

function roomZoneIsland(zone) {
  if (zone === null || zone.outputs.length === 0) return '';
  var island = zone.outputs[0].island;
  if (island === '') return '';
  for (var i = 1; i < zone.outputs.length; i += 1) {
    if (zone.outputs[i].island !== island) return '';
  }
  return island;
}

function canDropRoom(source, target) {
  return source !== null && target !== null
    && source.id !== target.id
    // A group already owns a queue. Dragging it onto another group would make
    // queue ownership a guess, so v1 only picks up one honest room.
    && source.outputs.length === 1
    && target.outputs.length > 0
    && roomZoneIsland(source) !== ''
    && roomZoneIsland(source) === roomZoneIsland(target);
}

function roomDragPoint(event) {
  var touches = event && (event.touches || event.changedTouches);
  if (touches && touches.length > 0) return { x: touches[0].clientX, y: touches[0].clientY };
  return event && typeof event.clientX === 'number'
    ? { x: event.clientX, y: event.clientY } : null;
}

function roomDragGuide(message) {
  var guide = picker.querySelector('.room-drag-guide');
  if (guide !== null) guide.textContent = message;
}

var GROUP_HELP_TEXT = '2+ cards \u2192 group \u00B7 one group \u2192 ungroup'
  + ' \u00B7 drag chain \u2192 target leads';

/**
 * The grouping lesson belongs on the window's edge, not among the rooms. The
 * same popover becomes live drop feedback once a drag starts. Hover/focus opens
 * it for a pointer or keyboard; a press pins it for touch and TV remotes.
 */
function roomDragHelp(message) {
  var help = el('span', 'group-help');
  var tab = el('span', 'group-help-tab', '?');
  var guide = el('span', 'room-drag-guide', message);
  var pinned = false;
  var hovered = false;
  var focused = false;
  var paint = function () {
    var open = pinned || hovered || focused;
    help.className = open ? 'group-help is-open' : 'group-help';
    tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  guide.id = 'group-help-copy';
  guide.setAttribute('aria-live', 'polite');
  tab.setAttribute('title', 'how grouping works');
  tab.setAttribute('aria-label', 'how grouping works');
  tab.setAttribute('aria-controls', guide.id);
  tab.setAttribute('aria-expanded', 'false');
  pressable(tab, function () {
    pinned = !pinned;
    if (!pinned && tab.blur) tab.blur();
    paint();
  }, 'group-help');
  tab.addEventListener('mouseenter', function () { hovered = true; paint(); });
  tab.addEventListener('mouseleave', function () { hovered = false; paint(); });
  tab.addEventListener('focus', function () { focused = true; paint(); });
  tab.addEventListener('blur', function () { focused = false; paint(); });
  help.appendChild(tab);
  help.appendChild(guide);
  return help;
}

function roomDragCard(zoneId) {
  var cards = picker.querySelectorAll('[data-room-zone]');
  for (var i = 0; i < cards.length; i += 1) {
    if (cards[i].getAttribute('data-room-zone') === zoneId) return cards[i];
  }
  return null;
}

function bindRoomDragDocuments() {
  document.addEventListener('pointermove', moveRoomDrag, true);
  document.addEventListener('pointerup', endRoomDrag, true);
  document.addEventListener('pointercancel', cancelRoomDrag, true);
  document.addEventListener('mousemove', moveRoomDrag, true);
  document.addEventListener('mouseup', endRoomDrag, true);
  document.addEventListener('touchmove', moveRoomDrag, { passive: false, capture: true });
  document.addEventListener('touchend', endRoomDrag, true);
  document.addEventListener('touchcancel', cancelRoomDrag, true);
}

function unbindRoomDragDocuments() {
  document.removeEventListener('pointermove', moveRoomDrag, true);
  document.removeEventListener('pointerup', endRoomDrag, true);
  document.removeEventListener('pointercancel', cancelRoomDrag, true);
  document.removeEventListener('mousemove', moveRoomDrag, true);
  document.removeEventListener('mouseup', endRoomDrag, true);
  document.removeEventListener('touchmove', moveRoomDrag, true);
  document.removeEventListener('touchend', endRoomDrag, true);
  document.removeEventListener('touchcancel', cancelRoomDrag, true);
}

function startRoomDrag(event, zone, node) {
  if (roomDrag !== null || zone.outputs.length !== 1) return;
  if (typeof event.button === 'number' && event.button !== 0) return;
  var point = roomDragPoint(event);
  if (point === null) return;
  if (event.preventDefault) event.preventDefault();
  if (event.stopPropagation) event.stopPropagation();
  roomDrag = {
    sourceZoneId: zone.id,
    sourceOutputId: zone.outputs[0].id,
    sourceName: zone.outputs[0].name,
    node: node,
    startX: point.x,
    startY: point.y,
    x: point.x,
    y: point.y,
    armed: false,
    over: null,
    valid: {},
    ghost: null,
  };
  bindRoomDragDocuments();
}

function enableRoomDrag(node, zone) {
  node.setAttribute('data-room-zone', zone.id);
  if (zone.outputs.length !== 1 || roomZoneIsland(zone) === '') return;
  var handle = el('span', 'roomcard-drag');
  handle.appendChild(glyph('group'));
  handle.setAttribute('title', 'drag ' + zone.name + ' onto a room or group');
  handle.setAttribute('aria-label', handle.getAttribute('title'));
  var begin = function (event) { startRoomDrag(event, zone, node); };
  handle.addEventListener('pointerdown', begin);
  handle.addEventListener('mousedown', begin);
  handle.addEventListener('touchstart', begin, { passive: false });
  handle.addEventListener('contextmenu', function (event) { event.preventDefault(); });
  node.appendChild(handle);
}

function armRoomDrag() {
  if (roomDrag === null || roomDrag.armed) return;
  var source = zoneById(roomDrag.sourceZoneId);
  if (source === null || source.outputs.length !== 1) { cancelRoomDrag(); return; }
  roomDrag.armed = true;
  picker.classList.add('is-room-dragging');
  roomDrag.node.classList.add('drag-source');
  if (pickerTimer !== null) { clearTimeout(pickerTimer); pickerTimer = null; }

  var cards = picker.querySelectorAll('[data-room-zone]');
  for (var i = 0; i < cards.length; i += 1) {
    var targetId = cards[i].getAttribute('data-room-zone');
    if (targetId === source.id) continue;
    var target = zoneById(targetId);
    if (canDropRoom(source, target)) {
      roomDrag.valid[targetId] = true;
      cards[i].classList.add('drop-ok');
    } else {
      cards[i].classList.add('drop-no');
    }
  }

  roomDrag.ghost = el('div', 'room-drag-ghost', roomDrag.sourceName);
  document.body.appendChild(roomDrag.ghost);
  roomDragGuide('drop on a lit room · the drop target leads');
  moveRoomDragGhost();
}

function moveRoomDragGhost() {
  if (roomDrag === null || roomDrag.ghost === null) return;
  roomDrag.ghost.style.transform = 'translate(' + String(roomDrag.x + 18)
    + 'px, ' + String(roomDrag.y + 14) + 'px)';
}

function hitRoomDrag(x, y) {
  var hit = document.elementFromPoint(x, y);
  if (hit === null || hit.closest === undefined) return null;
  var card = hit.closest('[data-room-zone]');
  return card === null ? null : card.getAttribute('data-room-zone');
}

function hoverRoomDrag(zoneId) {
  if (roomDrag === null) return;
  if (roomDrag.over !== zoneId) {
    var old = roomDrag.over === null ? null : roomDragCard(roomDrag.over);
    if (old !== null) old.classList.remove('drop-hot');
    var next = zoneId === null ? null : roomDragCard(zoneId);
    if (next !== null && roomDrag.valid[zoneId] === true) next.classList.add('drop-hot');
    roomDrag.over = zoneId;
  }
  if (zoneId !== null && roomDrag.valid[zoneId] === true) {
    var target = zoneById(zoneId);
    if (target !== null) {
      roomDragGuide('release: ' + roomDrag.sourceName + ' joins ' + target.name
        + ' · ' + target.outputs[0].name + ' leads');
      return;
    }
  }
  roomDragGuide('drop on a lit room · the drop target leads');
}

function moveRoomDrag(event) {
  if (roomDrag === null) return;
  var point = roomDragPoint(event);
  if (point === null) return;
  roomDrag.x = point.x;
  roomDrag.y = point.y;
  var moved = Math.abs(point.x - roomDrag.startX) + Math.abs(point.y - roomDrag.startY);
  if (!roomDrag.armed && moved >= ROOM_DRAG_ARM) armRoomDrag();
  if (!roomDrag.armed) return;
  if (event.cancelable) event.preventDefault();
  moveRoomDragGhost();
  hoverRoomDrag(hitRoomDrag(point.x, point.y));
}

function teardownRoomDrag(suppressPress) {
  unbindRoomDragDocuments();
  if (roomDrag !== null && roomDrag.ghost !== null && roomDrag.ghost.parentNode !== null) {
    roomDrag.ghost.parentNode.removeChild(roomDrag.ghost);
  }
  picker.classList.remove('is-room-dragging');
  var cards = picker.querySelectorAll('[data-room-zone]');
  for (var i = 0; i < cards.length; i += 1) {
    cards[i].classList.remove('drag-source');
    cards[i].classList.remove('drop-ok');
    cards[i].classList.remove('drop-no');
    cards[i].classList.remove('drop-hot');
  }
  roomDrag = null;
  if (suppressPress) roomDragSuppressUntil = Date.now() + 650;
  roomDragGuide(GROUP_HELP_TEXT);
}

function cancelRoomDrag() {
  if (roomDrag === null) return;
  teardownRoomDrag(true);
}

function endRoomDrag(event) {
  if (roomDrag === null) return;
  var drag = roomDrag;
  var targetId = drag.armed ? drag.over : null;
  var allowed = targetId !== null && drag.valid[targetId] === true;
  var source = allowed ? zoneById(drag.sourceZoneId) : null;
  var target = allowed ? zoneById(targetId) : null;
  if (event && event.cancelable) event.preventDefault();
  if (event && event.stopPropagation) event.stopPropagation();
  teardownRoomDrag(true);
  if (!canDropRoom(source, target)) return;

  // Re-resolved from the latest snapshot: a drag can outlive a Roon zone id.
  // Selecting the target's durable output also makes its face follow the group
  // Roon is about to create instead of reporting the destroyed zone unavailable.
  shownZoneId = target.id;
  boundOutputId = target.outputs[0].id;
  following = false;
  var ids = target.outputs.map(function (o) { return o.id; });
  if (ids.indexOf(source.outputs[0].id) === -1) ids.push(source.outputs[0].id);
  groupPick = [];
  picker.hidden = true;
  command({ action: 'group', outputs: ids });
}

/**
 * What can be DONE with this room, as opposed to which room to look at. Only what
 * is actually possible is offered: no "ungroup" on a room that is not a group, no
 * "group" where Roon has no peer to offer, no "transfer to" with nothing playing.
 */
/** One compact icon-and-word action, shared by both grouping action rows. */
function pickerAction(mark, label, enabled, onPress, pressKey) {
  var b = el('span', enabled ? 'opt act' : 'opt act off');
  b.appendChild(glyph(mark));
  b.appendChild(document.createTextNode(label));
  b.setAttribute('title', label);
  b.setAttribute('aria-label', label);
  if (enabled) pressable(b, onPress, pressKey);
  return b;
}

/** Actions for the room currently on the display, outside the group editor. */
function zoneActionRow(here) {
  var row = el('div', 'row row-actions');
  if (here === null) return row;
  var island = here.outputs.length === 0 ? [] : here.outputs[0].groupableWith;
  var hasPeer = island.length > 1;
  var isGroup = here.outputs.length > 1;
  row.appendChild(pickerAction('group', 'edit', hasPeer, startGroupPick, 'group-edit:' + here.id));
  row.appendChild(pickerAction('ungroup', 'ungroup', isGroup,
    function () { ungroupWhole(here, false); }, 'group-ungroup:' + here.id));
  row.appendChild(pickerAction('transfer-to', 'transfer to',
    lockedOutputId === null && here.nowPlaying !== null,
    function () { startTransferFrom(here); }, 'group-transfer:' + here.id));
  row.appendChild(pickerAction('pull-from', 'pull from', hasPullSource(here),
    function () { startPullInto(here); }, 'group-pull:' + here.id));
  return row;
}

/** Resolve the live zone objects behind the ordered editor selection. */
function selectedGroupZones() {
  var zones = [];
  var alive = [];
  for (var i = 0; i < groupPick.length; i += 1) {
    var zone = zoneById(groupPick[i]);
    if (zone !== null && zone.outputs.length > 0) {
      alive.push(zone.id);
      zones.push(zone);
    }
  }
  groupPick = alive;
  return zones;
}

function groupZonesCompatible(first, next) {
  var firstIsland = roomZoneIsland(first);
  return firstIsland !== '' && firstIsland === roomZoneIsland(next);
}

/** Selection changes only the editor. Playback changes only through its verbs. */
function toggleGroupPick(zoneId) {
  var zone = zoneById(zoneId);
  if (zone === null || zone.outputs.length === 0) return;
  var at = groupPick.indexOf(zoneId);
  if (at !== -1) {
    groupPick.splice(at, 1);
  } else {
    var selected = selectedGroupZones();
    if (selected.length > 0 && !groupZonesCompatible(selected[0], zone)) {
      flash('Roon cannot group ' + zone.name + ' with ' + selected[0].name);
      return;
    }
    groupPick.push(zoneId);
  }
  paintGroupPick();
}

/** Repaint selection marks and actions without replacing the cards themselves. */
function paintGroupPick() {
  if (picker.hidden || picker.className.indexOf('mode-group') < 0) return;
  var selected = selectedGroupZones();
  var lead = selected.length === 0 ? null : selected[0];
  var cards = picker.querySelectorAll('[data-group-zone]');
  for (var i = 0; i < cards.length; i += 1) {
    var id = cards[i].getAttribute('data-group-zone');
    var at = groupPick.indexOf(id);
    var zone = zoneById(id);
    var unavailable = at === -1 && lead !== null
      && (zone === null || !groupZonesCompatible(lead, zone));
    cards[i].classList.remove('now');
    cards[i].classList.remove('is-lead');
    cards[i].classList.remove('off');
    if (at !== -1) cards[i].classList.add('now');
    if (at === 0) cards[i].classList.add('is-lead');
    if (unavailable) cards[i].classList.add('off');
    cards[i].setAttribute('aria-pressed', at === -1 ? 'false' : 'true');
    cards[i].setAttribute('aria-disabled', unavailable ? 'true' : 'false');
    var order = cards[i].querySelector('.group-pick-order');
    if (order !== null) order.textContent = at === -1 ? '' : String(at + 1);
  }
  var oldActions = picker.querySelector('.group-actions');
  if (oldActions !== null && oldActions.parentNode !== null) {
    oldActions.parentNode.replaceChild(groupEditorActionRow(), oldActions);
  }
}

/** The explicit Group button: first selected leads and therefore comes first. */
function commitGroupPick() {
  var zones = selectedGroupZones();
  if (zones.length < 2) return;
  var ids = [];
  for (var i = 0; i < zones.length; i += 1) {
    if (!groupZonesCompatible(zones[0], zones[i])) return;
    for (var j = 0; j < zones[i].outputs.length; j += 1) {
      if (ids.indexOf(zones[i].outputs[j].id) === -1) ids.push(zones[i].outputs[j].id);
    }
  }
  if (ids.length < 2) return;
  shownZoneId = zones[0].id;
  boundOutputId = zones[0].outputs[0].id;
  following = false;
  groupPick = [];
  picker.hidden = true;
  command({ action: 'group', outputs: ids });
}

function ungroupGroupPick() {
  var zones = selectedGroupZones();
  if (zones.length === 1 && zones[0].outputs.length > 1) ungroupWhole(zones[0], false);
}

function transferGroupPick() {
  var zones = selectedGroupZones();
  if (zones.length !== 1 || zones[0].nowPlaying === null || lockedOutputId !== null) return;
  startTransferFrom(zones[0]);
}

/** Group-editor verbs act on its selection rather than on an implicit room. */
function groupEditorActionRow() {
  var zones = selectedGroupZones();
  var row = el('div', 'row row-actions group-actions');
  var canGroup = zones.length > 1;
  for (var i = 1; i < zones.length; i += 1) {
    if (!groupZonesCompatible(zones[0], zones[i])) canGroup = false;
  }
  var oneGroup = zones.length === 1 && zones[0].outputs.length > 1;
  var canTransfer = lockedOutputId === null && zones.length === 1 && zones[0].nowPlaying !== null;
  row.appendChild(pickerAction('group', 'group', canGroup, commitGroupPick, 'group-commit'));
  row.appendChild(pickerAction('ungroup', 'ungroup', oneGroup, ungroupGroupPick, 'group-ungroup-picked'));
  row.appendChild(pickerAction('transfer-to', 'transfer to', canTransfer,
    transferGroupPick, 'group-transfer-picked'));
  return row;
}

/** Optional mouse shortcut; Fire TV always has the explicit Ungroup button. */
function bindGroupDoubleClick(node, zoneId) {
  node.addEventListener('dblclick', function (event) {
    if (event.stopPropagation) event.stopPropagation();
    if (event.preventDefault) event.preventDefault();
    var zone = zoneById(zoneId);
    if (zone !== null && zone.outputs.length > 1) ungroupWhole(zone, false);
  });
}

/* ---------- the live Roon queue ------------------------------------------------
 *
 * Queue is a forward window, not history: item zero is what Roon is playing and
 * the remaining rows are what it will play next.  FlightDeck's server owns the
 * subscription and exposes only a bounded projection; the face fetches that one
 * room when its Queue door is opened.
 */
var queueRequestEpoch = 0;
var queueLoadEpoch = 0;
var queueView = {
  zoneId: '', generation: '', revision: -1,
  loading: false, error: '', items: [], atLimit: false,
};

function queuePanelIsOpen(zoneId, epoch) {
  return epoch === queueRequestEpoch && !picker.hidden
    && picker.className.indexOf('mode-queue') >= 0
    && queueView.zoneId === zoneId;
}

function queueDuration(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) return '';
  var whole = Math.round(seconds);
  var minutes = Math.floor(whole / 60);
  var tail = String(whole % 60);
  return String(minutes) + ':' + (tail.length < 2 ? '0' : '') + tail;
}

function queueOption(item, index, zoneId) {
  var node = el('span', 'opt queuecard' + (index === 0 ? ' now is-current' : ''));
  node.setAttribute('data-queue-item', String(item.id || ''));
  var art = el('span', 'roomcard-art');
  if (item.art) {
    var img = document.createElement('img');
    img.alt = '';
    img.src = item.art;
    art.appendChild(img);
  } else {
    art.className += ' is-quiet';
    var note = browseIcon('note');
    if (note !== null) art.appendChild(note);
  }
  node.appendChild(art);
  var words = el('span', 'roomcard-text');
  words.appendChild(el('span', 'roomcard-name', item.title || '(untitled)'));
  var byline = [item.artist || '', item.album || ''].filter(function (part) { return part !== ''; }).join(' \u00B7 ');
  words.appendChild(el('span', 'roomcard-np', byline || (index === 0 ? 'playing now' : 'up next')));
  node.appendChild(words);
  var duration = queueDuration(item.lengthSec);
  if (duration !== '') node.appendChild(el('span', 'queue-duration', duration));
  if (index === 0) {
    node.setAttribute('role', 'listitem');
    node.setAttribute('aria-label', (item.title || 'current item') + ', playing now');
    node.appendChild(el('span', 'queue-now', 'now'));
  } else {
    node.setAttribute('title', 'play from ' + (item.title || 'this item'));
    node.setAttribute('aria-label', 'play from ' + (item.title || 'this queue item'));
    pressable(node, function () { selectQueueItem(zoneId, item); },
      'queue:' + zoneId + ':' + String(item.id || ''));
  }
  return node;
}

/** Build Queue's two children without disturbing the mounted picker shell. */
function queuePanelNodes() {
  var queueZone = currentZone();
  var queueGuide = queueZone === null ? 'Roon queue'
    : 'Roon queue \u00B7 ' + queueZone.name
      + (queueView.atLimit ? ' \u00B7 current + next 49' : '');
  var guide = el('div', 'move-guide queue-guide', queueGuide);
  var row = el('div', 'row row-column queue-list');
  if (queueView.loading) {
    row.appendChild(el('span', 'opt off queue-message', 'loading queue\u2026'));
  } else if (queueView.error !== '') {
    row.appendChild(el('span', 'opt off queue-message', queueView.error));
  } else if (queueView.items.length === 0) {
    row.appendChild(el('span', 'opt off queue-message', 'queue is empty'));
  } else {
    for (var q = 0; q < queueView.items.length; q += 1) {
      row.appendChild(queueOption(queueView.items[q], q, queueView.zoneId));
    }
  }
  return [guide, row];
}

/**
 * A local Queue response must not unmount and rebuild the whole dropdown. On a
 * fast LAN that blank compositor frame reads as a flicker. Replace only the
 * contents that changed; the panel, its geometry and its focus rail stay put.
 */
function paintQueuePanel() {
  if (picker.hidden || picker.className.indexOf('mode-queue') < 0) return;
  var oldGuide = picker.querySelector('.queue-guide');
  var oldRow = picker.querySelector('.queue-list');
  if (oldGuide === null || oldRow === null) { showPicker('queue', true); return; }
  var preservedNavigation = pickerNavigationIdentity(pickerNavigationCurrent);
  var nodes = queuePanelNodes();
  var scrollTop = oldRow.scrollTop;
  var replacements = [];
  while (nodes[1].firstChild !== null) replacements.push(nodes[1].removeChild(nodes[1].firstChild));
  oldGuide.textContent = nodes[0].textContent;
  oldRow.replaceChildren.apply(oldRow, replacements);
  oldRow.scrollTop = scrollTop;
  seedPickerNavigation(preservedNavigation);
}

function selectQueueItem(zoneId, item) {
  var snapshot = store.snapshot();
  var zone = currentZone();
  if (snapshot === null || zone === null || zone.id !== zoneId
      || queueView.zoneId !== zoneId || queueView.generation !== snapshot.generation
      || !Number.isInteger(queueView.revision) || queueView.revision < 0) {
    flash('the room changed — reopen Queue');
    return;
  }
  fetch('/api/v1/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zone: zoneId,
      itemId: String(item.id || ''),
      generation: queueView.generation,
      queueRevision: queueView.revision,
    }),
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (data) {
      flash(data.error || ('queue selection failed (' + response.status + ')'));
      return false;
    });
    picker.hidden = true;
    flash('playing from ' + (item.title || 'the queue'));
    return true;
  }).catch(function () { flash('could not reach FlightDeck'); });
}

function loadQueue(zoneId, epoch, attempt) {
  if (attempt === 0) queueLoadEpoch = epoch;
  fetch('/api/v1/queue?zone=' + encodeURIComponent(zoneId), { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) return response.json().catch(function () { return {}; }).then(function (data) {
        throw new Error(data.error || ('queue unavailable (' + response.status + ')'));
      });
      return response.json();
    }).then(function (data) {
      if (!queuePanelIsOpen(zoneId, epoch)) return;
      // The subscription is created as zones arrive.  On the first few hundred
      // milliseconds it may honestly be loading; wait in this one open panel,
      // never by adding another subscription.
      if (data.ready !== true && attempt < 8) {
        setTimeout(function () {
          if (queuePanelIsOpen(zoneId, epoch)) loadQueue(zoneId, epoch, attempt + 1);
        }, 250);
        return;
      }
      queueView.loading = false;
      queueView.error = data.ready === true ? '' : 'queue is still loading';
      queueView.items = Array.isArray(data.items) ? data.items : [];
      queueView.atLimit = data.atLimit === true;
      queueView.generation = typeof data.generation === 'string' ? data.generation : '';
      queueView.revision = typeof data.revision === 'number' && Number.isInteger(data.revision)
        ? data.revision : -1;
      if (data.ready === true && (queueView.generation === '' || queueView.revision < 0)) {
        queueView.error = 'queue changed — reopen Queue';
        queueView.items = [];
      }
      queueLoadEpoch = 0;
      paintQueuePanel();
    }).catch(function (error) {
      if (!queuePanelIsOpen(zoneId, epoch)) return;
      queueView.loading = false;
      queueView.error = String(error && error.message ? error.message : error);
      queueView.items = [];
      queueView.atLimit = false;
      queueView.generation = '';
      queueView.revision = -1;
      queueLoadEpoch = 0;
      paintQueuePanel();
    });
}

function openQueuePanel(refreshing) {
  var zone = currentZone();
  if (zone === null) { flash('no room is available'); return; }
  var epoch = ++queueRequestEpoch;
  queueView = {
    zoneId: zone.id, generation: '', revision: -1,
    loading: true, error: '', items: [], atLimit: false,
  };
  showPicker('queue', refreshing === true);
  loadQueue(zone.id, epoch, 0);
}

/** Refresh an open queue without flashing its useful rows back to Loading. */
function refreshQueuePanel() {
  var zone = currentZone();
  if (zone === null) return;
  if (queueView.zoneId !== zone.id) { openQueuePanel(true); return; }
  if (queueLoadEpoch === queueRequestEpoch) return;
  var epoch = ++queueRequestEpoch;
  loadQueue(zone.id, epoch, 0);
}

/** Header menus stay viewport-owned: Face opens left; room actions open right. */
function headerPickerTrigger(mode) {
  if (mode === 'queue') return queueDoor;
  if (mode === 'rooms' || mode === 'transfer' || mode === 'pull') return zoneName;
  if (mode === 'group') return groupDoor;
  if (mode === 'faces') return cog;
  return null;
}

function positionHeaderPicker(mode) {
  var trigger = headerPickerTrigger(mode);
  if (trigger === null || picker.hidden) return;
  var rect = trigger.getBoundingClientRect();
  var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
  var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
  var safeX = Math.max(12, Math.round(viewportWidth * .05));
  var safeY = Math.max(10, Math.round(viewportHeight * .05));
  var width;
  if (mode === 'faces') width = Math.max(220, Math.min(420, viewportWidth * .21));
  else if (mode === 'group') width = Math.max(480, Math.min(720, viewportWidth * .38));
  else width = Math.max(360, Math.min(620, viewportWidth * .34));
  width = Math.min(width, viewportWidth - (safeX * 2));
  var left;
  // Face belongs to the artwork/Wall side. Every music-geography menu belongs
  // to the Queue | Room | Group side. Fixed safe-edge ownership also survives
  // artist photographs and live room names changing the trigger widths.
  if (mode === 'faces') left = safeX;
  else left = viewportWidth - safeX - width;
  left = Math.max(safeX, Math.min(viewportWidth - safeX - width, left));
  var top = Math.max(safeY, Math.round(rect.bottom + 8));
  picker.style.position = 'fixed';
  picker.style.left = Math.round(left) + 'px';
  picker.style.right = 'auto';
  picker.style.top = top + 'px';
  picker.style.bottom = 'auto';
  picker.style.width = Math.round(width) + 'px';
  picker.style.maxWidth = 'none';
  picker.style.maxHeight = Math.max(160, viewportHeight - top - safeY) + 'px';
  picker.style.webkitTransform = 'none';
  picker.style.transform = 'none';
}

function clearHeaderPickerPosition() {
  picker.style.position = '';
  picker.style.left = '';
  picker.style.right = '';
  picker.style.top = '';
  picker.style.bottom = '';
  picker.style.width = '';
  picker.style.maxWidth = '';
  picker.style.maxHeight = '';
  picker.style.webkitTransform = '';
  picker.style.transform = '';
}

function repositionHeaderPicker() {
  if (picker.hidden || picker.className.indexOf('header-menu') < 0) return;
  var open = /mode-([a-z]+)/.exec(picker.className);
  if (open !== null) positionHeaderPicker(open[1]);
}
window.addEventListener('resize', repositionHeaderPicker);
window.addEventListener('orientationchange', function () { setTimeout(repositionHeaderPicker, 140); });

function presentPicker(nodes, mode, refreshing, preservedNavigation) {
  var trigger = headerPickerTrigger(mode);
  var headerOwned = trigger !== null && root.getAttribute('data-size') === null;
  // A header menu must not inherit the artwork/copy transform beneath it.  That
  // exact ancestry was what let artist view carry Search off screen.
  var host = headerOwned ? document.body
    : (root.getAttribute('data-idle') === '1' ? pickerHome : (hasShelf() ? copy : pickerHome));
  if (picker.parentNode !== host) host.appendChild(picker);
  picker.replaceChildren.apply(picker, nodes);
  picker.className = 'picker mode-' + mode
    + (mode === 'faces' ? ' face-picker-vertical' : '')
    + (headerOwned ? ' header-menu' : '');
  picker.hidden = false;
  if (headerOwned) positionHeaderPicker(mode);
  else clearHeaderPickerPosition();
  seedPickerNavigation(refreshing ? preservedNavigation : '');
  if (!refreshing) {
    panelShownAt = Date.now();
    if (pickerTimer !== null) clearTimeout(pickerTimer);
    var linger = (mode === 'group' || mode === 'transfer' || mode === 'pull'
      || mode === 'rooms' || mode === 'queue') ? 22000 : 8000;
    pickerTimer = setTimeout(function () { picker.hidden = true; }, linger);
  }
}

function showPicker(mode, refreshing) {
  cancelDwell();
  mode = mode || 'transport';
  refreshing = refreshing === true;
  var preservedNavigation = refreshing ? pickerNavigationIdentity(pickerNavigationCurrent) : '';
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
    // A room chooser is a scrollable LIST, not a centred face-card runway. The
    // old horizontal row clipped later rooms on TV viewports and made them look
    // absent even though they were present in the snapshot.
    var roomRow = el('div', 'row row-faces row-column');
    var snapshot = store.snapshot();
    var zones = snapshot === null ? [] : snapshot.zones;
    var here = currentZone();
    /**
     * A LOCKED SCREEN DOES NOT OFFER OTHER ROOMS — that is the whole point of
     * locking it. It still shows the room it is bound to, and it still gets the
     * group and Pull From actions, because both keep this display on its locked
     * output. Transfer To is disabled: its contract is to leave this player.
     */
    if (lockedOutputId !== null) {
      if (here !== null) roomRow.appendChild(roomOption(here, 'now is-playing', null));
      roomRow.appendChild(el('span', 'opt off', 'locked to this room'));
      nodes.push(roomRow);
      nodes.push(zoneActionRow(here));
      presentPicker(nodes, mode, refreshing, preservedNavigation);
      return;
    }
    for (var r = 0; r < zones.length; r += 1) {
      if (zones[r].outputs.length === 0) continue;
      (function (z) {
        var isCurrent = here !== null && z.id === here.id;
        var opt = roomOption(z,
          (isCurrent ? 'now' : '') + (z.state === 'playing' ? ' is-playing' : ''),
          function () {
            // Every card in the Rooms picker means the same thing: make this
            // zone the player on screen. Group editing belongs to the separate
            // chain/count door, even when this zone already contains a group.
            shownZoneId = z.id;
            // Release the OLD room binding by replacing it with the room just
            // chosen. A zone id dies when Roon groups; this output id survives
            // and leads the display into the newly created group.
            boundOutputId = z.outputs.length > 0 ? z.outputs[0].id : null;
            following = false;
            picker.hidden = true;
            var snap = store.snapshot();
            if (snap !== null) render(snap, 'snapshot');
          });
        enableRoomDrag(opt, z);
        roomRow.appendChild(opt);
      })(zones[r]);
    }
    var wall = el('span', 'opt', 'the wall');
    pressable(wall, goToWall, 'picker-wall');
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
   * Every live Roon zone is shown once: an existing group is one choice, not a
   * row per output. Nothing is implicitly selected. The first explicit choice
   * becomes the leader when Group is pressed, so its queue is the one Roon keeps.
   */
  if (mode === 'group') {
    var liveHead = currentZone();
    var liveRow = el('div', 'row row-faces row-column');
    var liveSnapshot = store.snapshot();
    var liveZones = liveSnapshot === null ? [] : liveSnapshot.zones;
    var liveOrdered = [];
    if (liveHead !== null) liveOrdered.push(liveHead);
    for (var lo = 0; lo < liveZones.length; lo += 1) {
      if (liveHead === null || liveZones[lo].id !== liveHead.id) liveOrdered.push(liveZones[lo]);
    }
    for (var lg = 0; lg < liveOrdered.length; lg += 1) {
      (function (z) {
        // Empty zones are dead snapshot husks, not choices. Compatibility is
        // evaluated against the first explicit selection by paintGroupPick();
        // hiding alternatives up front made the editor look inert and broke the
        // promise that every current Roon room/group appears exactly once.
        if (z.outputs.length === 0) return;
        var selectedAt = groupPick.indexOf(z.id);
        var extra = (liveHead !== null && z.id === liveHead.id ? 'is-current' : '')
          + (z.state === 'playing' || z.state === 'loading' ? ' is-playing' : '')
          + (selectedAt !== -1 ? ' now' : '') + (selectedAt === 0 ? ' is-lead' : '');
        var opt = roomOption(z, extra.replace(/^\s+|\s+$/g, ''), function () { toggleGroupPick(z.id); });
        opt.setAttribute('data-group-zone', z.id);
        opt.setAttribute('aria-pressed', selectedAt === -1 ? 'false' : 'true');
        if (z.outputs.length > 1) {
          opt.className += ' is-group';
          roomCardAction(opt, 'group', String(z.outputs.length) + ' rooms');
          opt.setAttribute('title', 'select ' + z.name + ' \u00B7 double click to ungroup');
          bindGroupDoubleClick(opt, z.id);
        } else {
          opt.setAttribute('title', 'select ' + z.name);
        }
        enableRoomDrag(opt, z);
        opt.appendChild(el('span', 'group-pick-order', selectedAt === -1 ? '' : String(selectedAt + 1)));
        liveRow.appendChild(opt);
      })(liveOrdered[lg]);
    }
    nodes.push(liveRow);
    nodes.push(groupEditorActionRow());
    nodes.push(roomDragHelp(GROUP_HELP_TEXT));
  }


  /** TRANSFER TO: move this queue away, then follow its confirmed destination. */
  if (mode === 'transfer') {
    var snap3 = store.snapshot();
    var fromZone = lockedOutputId === null ? zoneForOutputId(snap3, transferSourceOutputId) : null;
    var fromName = fromZone === null ? 'this player' : fromZone.name;
    var transferGuide = el('div', 'move-guide', 'Choose a player. The current queue from ' + fromName
      + ' moves there; after Roon confirms the transfer, this display switches to that player.');
    var toRow = el('div', 'row row-faces row-column');
    var others = snap3 === null ? [] : snap3.zones;
    for (var x = 0; x < others.length; x += 1) {
      (function (z) {
        if (fromZone === null || z.id === fromZone.id || z.outputs.length === 0) return;
        var destinationOutputId = z.outputs[0].id;
        var destinationZoneId = z.id;
        var destination = roomOption(z, '', function () {
          picker.hidden = true;
          command({ action: 'transfer', zone: fromZone.id, output: destinationOutputId }).then(function (ok) {
            if (!ok || lockedOutputId !== null) return;
            // Transfer is the move-away verb: only a successful Core response may
            // make the display follow the destination. The output, not its
            // disposable zone id, is the durable anchor.
            boundOutputId = destinationOutputId;
            var live = store.snapshot();
            var owner = zoneForOutputId(live, destinationOutputId);
            shownZoneId = owner === null ? destinationZoneId : owner.id;
            following = false;
            if (live !== null) render(live, 'snapshot');
          });
        });
        destination.setAttribute('title', 'transfer ' + fromZone.name + ' to ' + z.name);
        destination.setAttribute('aria-label', 'transfer the current music from ' + fromZone.name
          + ' to ' + z.name + ' and switch this display to ' + z.name);
        roomCardAction(destination, 'transfer-to', 'transfer here');
        toRow.appendChild(destination);
      })(others[x]);
    }
    nodes.push(transferGuide);
    nodes.push(toRow);
  }

  /** PULL FROM: choose retained music elsewhere and bring it to this durable room. */
  if (mode === 'pull') {
    var pullSnapshot = store.snapshot();
    var targetOutputId = lockedOutputId !== null ? lockedOutputId : pullDestinationOutputId;
    var pullZone = zoneForOutputId(pullSnapshot, targetOutputId);
    var pullOutput = outputInZone(pullZone, targetOutputId);
    var pullName = pullZone === null ? 'this player' : pullZone.name;
    var pullGuide = el('div', 'move-guide', 'Choose a player with content. Its queue moves to '
      + pullName + ', FlightDeck makes sure it is playing here, and this display stays here.');
    var fromRow = el('div', 'row row-faces row-column');
    var pullZones = pullSnapshot === null ? [] : pullSnapshot.zones;
    var pullChoices = 0;
    for (var p = 0; p < pullZones.length; p += 1) {
      (function (source) {
        if (pullZone === null || pullOutput === null || source.id === pullZone.id
            || source.nowPlaying === null || source.outputs.length === 0) return;
        pullChoices += 1;
        var sourceClass = source.state === 'playing' || source.state === 'loading' ? 'is-playing' : '';
        var sourceCard = roomOption(source, sourceClass, function () {
          picker.hidden = true;
          // Pull's destination never changes: install its durable output before
          // the transaction so a successor snapshot cannot make this display
          // follow the source that was just selected.
          shownZoneId = pullZone.id;
          boundOutputId = pullOutput.id;
          following = false;
          command({
            action: 'pull',
            from: source.id,
            output: pullOutput.id,
            generation: pullSnapshot.generation,
            revision: pullSnapshot.revision,
          });
        });
        sourceCard.setAttribute('title', 'pull from ' + source.name + ' to ' + pullName);
        sourceCard.setAttribute('aria-label', 'pull the music in ' + source.name
          + ' to ' + pullName + ' and keep this display here');
        roomCardAction(sourceCard, 'pull-from', 'pull from');
        fromRow.appendChild(sourceCard);
      })(pullZones[p]);
    }
    if (pullChoices === 0) fromRow.appendChild(el('span', 'opt off', 'no other player has content'));
    nodes.push(pullGuide);
    nodes.push(fromRow);
  }

  if (mode === 'queue') {
    var queueNodes = queuePanelNodes();
    nodes.push(queueNodes[0]);
    nodes.push(queueNodes[1]);
  }

  if (mode === 'faces') {
    var faceRow = el('div', 'row row-faces');
    for (var f = 0; f < FACES.length; f += 1) faceRow.appendChild(faceOption(FACES[f]));
    faceRow.appendChild(puckOption());
    nodes.push(faceRow);
    nodes.push(el('div', 'move-guide transition-guide',
      'Cover transition for ' + current + ' · Random never repeats immediately'));
    var transitionRow = el('div', 'row row-faces row-transitions');
    for (var fx = 0; fx < TRANSITIONS.length; fx += 1) {
      transitionRow.appendChild(transitionOption(TRANSITIONS[fx]));
    }
    nodes.push(transitionRow);
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
  presentPicker(nodes, mode, refreshing, preservedNavigation);
}

// Hovering anywhere in the strip holds it open — it must not vanish mid-choice.
picker.addEventListener('mouseenter', function () {
  if (pickerTimer !== null) { clearTimeout(pickerTimer); pickerTimer = null; }
});
picker.addEventListener('mouseleave', function () {
  if (roomDrag !== null) return;
  cancelDwell();
  if (pickerTimer !== null) clearTimeout(pickerTimer);
  pickerTimer = setTimeout(function () { picker.hidden = true; }, 1500);
});
/**
 * ⚖️ REDRAW WHAT IS OPEN; RAISE NOTHING (Peter, 08-29: "on transition between
 * skins I get a large box with control buttons popping up — it should not").
 *
 * Four places called `showPicker()` bare, which means TRANSPORT mode. When the
 * chrome was a thin strip along the bottom that was a courtesy — press a key on
 * a remote and the controls appear so you can see what you did. Now every panel
 * is a window on the screen, and the same call threw a boxful of buttons over
 * the artwork on every face change, every artwork reset and every follow toggle.
 *
 * So: if a panel is open it is redrawn in its own mode, keeping the faces list
 * showing the new choice. If none is open, none opens.
 */
function refreshPicker() {
  if (picker.hidden) return;
  var open = /mode-([a-z]+)/.exec(picker.className);
  showPicker(open === null ? 'faces' : open[1], true);
}

/**
 * A room/group/transfer/pull window is a view of the live zone graph. Rebuild it on
 * structural snapshots so an external regroup cannot leave vanished cards or
 * stale enabled verbs behind. Seek ticks do not touch it, and this refresh keeps
 * both the explicit selection and the original close deadline.
 */
function refreshStructuralPicker(kind) {
  if ((kind !== 'snapshot' && kind !== 'update') || picker.hidden) return;
  var open = /mode-([a-z]+)/.exec(picker.className);
  if (open === null) return;
  var mode = open[1];
  if (mode === 'queue') {
    refreshQueuePanel();
  } else if (mode === 'group' || mode === 'rooms' || mode === 'transfer' || mode === 'pull') {
    showPicker(mode, true);
  }
}

function cycleFace(delta) {
  var index = FACES.indexOf(current);
  applyFace(FACES[(index + delta + FACES.length) % FACES.length]);
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
    // Following belongs to the currently active music, not to one room.
    // A configured lock still wins; an ordinary session releases its anchor.
    if (lockedOutputId === null) boundOutputId = null;
    writeFlag(STORE_KEY_FOLLOW + zoneId, true);
    try { localStorage.removeItem(STORE_KEY_ZONE + zoneId); } catch (error) { /* private mode */ }
  } else {
    following = false;
    shownZoneId = chosen;
    // Replace the OLD room binding with the selected room's output. Keeping only
    // `chosen` would strand the display when Roon destroys that zone to group it.
    var chosenZone = zoneById(chosen);
    boundOutputId = chosenZone !== null && chosenZone.outputs.length > 0
      ? chosenZone.outputs[0].id : null;
    writeFlag(STORE_KEY_FOLLOW + zoneId, false);
    try { localStorage.setItem(STORE_KEY_ZONE + zoneId, chosen); } catch (error) { /* private mode */ }
  }
  viewStep = VIEW_ALBUM;
  artistIndex = -1;
  backdropKey = null;
  applyArtistView();
  render(snapshot, 'snapshot');
  refreshPicker();
}

function toggleFollow() {
  following = !following;
  writeFlag(STORE_KEY_FOLLOW + zoneId, following);
  if (following) {
    if (lockedOutputId === null) boundOutputId = null;
    try { localStorage.removeItem(STORE_KEY_ZONE + zoneId); } catch (error) { /* private mode */ }
    var snapshot = store.snapshot();
    if (snapshot !== null) render(snapshot, 'snapshot');
  }
  refreshPicker();
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
 * A semantic key can outlive a rebuilt control node — essential for shuffle,
 * whose own state update replaces the button before Fire TV finishes emitting
 * pointerup/mouseup/click for the original press.
 */
var pressEchoAt = {};
var PRESS_ECHO_MS = 800;

function pressable(node, onPress, pressKey) {
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
    if (event && event.type !== 'keyup') {
      if ((roomDrag !== null && roomDrag.armed) || Date.now() < roomDragSuppressUntil) return;
    }
    if (event && event.type === 'keyup') {
      var keyCode = event.keyCode || event.which || 0;
      var key = event.key || '';
      if (key !== 'Enter' && key !== ' ' && keyCode !== 13 && keyCode !== 32) return;
    }
    if (event && event.type === 'touchend' && touchStart !== null) {
      var t = event.changedTouches && event.changedTouches[0];
      if (t) {
        var moved = Math.abs(t.clientX - touchStart.x) + Math.abs(t.clientY - touchStart.y);
        touchStart = null;
        if (moved > 12) return;        // a drag, not a tap
      }
    }
    var now = Date.now();
    var echoed = now - last < 400;
    if (pressKey !== undefined && pressKey !== '') {
      var previous = pressEchoAt[pressKey];
      if (previous !== undefined && now - previous < PRESS_ECHO_MS) echoed = true;
    }
    if (echoed) {
      // Consume the compatibility event too. Letting a rejected mouseup bubble
      // can open a different control surface under the same physical press.
      if (event && event.stopPropagation) event.stopPropagation();
      if (event && event.preventDefault && event.type !== 'touchend') event.preventDefault();
      return;
    }
    // The touch that summoned a panel must not fall through onto a control that
    // appeared beneath it — the cause of music starting at random.
    if (panelJustAppeared()) return;
    last = now;
    if (pressKey !== undefined && pressKey !== '') pressEchoAt[pressKey] = now;
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
 * MUTE IS AN ACTION, not an end of the volume scale. Its own diagonal-slash
 * mark stays distinct from both the quiet and loud speaker buttons; the filled
 * accent frame still says when mute is currently engaged.
 */
function glyphMute() {
  var svg = glyphSpeaker(0, false);
  var slash = document.createElementNS(SVG_NS, 'path');
  slash.setAttribute('fill', 'none');
  slash.setAttribute('stroke', 'currentColor');
  slash.setAttribute('stroke-width', '2.5');
  slash.setAttribute('stroke-linecap', 'round');
  slash.setAttribute('d', 'M4.7 4.7l14.8 14.8');
  svg.appendChild(slash);
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
  if (item.rejoinLive === true) return 'radio';
  // Live Radio stations are action leaves, but their action is "play this
  // station", not a generic Play/Shuffle verb. Classify the hierarchy first so
  // a station whose artwork is unavailable still gets the broadcast mark.
  if (hierarchy === 'internet_radio') return 'radio';
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
      /* A matched pair: current music goes right, other music comes left. */
      'transfer-to': [
        'M4.5 12h14.2',
        'M14.5 7.8 18.9 12l-4.4 4.2',
      ],
      'pull-from': [
        'M19.5 12H5.3',
        'M9.5 7.8 5.1 12l4.4 4.2',
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
      search: [
        'M10.8 4.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 1 0 0-12.6',
        'M15.4 15.4 20 20',
      ],
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
var browseNavigationCurrent = null;
var browseEpoch = 0;
var browsePending = false;
var browseOkHeldUntil = 0;

/** A new root/query invalidates every callback and selection from the old one. */
function beginBrowse(context) {
  browseEpoch += 1;
  browseCtx = context;
  browsePending = false;
  browsePaging = false;
  return browseEpoch;
}

function browseIsCurrent(epoch, context, node) {
  if (epoch !== browseEpoch || context !== browseCtx || browsePanel === null) return false;
  return node === undefined || inNode(node, browsePanel);
}

function browseCall(body) {
  return fetch('/api/v1/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (result) {
      if (!r.ok) throw new Error(result.error || ('browse failed ' + String(r.status)));
      return result;
    });
  });
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
  browseEpoch += 1;
  browsePending = false;
  browsePaging = false;
  setBrowseNavigation(null);
  if (browsePanel !== null) { browsePanel.parentNode.removeChild(browsePanel); browsePanel = null; }
  browseCtx = null;
}

/** Enabled Browse controls in the order a Fire TV D-pad walks them. */
function browseNavigationChoices() {
  if (browsePanel === null) return [];
  var nodes = browsePanel.querySelectorAll('[role="button"]');
  var choices = [];
  for (var i = 0; i < nodes.length; i += 1) {
    var classes = ' ' + (nodes[i].getAttribute('class') || '') + ' ';
    if (nodes[i].getAttribute('aria-disabled') === 'true' || classes.indexOf(' off ') !== -1) continue;
    choices.push(nodes[i]);
  }
  return choices;
}

function browseNavigationIdentity(node) {
  if (node === null) return '';
  var names = ['data-browse-key', 'aria-label', 'title'];
  for (var i = 0; i < names.length; i += 1) {
    var value = node.getAttribute(names[i]);
    if (value !== null && value !== '') return names[i] + ':' + value;
  }
  return 'text:' + String(node.textContent || '').replace(/^\s+|\s+$/g, '');
}

function setBrowseNavigation(node) {
  if (browseNavigationCurrent !== null) browseNavigationCurrent.classList.remove('browse-key-current');
  browseNavigationCurrent = node;
  if (node === null) return;
  node.classList.add('browse-key-current');
  try { node.focus(); } catch (error) { /* visible current mark still works */ }
  if (typeof node.scrollIntoView === 'function') {
    try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (error) { node.scrollIntoView(false); }
  }
}

/** Native focus wins over a stale internal cursor, especially on Search's Go. */
function browseNavigationIndex(choices) {
  var active = document.activeElement;
  for (var a = 0; a < choices.length; a += 1) {
    if (choices[a] === active) {
      if (browseNavigationCurrent !== active) setBrowseNavigation(active);
      return a;
    }
  }
  for (var i = 0; i < choices.length; i += 1) {
    if (choices[i] === browseNavigationCurrent) return i;
  }
  return -1;
}

/** Prefer a result row; header controls remain one Up press away. */
function seedBrowseNavigation(preferred) {
  var choices = browseNavigationChoices();
  if (choices.length === 0) { setBrowseNavigation(null); return null; }
  var chosen = null;
  if (preferred !== '') {
    for (var p = 0; p < choices.length; p += 1) {
      if (browseNavigationIdentity(choices[p]) === preferred) { chosen = choices[p]; break; }
    }
  }
  if (chosen === null) {
    for (var r = 0; r < choices.length; r += 1) {
      if ((' ' + choices[r].className + ' ').indexOf(' browse-row ') !== -1) {
        chosen = choices[r];
        break;
      }
    }
  }
  if (chosen === null) chosen = choices[0];
  setBrowseNavigation(chosen);
  return chosen;
}

function moveBrowseNavigation(delta) {
  var choices = browseNavigationChoices();
  if (choices.length === 0) return false;
  var at = browseNavigationIndex(choices);
  if (at === -1) setBrowseNavigation(delta < 0 ? choices[choices.length - 1] : choices[0]);
  else setBrowseNavigation(choices[(at + delta + choices.length) % choices.length]);
  return true;
}

function activateBrowseNavigation() {
  var choices = browseNavigationChoices();
  if (browseNavigationIndex(choices) === -1 && seedBrowseNavigation('') === null) return false;
  if (typeof browseNavigationCurrent.click === 'function') browseNavigationCurrent.click();
  return true;
}

/** Browse owns its vertical D-pad and centre press; left is a conventional Back. */
function handleBrowseNavigation(name, event) {
  if (browsePanel === null) return false;
  if (name === 'up') return moveBrowseNavigation(-1);
  if (name === 'down') return moveBrowseNavigation(1);
  if (name === 'ok') {
    var now = Date.now();
    // Android repeats keydown while Select is held. Extend the latch on every
    // repeat, and release it only on keyup, so one hold can cross one level only.
    if ((event && event.repeat === true) || now < browseOkHeldUntil) {
      browseOkHeldUntil = now + PRESS_ECHO_MS;
      return true;
    }
    browseOkHeldUntil = now + PRESS_ECHO_MS;
    return activateBrowseNavigation();
  }
  if (name === 'left') {
    if (browseCtx !== null && browseCtx.trail.length > 1) browseBack();
    return true;
  }
  // Never let Right change the face behind an open Browse window.
  if (name === 'right') return true;
  return false;
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
  /**
   * Dial and Orbit are composed around the progress circle. Their old 21vw
   * flank could collapse a long artist/album cascade to one visible row; the
   * circle is both larger and already the viewer's focal point. Put the browse
   * window inside the ring itself. Rondo only borrows a small ring around its
   * sleeve, so it keeps the ordinary full-height cascade.
   */
  /**
   * The ring is INSIDE the cover, and the cover owns the album/artist press.
   * Mounting Browse in `dialBox` therefore made every press in the window bubble
   * into `flipArtwork`; artist view then moved the cover and carried the window
   * off the left edge with it. Keep the full central overlay, but make the viewport
   * the panel's positioning and event owner. Phone routes use their normal page
   * panel because their ring is deliberately not part of the compact layout.
   */
  var inMainCircle = root.getAttribute('data-ringlayout') === '1'
    && root.getAttribute('data-size') === null
    && root.getAttribute('data-idle') !== '1';
  var host = inMainCircle ? document.body
    : (root.getAttribute('data-idle') === '1' ? document.body
      : (hasShelf() ? copy : document.body));
  if (browsePanel === null) {
    browsePanel = el('div', 'browse');
    host.appendChild(browsePanel);
    // Any sign of life resets the clock, including simply scrolling a long list.
    ['pointermove', 'mousemove', 'scroll', 'click', 'touchstart', 'wheel', 'keydown', 'input']
      .forEach(function (kind) { browsePanel.addEventListener(kind, browseAlive, true); });
    // Browse may move between visual hosts as a face changes, so it also owns an
    // explicit event boundary. Stop only propagation: native input, voice
    // keyboard, scrolling and default form submission remain untouched.
    ['touchstart', 'click', 'pointerup', 'touchend', 'mouseup', 'keyup']
      .forEach(function (kind) {
        browsePanel.addEventListener(kind, function (event) { event.stopPropagation(); });
      });
  } else if (browsePanel.parentNode !== host) {
    host.appendChild(browsePanel);        // the face changed under an open panel
  }
  if (inMainCircle) browsePanel.setAttribute('data-over-ring', '1');
  else browsePanel.removeAttribute('data-over-ring');
  if (inMainCircle && root.getAttribute('data-view') === 'artist') {
    browsePanel.setAttribute('data-artist-rail', '1');
  } else {
    browsePanel.removeAttribute('data-artist-rail');
  }
  var head = el('div', 'browse-head');
  var back = el('span', canGoBack ? 'ctl small' : 'ctl small off');
  back.appendChild(glyph('left'));
  back.setAttribute('aria-label', 'back');
  if (canGoBack) pressable(back, browseBack, 'browse-back');
  head.appendChild(back);
  head.appendChild(el('span', 'browse-title', title));
  var shut = el('span', 'ctl small', '\u2715');
  shut.setAttribute('title', 'cancel browse');
  shut.setAttribute('aria-label', 'cancel browse');
  pressable(shut, closeBrowse, 'browse-close');
  head.appendChild(shut);
  var list = el('div', 'browse-list', 'loading\u2026');
  // The list and the alphabet rail share a row INSIDE the column panel. Making the
  // panel itself a row removed the list's height constraint, so it grew to its
  // content and pushed the rail thousands of pixels off screen.
  var body = el('div', 'browse-body');
  body.appendChild(list);
  setBrowseNavigation(null);
  browsePanel.replaceChildren(head, body);
  browseAlive();
  return list;
}

/**
 * Roon Search puts one library shortcut above its merged catalogue buckets.
 * `Joe Jackson · 1 Album` beside `Albums · 41 Results` is truthful but reads as
 * a contradiction on a television. Name the two scopes without guessing which
 * connected provider supplied an individual catalogue result.
 */
function browseResultSubtitle(item) {
  var subtitle = String(item.subtitle || '');
  var searchRoot = browseCtx !== null
    && browseCtx.hierarchy === 'search' && browseCtx.trail.length === 1;
  if (!searchRoot || subtitle === '') return subtitle;
  if (/^\d+\s+Results?$/.test(subtitle)) return subtitle + ' \u00B7 Roon catalogue';
  if (/^\d+\s+Albums?$/.test(subtitle)) return subtitle + ' \u00B7 my library';
  return subtitle;
}

function browseRow(item, onPick) {
  var row = el('div', 'browse-row');
  var itemIdentity = String(item.itemKey || item.title || '');
  row.setAttribute('data-browse-key', itemIdentity);
  if (item.intent) {
    row.setAttribute('title', item.intent);
    row.setAttribute('aria-label', item.intent);
  }
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
  var shownSubtitle = browseResultSubtitle(item);
  if (shownSubtitle) row.appendChild(el('span', 'browse-sub', shownSubtitle));
  var hierarchy = browseCtx === null ? 'browse' : browseCtx.hierarchy;
  pressable(row, function () { onPick(item); }, 'browse:' + hierarchy + ':' + itemIdentity);
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
  if (items.length === 0) {
    list.replaceChildren(el('div', 'browse-empty', 'nothing here'));
    if (browsePanel !== null && inNode(list, browsePanel)) seedBrowseNavigation('');
    return;
  }
  browseUniform = uniformIcon(items, browseCtx === null ? '' : browseCtx.hierarchy);
  // One row builder for both the first page and every page after it, so an icon
  // never appears on one and not the other.
  var rows = items.map(function (item) { return browseRow(item, onPick); });
  list.replaceChildren.apply(list, rows);
  if (browsePanel !== null && inNode(list, browsePanel)) seedBrowseNavigation('');
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

function browseAttachPaging(list, hierarchy, total, onPick, startOffset, epoch, context) {
  // After an alphabet jump the rows on screen begin partway down the list, so
  // paging continues from THERE rather than from the count of visible rows.
  var loaded = typeof startOffset === 'number'
    ? startOffset : list.querySelectorAll('.browse-row').length;
  var more = function () {
    if (!browseIsCurrent(epoch, context, list) || browsePaging || loaded >= total) return;
    browsePaging = true;
    var marker = el('div', 'browse-empty', 'loading\u2026');
    list.appendChild(marker);
    browseCall({ hierarchy: hierarchy, load: true, count: PAGE, offset: loaded, sessionKey: browseSessionKey })
      .then(function (data) {
        if (!browseIsCurrent(epoch, context, list)) return;
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
        if (!browseIsCurrent(epoch, context, list)) return;
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
  return browseCall({ hierarchy: hierarchy, load: true, count: 1, offset: offset, sessionKey: browseSessionKey })
    .then(function (data) {
      var items = data.items || [];
      return items.length > 0 ? items[0].title : null;
    });
}

/** The offset of the first item at or after `letter`, by bisection. */
function findLetter(hierarchy, letter, total, epoch, context, list, done) {
  var low = 0;
  var high = Math.max(0, total - 1);
  var best = null;
  var steps = 0;
  var step = function () {
    // The shared Roon Browse session is serial. Stop probing as soon as this
    // alphabet jump no longer owns the visible panel, rather than making an old
    // bisection delay the listener's newer Search or Browse request.
    if (!browseIsCurrent(epoch, context, list)) return;
    if (low > high || steps > 14) { done(best); return; }
    steps += 1;
    var mid = Math.floor((low + high) / 2);
    probeTitle(hierarchy, mid).then(function (title) {
      if (!browseIsCurrent(epoch, context, list)) return;
      if (title === null) { high = mid - 1; step(); return; }
      if (firstLetter(title) >= letter) { best = mid; high = mid - 1; }
      else { low = mid + 1; }
      step();
    }).catch(function () {
      if (browseIsCurrent(epoch, context, list)) done(best);
    });
  };
  step();
}

function alphabetRail(hierarchy, total, onPick) {
  var rail = el('div', 'alpha');
  var letters = ['#'].concat(LETTERS);
  for (var i = 0; i < letters.length; i += 1) {
    (function (letter) {
      var node = el('span', 'alpha-key', letter);
      pressable(node, function () { onPick(letter); }, 'browse-letter:' + letter);
      rail.appendChild(node);
    })(letters[i]);
  }
  return rail;
}

function browseDraw(result, epoch, context) {
  if (!browseIsCurrent(epoch, context) || context === null) return;
  // A new level owns its own pager. Any older list is detached and its fenced
  // completion cannot put the global paging latch back.
  browsePaging = false;
  var hierarchy = context.hierarchy;
  var listInfo = result.list || {};
  var heading = listInfo.title || context.trail[context.trail.length - 1] || 'Browse';
  if (hierarchy === 'search' && context.trail.length === 1) {
    heading = 'Search Roon \u00B7 library + catalogue';
  }
  var zone = currentZone();
  if (listInfo.hint === 'action_list' && zone !== null) heading += '  \u2192  ' + zone.name;
  var total = typeof listInfo.count === 'number' ? listInfo.count : 0;
  if (total > PAGE) heading += '   ' + total;
  var list = browseShell(heading, context.trail.length > 1);
  var pick = function (item) { browseInto(item); };
  // Only where it helps: a long list, and one Roon sorts alphabetically.
  var alphabetical = total > 150 && listInfo.hint !== 'action_list';
  if (alphabetical) {
    browsePanel.className = 'browse has-alpha';
    var body = browsePanel.querySelector('.browse-body');
    body.appendChild(alphabetRail(hierarchy, total, function (letter) {
      if (!browseIsCurrent(epoch, context, list)) return;
      list.replaceChildren(el('div', 'browse-empty', 'finding \u2026'));
      findLetter(hierarchy, letter, total, epoch, context, list, function (offset) {
        if (!browseIsCurrent(epoch, context, list)) return;
        if (offset === null) { list.replaceChildren(el('div', 'browse-empty', 'nothing under ' + letter)); return; }
        browseCall({ hierarchy: hierarchy, load: true, count: PAGE, offset: offset, sessionKey: browseSessionKey })
          .then(function (data) {
            if (!browseIsCurrent(epoch, context, list)) return;
            browseRows(list, data.items || [], pick);
            list.scrollTop = 0;
            if (total > offset + (data.items || []).length) {
              browseAttachPaging(list, hierarchy, total, pick,
                offset + (data.items || []).length, epoch, context);
            }
          });
      });
    }));
  } else {
    browsePanel.className = 'browse';
  }
  browseCall({ hierarchy: hierarchy, load: true, count: PAGE, sessionKey: browseSessionKey })
    .then(function (data) {
      if (!browseIsCurrent(epoch, context, list)) return;
      browseRows(list, data.items || [], pick);
      if (total > (data.items || []).length) {
        browseAttachPaging(list, hierarchy, total, pick, undefined, epoch, context);
      }
    })
    .catch(function () {
      if (browseIsCurrent(epoch, context, list)) {
        list.replaceChildren(el('div', 'browse-empty', 'could not load that'));
      }
    });
}

function openHierarchy(hierarchy, title) {
  var context = { hierarchy: hierarchy, trail: [title] };
  var epoch = beginBrowse(context);
  browseShell(title, false);
  browsePending = true;
  browseCall({ hierarchy: hierarchy, popAll: true, sessionKey: browseSessionKey })
    .then(function (result) {
      if (!browseIsCurrent(epoch, context)) return;
      browsePending = false;
      browseDraw(result, epoch, context);
    })
    .catch(function () {
      if (!browseIsCurrent(epoch, context)) return;
      browsePending = false;
      closeBrowse();
      flash('browse unavailable');
    });
}

function searchQuery(value) {
  return String(value || '').replace(/^\s+|\s+$/g, '');
}

/**
 * One honest Search entry point for both free discovery and remembered tracks.
 * It only draws Roon's result tree; playback still requires choosing an explicit
 * result and then an action inside that tree.
 */
function runRoonSearch(value, label) {
  var query = searchQuery(value);
  if (query === '') { flash('type an artist, album or track'); return false; }
  var shown = searchQuery(label) || query;
  var context = { hierarchy: 'search', trail: ['Search: ' + shown] };
  var epoch = beginBrowse(context);
  browseShell('Searching Roon for ' + shown, false);
  browsePending = true;
  browseCall({
    hierarchy: 'search',
    popAll: true,
    input: query,
    sessionKey: browseSessionKey,
  }).then(function (result) {
    if (!browseIsCurrent(epoch, context)) return;
    browsePending = false;
    browseDraw(result, epoch, context);
  }).catch(function () {
    if (!browseIsCurrent(epoch, context)) return;
    browsePending = false;
    closeBrowse();
    flash('search unavailable');
  });
  return true;
}

/** A real text field lets each platform supply its own keyboard, including Silk. */
function openRoonSearch() {
  beginBrowse(null);
  var list = browseShell('Search Roon \u00B7 library + connected services', false);
  browsePanel.className = 'browse has-search';
  list.className = 'browse-list browse-search-list';
  var search = el('div', 'browse-search');
  search.appendChild(el('div', 'browse-search-copy',
    'Find an artist, album or track across your library and connected services.'));
  var form = document.createElement('form');
  form.className = 'browse-search-form';
  var input = document.createElement('input');
  input.className = 'browse-search-input';
  input.type = 'search';
  input.maxLength = 400;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('enterkeyhint', 'search');
  input.setAttribute('placeholder', 'artist, album or track');
  input.setAttribute('aria-label', 'artist, album or track');
  var go = el('span', 'browse-search-go');
  go.appendChild(glyph('search'));
  go.appendChild(document.createTextNode('search'));
  var submitSearch = function () {
    if (!runRoonSearch(input.value, input.value)) {
      try { input.focus(); } catch (error) { /* the prompt remains visible */ }
    }
  };
  pressable(go, submitSearch, 'roon-search-submit');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitSearch();
  });
  form.appendChild(input);
  form.appendChild(go);
  search.appendChild(form);
  list.replaceChildren(search);
  setBrowseNavigation(null);
  // This runs inside the press which opened Search, so Fire TV may raise its
  // native keyboard while desktop and Samsung keyboards can type immediately.
  try { input.focus(); } catch (error) { /* selecting the field still works */ }
}

/**
 * A row carrying Roon's `action` hint is the leaf the listener deliberately
 * chose: Play Now, Add Next, Queue, Start Radio, or a station. Some Core builds
 * return a useful message and some return only `none`; the item hint is the
 * stable part of the contract. A `list` row is navigation and must stay open.
 */
function browseSelectionComplete(item, result) {
  if (result.isError === true) return false;
  return item.hint === 'action'
    || result.action === 'none'
    || result.action === 'message';
}

function browseInto(item) {
  if (browseCtx === null || browsePending) return;
  var context = browseCtx;
  var epoch = browseEpoch;
  browsePending = true;
  var zone = currentZone();
  var call = { hierarchy: context.hierarchy, itemKey: item.itemKey, sessionKey: browseSessionKey };
  if (zone !== null) call.zoneId = zone.id;
  browseCall(call).then(function (result) {
    if (!browseIsCurrent(epoch, context)) return;
    browsePending = false;
    // A successful final choice puts the window away. The X is cancellation;
    // hierarchy rows remain open because they still need another choice.
    if (browseSelectionComplete(item, result)) {
      flash(result.message || (item.title + ' \u2713'));
      closeBrowse();
      return;
    }
    if (result.isError === true) {
      flash(result.message || 'could not select that');
      return;
    }
    context.trail.push(item.title || 'Browse');
    browseDraw(result, epoch, context);
  }).catch(function () {
    if (!browseIsCurrent(epoch, context)) return;
    browsePending = false;
    flash('could not open that');
  });
}

function browseBack() {
  if (browseCtx === null || browseCtx.trail.length <= 1) { closeBrowse(); return; }
  if (browsePending) return;
  var context = browseCtx;
  var epoch = browseEpoch;
  context.trail.pop();
  browsePending = true;
  browseCall({ hierarchy: context.hierarchy, popLevels: 1, sessionKey: browseSessionKey })
    .then(function (result) {
      if (!browseIsCurrent(epoch, context)) return;
      browsePending = false;
      browseDraw(result, epoch, context);
    })
    .catch(function () {
      if (!browseIsCurrent(epoch, context)) return;
      browsePending = false;
      closeBrowse();
    });
}

/** The ordinary Recent row: remembered words become a fresh, honest Search. */
function recentTrackRow(t) {
  var line2 = String(t.line2 || '');
  var credit = line2.split(' / ')[0].replace(/^\s+|\s+$/g, '');
  var query = String(t.title || '') + (credit === '' ? '' : ' ' + credit);
  return {
    title: String(t.title || ''),
    line2: line2,
    artKey: typeof t.artKey === 'string' ? t.artKey : null,
    zoneName: String(t.zoneName || ''),
    at: String(t.at || ''),
    query: query,
    subtitle: (credit === '' ? '' : credit + ' \u00B7 ')
      + String(t.zoneName || '') + ' \u00B7 ' + new Date(t.at).toTimeString().slice(0, 5),
    intent: 'search Roon for ' + query,
  };
}

function searchRecentTrack(track) {
  runRoonSearch(track.query, track.title);
}

/**
 * A station item key is usable only in the fresh stack that produced it. Match
 * the remembered station artwork AND title first. If the station changed its
 * logo, an exact title is safe only when it names one current saved station.
 * Two same-named stations are ambiguity, never permission to guess.
 */
function recentStationMatch(track, stations) {
  var exactMatches = [];
  var titleMatches = [];
  for (var i = 0; i < stations.length; i += 1) {
    var station = stations[i];
    if (station === null || station.hint !== 'action'
        || typeof station.itemKey !== 'string' || station.itemKey === ''
        || String(station.title || '') !== track.title) continue;
    titleMatches.push(station);
    if (track.artKey !== null && station.imageKey === track.artKey) exactMatches.push(station);
  }
  // Multiple saved rows with the same title AND art are equivalent duplicates;
  // the current stack's first action is sufficient. Different artwork falls to
  // the unique-title rule and therefore remains ambiguous.
  if (exactMatches.length > 0) return exactMatches[0];
  // A station seed is the brief blank-credit card Roon publishes before live
  // programme metadata. Without that shape, a song that merely shares a saved
  // station's title must remain a track Search rather than becoming playback.
  return track.line2 === '' && titleMatches.length === 1 ? titleMatches[0] : null;
}

/** Fresh root, then fresh load, on Recent's private Live Radio stack. */
function loadRecentStations() {
  return browseCall({
    hierarchy: 'internet_radio',
    popAll: true,
    sessionKey: recentRadioSessionKey,
  }).then(function (rootResult) {
    if (rootResult.isError === true) throw new Error(rootResult.message || 'radio unavailable');
    return browseCall({
      hierarchy: 'internet_radio',
      load: true,
      count: 200,
      sessionKey: recentRadioSessionKey,
    });
  }).then(function (loadResult) {
    return loadResult.items || [];
  });
}

/** Promote safely matched seed rows, once per station; every other row stays Search. */
function recentRows(tracks, stations) {
  var stationRows = [];
  var trackRows = [];
  var seenStations = {};
  for (var i = 0; i < tracks.length; i += 1) {
    var track = tracks[i];
    var station = recentStationMatch(track, stations);
    if (station === null) { trackRows.push(track); continue; }
    // Recent is newest first, so a repeated tune-in keeps its newest time/room.
    var stationName = String(station.title || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    if (seenStations[stationName] === true) continue;
    seenStations[stationName] = true;
    stationRows.push({
      title: String(station.title || track.title),
      subtitle: 'Rejoin live \u00B7 ' + track.zoneName + ' \u00B7 '
        + new Date(track.at).toTimeString().slice(0, 5),
      intent: 'rejoin ' + String(station.title || track.title) + ' live',
      rejoinLive: true,
      stationItem: station,
      track: track,
      art: station.art || null,
    });
  }
  return stationRows.concat(trackRows);
}

function rejoinRecentStation(row) {
  if (browsePending) return;
  var context = browseCtx;
  var epoch = browseEpoch;
  var zone = currentZone();
  var station = row.stationItem;
  // A rebuilt or malformed row has no playback authority. Its remembered words
  // still have the ordinary, non-guessing Search meaning.
  if (station === null || typeof station.itemKey !== 'string') {
    searchRecentTrack(row.track);
    return;
  }
  if (zone === null) { flash('player unavailable'); return; }
  browsePending = true;
  browseCall({
    hierarchy: 'internet_radio',
    itemKey: station.itemKey,
    zoneId: zone.id,
    sessionKey: recentRadioSessionKey,
  }).then(function (result) {
    if (!browseIsCurrent(epoch, context)) return;
    browsePending = false;
    if (result.isError === true) { flash(result.message || 'could not rejoin station'); return; }
    flash(String(station.title || row.title) + ' live \u2713');
    closeBrowse();
  }).catch(function () {
    if (!browseIsCurrent(epoch, context)) return;
    browsePending = false;
    flash('could not rejoin station');
  });
}

function drawRecentRows(list, tracks, stations) {
  browseRows(list, recentRows(tracks, stations), function (row) {
    if (row.rejoinLive === true) rejoinRecentStation(row);
    else searchRecentTrack(row);
  });
}

/**
 * The ledger remembers words, not a reusable Roon item key. Tracks search Roon
 * afresh. Station seed rows are upgraded only by a CURRENT Live Radio catalogue
 * match, whose current session key is then used to rejoin the live broadcast.
 */
function openRecent() {
  var epoch = beginBrowse(null);
  var context = browseCtx;
  var list = browseShell('Recent \u00B7 stations rejoin live \u00B7 tracks find versions', false);
  fetch('/api/v1/recent').then(function (r) { return r.json(); }).then(function (data) {
    if (!browseIsCurrent(epoch, context, list)) return;
    var tracks = (data.tracks || []).map(recentTrackRow);
    // Never make Recent wait on Roon Browse. Until the catalogue answers, every
    // row retains its safe existing meaning: search these remembered words.
    drawRecentRows(list, tracks, []);
    loadRecentStations().then(function (stations) {
      // The listener may already have chosen a track and moved to its Search.
      // Do not let a late station catalogue repaint that newer browse window.
      if (browseIsCurrent(epoch, context, list)) drawRecentRows(list, tracks, stations);
    }).catch(function () {
      // The already-visible rows remain ordinary track Searches.
    });
  }).catch(function () {
    if (browseIsCurrent(epoch, context, list)) {
      list.replaceChildren(el('div', 'browse-empty', 'no history yet'));
    }
  });
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
  var groupTransition = body.action === 'group' || body.action === 'ungroup' || body.action === 'regroup';
  if (groupTransition) {
    // An unbound `/now` face or a room chosen in this session may otherwise hold
    // only a zone id. Roon destroys that id while forming/dissolving a group.
    // Anchor to the present lead output BEFORE asking for the transition, so the
    // first successor snapshot resolves directly to the new group/leader.
    var anchor = currentZone();
    if (boundOutputId === null && anchor !== null && anchor.outputs.length > 0) {
      boundOutputId = anchor.outputs[0].id;
    }
  }
  if (groupTransition || body.action === 'transfer' || body.action === 'pull') {
    settlingUntil = Date.now() + REGROUP_GRACE_MS;
  }
  return fetch('/api/v1/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (data) {
      flash(data.error || ('control failed (' + response.status + ')'));
      return false;
    });
    return true;
  }).catch(function () { flash('could not reach FlightDeck'); return false; });
}

// A sequence of progress presses is one changing seek intention. Do not let
// Roon accept a later cursor while RHEOS is still rebuilding an earlier one.
var seekIntent = createSeekIntentGate(function (body) { return command(body); });

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
var MEMBER_VOLS_MS = 3000;      /* "3 secs" (Peter, 08-29) */

function closeMemberVols() {
  memberVolsOpen = false;
  if (memberVolsTimer !== null) { clearTimeout(memberVolsTimer); memberVolsTimer = null; }
  if (memberVols !== null) memberVols.hidden = true;
  if (memberVolsButton !== null) memberVolsButton.className = 'ctl ctl-faders';
}

/** True when a press landed on the rooms' window or on the mark that opens it. */
function inFaders(target) {
  while (target !== null && target !== undefined && target !== document.body) {
    var name = target.className;
    if (typeof name === 'string'
        && (name.indexOf('ctl-faders') >= 0 || name.indexOf('member-vols') >= 0)) return true;
    target = target.parentNode;
  }
  return false;
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
      row.appendChild(volumeSpeaker(o));
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
    /**
     * ⚠️ NOTHING APPEARS UNDER THE PRESS THAT SUMMONED IT — the rule this face
     * already keeps for every picker, and this window was outside it.
     *
     * One press arrives as pointerup AND click. The pointerup opened the window,
     * which lands a room's scale exactly where the finger already is, and the
     * click that follows set that room's level from wherever the mark happened
     * to be. Measured live, 08-29: opening it took a playing group's rooms to
     * 0, 30, 0 and 0. The scales already refuse a press while a panel is fresh —
     * they were asking `panelJustAppeared()` and nobody had told it.
     */
    panelShownAt = Date.now();
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
  var seconds = seekTargetSecond(fraction, length);
  if (seconds === null) return true;
  seekIntent.seek({ zone: zone.id, seconds: seconds });
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
  var seconds = seekTargetSecond(fraction, length);
  if (seconds === null) return;
  seekIntent.seek({ zone: zone.id, seconds: seconds });
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
  if (volUi === null) return;
  paintMemberVolumes();

  if (volUi.group === true) {
    var group = zoneContainingOutput(volUi.outputId);
    if (group === null) return;
    var mutable = [];
    var levels = [];
    for (var gi = 0; gi < group.outputs.length; gi += 1) {
      var member = group.outputs[gi];
      if (member.volume !== null) mutable.push(member);
      if (volUi.scaleOutputIds.indexOf(member.id) >= 0 && member.volume !== null
          && member.volume.value !== null && member.volume.max !== null) {
        var gmin = member.volume.min === null ? 0 : member.volume.min;
        levels.push(Math.max(0, Math.min(1,
          (member.volume.value - gmin) / Math.max(1, member.volume.max - gmin))));
      }
    }
    var allMuted = mutable.length > 0;
    for (var gm = 0; gm < mutable.length; gm += 1) {
      if (!mutable[gm].volume.muted) allMuted = false;
    }
    paintMuteNode(volUi.speaker, allMuted, 'all rooms \u00B7 ' + group.name);
    if (volUi.scale !== null && levels.length > 0) {
      var mean = 0;
      for (var gl = 0; gl < levels.length; gl += 1) mean += levels[gl];
      mean = mean / levels.length;
      paintScale(volUi.scale, mean, false);
      volUi.scale.setAttribute('title', 'volume ' + Math.round(mean * 100) + '%  \u00B7  ' + group.name + ' (all rooms)');
    }
    return;
  }

  var output = outputById(volUi.outputId);
  var vol = output === null ? null : output.volume;
  if (vol === null) return;
  var muted = !!vol.muted;
  var min0 = vol.min === null ? 0 : vol.min;
  var span0 = Math.max(1, (vol.max === null ? 100 : vol.max) - min0);
  var level0 = vol.value === null ? 0.5 : Math.max(0, Math.min(1, (vol.value - min0) / span0));
  paintMuteNode(volUi.speaker, muted, output.name);
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

/** The live zone containing an output — zone ids can change while regrouping. */
function zoneContainingOutput(outputId) {
  var snap = store.snapshot();
  if (snap === null) return null;
  for (var i = 0; i < snap.zones.length; i += 1) {
    for (var j = 0; j < snap.zones[i].outputs.length; j += 1) {
      if (snap.zones[i].outputs[j].id === outputId) return snap.zones[i];
    }
  }
  return null;
}

/** One owner for the visual state and accessible action of every mute button. */
function paintMuteNode(node, muted, scope) {
  var want = muted ? 'ctl vol-speaker is-muted' : 'ctl vol-speaker';
  if (node.className !== want) node.className = want;
  node.setAttribute('data-muted', muted ? '1' : '0');
  var label = (muted ? 'unmute \u00B7 ' : 'mute \u00B7 ') + scope;
  node.setAttribute('aria-label', label);
  node.setAttribute('title', label);
}

/** Repaint the room rows without waiting for their disclosure to be rebuilt. */
function paintMemberVolumes() {
  if (memberVols === null) return;
  var speakers = memberVols.querySelectorAll('.vol-speaker[data-output-id]');
  for (var i = 0; i < speakers.length; i += 1) {
    var id = speakers[i].getAttribute('data-output-id');
    var output = outputById(id);
    if (output === null || output.volume === null) continue;
    var vol = output.volume;
    paintMuteNode(speakers[i], !!vol.muted, output.name);
    var row = speakers[i].parentNode;
    var read = row.querySelector('.member-read');
    if (read !== null) {
      read.className = vol.muted ? 'member-read is-muted' : 'member-read';
      read.textContent = vol.value === null ? '' : String(vol.value);
      if (vol.muted) read.setAttribute('title', output.name + ' is muted at ' + String(vol.value));
      else read.removeAttribute('title');
    }
    var scale = row.querySelector('.vol-scale');
    if (scale !== null && vol.value !== null && vol.max !== null) {
      var min = vol.min === null ? 0 : vol.min;
      var level = Math.max(0, Math.min(1, (vol.value - min) / Math.max(1, vol.max - min)));
      paintScale(scale, level, !!vol.muted);
      scale.setAttribute('title', 'volume ' + Math.round(level * 100) + '%  \u00B7  ' + output.name);
    }
  }
}

/** A room speaker toggles only that room, using its state at press time. */
function volumeSpeaker(output) {
  var node = el('span', 'ctl vol-speaker');
  // A dedicated slash distinguishes this ACTION from the quiet/loud speakers
  // around the scale. The filled accent frame says when mute is engaged.
  node.appendChild(glyphMute());
  node.setAttribute('data-output-id', output.id);
  paintMuteNode(node, !!(output.volume && output.volume.muted), output.name);
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
    var live = outputById(output.id);
    if (live === null || live.volume === null) return;
    command({ action: 'mute', output: output.id, muted: !live.volume.muted });
  }, 'mute:' + output.id);
  return node;
}

/**
 * The group speaker is one intent and therefore one request. The server reads
 * the same snapshot that owns the commands, decides mute-all versus unmute-all,
 * and sends the member commands sequentially so none is lost at the Core.
 */
function groupVolumeSpeaker(zone, outputs, allMuted) {
  var node = el('span', 'ctl vol-speaker');
  node.appendChild(glyphMute());
  paintMuteNode(node, allMuted, 'all rooms \u00B7 ' + zone.name);
  var anchorId = outputs.length > 0 ? outputs[0].id : zone.outputs[0].id;
  pressable(node, function () {
    var live = zoneContainingOutput(anchorId);
    if (live === null) { flash('this group is no longer available'); return; }
    command({ action: 'group-mute', zone: live.id });
  }, 'group-mute:' + outputs.map(function (o) { return o.id; }).join(','));
  return node;
}

/** The ends of the scale: a quiet speaker and a loud one, which step the level. */
function volumeStep(output, direction) {
  var node = el('span', 'ctl vol-step');
  node.appendChild(glyphSpeaker(direction === 'up' ? 1 : 0.2, false));
  var label = (direction === 'up' ? 'louder \u00B7 ' : 'quieter \u00B7 ') + output.name;
  node.setAttribute('aria-label', label);
  node.setAttribute('title', label);
  pressable(node, function () { nudgeVolume(direction === 'up' ? 1 : -1); },
    'volume-' + direction + ':' + output.id);
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
   * collide whenever the Search Roon field does not own keyboard focus.
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

function isTextEntry(node) {
  if (node === null || node === undefined) return false;
  var tag = String(node.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable === true
    || node.getAttribute && node.getAttribute('contenteditable') === 'true';
}

function onKey(event) {
  // A real search field owns every one of its keys. Without this early return,
  // typing "band" would trigger Previous, artwork, Next and volume behind it.
  var target = event.target;
  var active = document.activeElement;
  if (isTextEntry(target) || isTextEntry(active)) {
    // Keep native text entry completely native, but remember an Enter/Go press.
    // If Search finishes before the key is released, the keyup must not activate
    // the first newly focused result as a second, accidental command.
    if (keyName(event) === 'ok') browseOkHeldUntil = Date.now() + PRESS_ECHO_MS;
    browseAlive();
    return;
  }
  var name = keyName(event);
  if (debugKeys) {
    // In probe mode, REPORT rather than act: pressing play to find its code
    // should not also start the music.
    reportKey(event, name);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (name === '') { revealChrome(true); return; }
  revealChrome(true);
  if (handleBrowseNavigation(name, event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  // An open picker owns its vertical D-pad and centre button. Only when it is
  // closed do those keys fall through to global volume and artwork shortcuts.
  if (handlePickerNavigation(name)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (name === 'left') {
    cycleFace(-1);
    if (picker.hidden || picker.className.indexOf('mode-faces') < 0) showPicker('faces');
  } else if (name === 'right') {
    cycleFace(1);
    if (picker.hidden || picker.className.indexOf('mode-faces') < 0) showPicker('faces');
  }
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

/** Consume the keyup tail on whichever result was focused by the first press. */
function releaseBrowseOk(event) {
  if (browseOkHeldUntil === 0) return;
  if (keyName(event) !== 'ok') return;
  browseOkHeldUntil = 0;
  // A Search field that still owns focus also owns its ordinary native keyup.
  // Once the result repaint has moved focus away, consume the tail before the
  // newly focused Browse row can interpret it as another centre press.
  if (isTextEntry(document.activeElement)) return;
  event.preventDefault();
  event.stopPropagation();
}

// Capture on window AND document: some TV browsers deliver to only one of them.
window.addEventListener('keydown', onKey, true);
document.addEventListener('keydown', onKey, true);
window.addEventListener('keyup', releaseBrowseOk, true);
document.addEventListener('keyup', releaseBrowseOk, true);
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
var lastPassiveX = null;
var lastPassiveY = null;
/** Set by closeSettings: no reveal until the dismissing gesture is fully over. */
var chromeHeldUntil = 0;

function revealChrome(extend) {
  if (Date.now() < chromeHeldUntil) return;
  paintFaceName();
  root.className = root.className.indexOf('show-chrome') >= 0 ? root.className : root.className + ' show-chrome';
  // The transport bar belongs to the revealed state, not to a press: once the
  // screen is showing its controls, the commonest ones should already be there.
  // Classic carries its transport and volume in its own layout, so raising the
  // chrome there must not also raise a strip saying the same thing.
  if (picker.hidden && browsePanel === null
      && (!hasShelf() || root.getAttribute('data-idle') === '1')) showPicker('transport');
  // Passive pointer movement begins one bounded reveal; it does not keep moving
  // the deadline. Fire TV/Silk can emit pointermove forever while the remote is
  // idle. Deliberate presses and recognised keys do extend the interaction.
  if (chromeTimer !== null && !extend) return;
  if (chromeTimer !== null) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(function () {
    root.className = root.className.replace(' show-chrome', '');
    if (picker.className.indexOf('mode-transport') >= 0) picker.hidden = true;
    chromeTimer = null;
  }, CHROME_MS);
}

function revealChromeFromMovement(event) {
  var x = event && typeof event.clientX === 'number' ? event.clientX : null;
  var y = event && typeof event.clientY === 'number' ? event.clientY : null;
  if (x === null || y === null) return;
  var first = lastPassiveX === null || lastPassiveY === null;
  var meaningful = !first
    && Math.abs(x - lastPassiveX) + Math.abs(y - lastPassiveY) >= 6;
  lastPassiveX = x;
  lastPassiveY = y;
  // Same-position and sub-six-pixel Silk noise is not human activity.
  if (first || meaningful) {
    if (wakeIdleFace(null)) return;
    revealChrome(false);
  }
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

/**
 * The clock is a saver, not a modal page. Human activity restores the exact
 * room composition underneath it and starts a fresh idle interval. If there is
 * no same-room composition to restore, the honest destination is the Wall.
 */
var idleWakeHeldUntil = 0;
function wakeIdleFace(target) {
  if (root.getAttribute('data-idle') !== '1') return false;
  if (target !== null && inNode(target, homeMark)) { goToWall(); return true; }
  var snapshot = store === undefined ? null : store.snapshot();
  var zone = snapshot === null ? null : resolveZone(snapshot);
  if (zone === null || !idlePolicy.wake(zone.id, zone.nowPlaying !== null)) {
    goToWall();
    return true;
  }
  closeSettings();
  render(snapshot, 'snapshot');
  return true;
}

function consumeIdleWake(event) {
  var now = Date.now();
  var waking = now < idleWakeHeldUntil || wakeIdleFace(event.target || null);
  if (!waking) return;
  idleWakeHeldUntil = now + 900;
  if (event.preventDefault) event.preventDefault();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  else if (event.stopPropagation) event.stopPropagation();
}

var lastZonePress = 0;
function onFacePress(event) {
  var now = Date.now();
  if (now - lastZonePress < 400) return;     // one press, however many names it arrives under
  // Read this BEFORE revealing: revealChrome raises the transport bar itself, so
  // afterwards every press would look like a press with the chrome already up.
  var wasUp = !picker.hidden || browsePanel !== null;
  revealChrome(true);

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
      && !inNode(target, queueDoor) && !inNode(target, groupDoor)
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

  // Direct semantic handlers are primary. These routes are the compatibility
  // fallback for a television engine that reports the gesture only at document
  // level; every visible header door must still perform its own named action.
  if (target !== null && inNode(target, homeMark)) { goToWall(); return; }
  if (target !== null && inNode(target, queueDoor)) { openQueuePanel(); return; }
  if (target !== null && inNode(target, groupDoor)) { startGroupPick(); return; }
  if (target !== null && inNode(target, cog)) { openPanel('faces'); return; }
  if (target !== null && inNode(target, zoneName)) { openPanel('rooms'); return; }
  if (target !== null && inNode(target, chipHost)) { openPanel('rooms'); return; }

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
    /**
     * ⚠️ BY CLASS, NOT BY NODE. One press arrives four times — pointerup, mouseup,
     * click — and the shelf REBUILDS between them, because opening the window is
     * itself a structural frame. So by the third name the remembered nodes were
     * the old ones, the press looked like it came from nowhere, and the window
     * shut the instant it opened. What the press is ON has not changed; only the
     * object identity has.
     */
    if (inFaders(event.target)) return;
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
// A wake press is only a wake press: its pointer/mouse compatibility echoes may
// not seek, play or open a panel underneath the clock.
['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click']
  .forEach(function (kind) { document.addEventListener(kind, consumeIdleWake, true); });

// A movement episode reveals once; continuous Fire TV pointer noise cannot hold
// the page open. Touch is deliberate and receives the full interaction timeout.
['mousemove', 'pointermove'].forEach(function (kind) {
  document.addEventListener(kind, revealChromeFromMovement, true);
});
document.addEventListener('touchstart', function () { revealChrome(true); }, true);

/* ---------- keep the screen awake ---------- */
function keepAwake() {
  if (!('wakeLock' in navigator) || !window.isSecureContext) return;
  // webOS HANGS this promise rather than rejecting, so it is raced against a timeout.
  var request = navigator.wakeLock.request('screen');
  var timeout = new Promise(function (resolve) { setTimeout(resolve, 5000); });
  Promise.race([request, timeout]).catch(function () { /* not available: the drill covers device setup */ });
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) return;
  keepAwake();
  // TV engines throttle background timers. Reconcile against Date.now() when the
  // page becomes visible so a passed deadline lands immediately and honestly.
  var snapshot = store === undefined ? null : store.snapshot();
  if (snapshot !== null) render(snapshot, 'snapshot');
});
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
