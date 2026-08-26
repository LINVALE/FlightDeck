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
var FACES = ['presence', 'classic', 'dial', 'libretto', 'canvas'];
var STORE_KEY_FACE = 'flightdeck.face.';
var LAMP_MIN = 24, LAMP_MAX = 96;

var root = document.getElementById('face');
var picker = document.getElementById('picker');
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
 * ?keys=1 prints every key the device actually sends, with its keyCode. A remote
 * that does nothing is impossible to diagnose from the other end of the house,
 * and TV engines disagree about what they report.
 */
var debugKeys = /[?&]keys=1/.test(location.search);
function reportKey(event, name) {
  var line = (event.key || '(no .key)') + '  code=' + (event.keyCode || event.which || 0)
    + '  ->  ' + (name === '' ? 'IGNORED' : name);
  artistName.textContent = line;
  artistName.hidden = false;
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
var zoneName = el('span', 'zone');
var chipHost = el('span');
var status = el('div', 'status');
head.appendChild(zoneName); head.appendChild(chipHost); head.appendChild(status);

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
var artistName = el('span', 'artistname');
head.insertBefore(artistName, status);

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
dial.appendChild(dialTrack); dial.appendChild(dialArc);
var dialReading = el('div', 'dial-reading');
var dialRemain = el('div', 'dial-remain');
var dialTimes = el('div', 'dial-times');
var dialEnds = el('div', 'dial-ends');
dialReading.appendChild(dialRemain); dialReading.appendChild(dialTimes); dialReading.appendChild(dialEnds);
var dialBox = el('div', 'dialbox');
dialBox.appendChild(dial); dialBox.appendChild(dialReading);
// Appended here rather than beside `np`: it is built with the foot, and a `var`
// referenced before its assignment is undefined, not an error until appendChild.
body.insertBefore(dialBox, idle);
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
      var deep = toHex(ranked[0].rgb, 0.42);
      var mid = toHex(ranked[Math.min(1, ranked.length - 1)].rgb, 0.8);
      var lit = toHex(liftToContrast(ranked[0].rgb, 4.5), 1);
      done([deep, mid, lit]);
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
      document.documentElement.style.setProperty('--accent', tones[2]);
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
  if (np) {
    // Both views use the ARTIST as the backdrop: blurred behind the sleeve in the
    // album view, sharp and full bleed in the artist view. The cover is only the
    // fallback when a track has no artist image at all (internet radio).
    source = np.artistArt ? np.artistArt : np.art;
  }
  var key = (source ? source.key : null) + '@' + viewStep;
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
  // The bound output wins over a remembered zone id: it is the durable identity.
  var byOutput = zoneForOutput(snapshot);
  if (byOutput !== null && byOutput.id !== shownZoneId) { shownZoneId = byOutput.id; kind = 'snapshot'; }
  if (following) {
    var followed = pickFollowed(snapshot);
    if (followed !== null && followed !== shownZoneId) { shownZoneId = followed; kind = 'snapshot'; }
  }
  var zone = null;
  for (var i = 0; i < snapshot.zones.length; i += 1) {
    if (snapshot.zones[i].id === shownZoneId) { zone = snapshot.zones[i]; break; }
  }
  if (zone === null) {
    root.setAttribute('data-state', 'stopped');
    zoneName.textContent = 'Zone unavailable';
    return;
  }

  var away = snapshot.core.state !== 'paired';
  var state = away ? 'away' : zone.state;
  root.setAttribute('data-state', state);

  if (kind !== 'seek') {
    zoneName.textContent = zone.name;
    var wanted = zone.outputs.length > 1 ? zone.outputs.slice(1) : [];
    if (chipHost.childNodes.length !== wanted.length) {
      chipHost.replaceChildren.apply(chipHost, wanted.map(function (o) { return el('span', 'chip', o.name); }));
    }
    status.textContent = streamState === 'catching-up' ? 'catching up…'
      : (away ? 'Roon is away' : (zone.state === 'playing' ? 'playing' : zone.state));

    var np = zone.nowPlaying;
    if (np === null || zone.state === 'stopped') {
      idle.style.display = '';
      cover.style.display = np === null ? 'none' : '';
      idleClock.textContent = new Date().toTimeString().slice(0, 5);
      idleNote.textContent = zone.name;
    } else {
      idle.style.display = 'none';
      cover.style.display = '';
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
  barFill.style.width = (fraction * 100).toFixed(2) + '%';
  dialArc.setAttribute('stroke-dashoffset', String(RING_C * (1 - fraction)));
  dialRemain.textContent = '\u2212' + formatTime(length - position);
  dialTimes.textContent = formatTime(position) + ' / ' + formatTime(length);
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
  var snapshot = store.snapshot();
  if (snapshot === null) return null;
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
  artistName.textContent = shots.length > 1
    ? 'artist ' + (artistIndex + 1) + ' of ' + shots.length
    : 'artist';
  artistName.hidden = false;
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

/** The pointer shortcut: clicking the cover returns to the album view. */
function showAlbumView() {
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
cover.addEventListener('click', function (event) { event.stopPropagation(); showAlbumView(); });

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

function applyFace(name) {
  if (FACES.indexOf(name) === -1 || name === current) return;
  current = name;
  remember(current);
  root.setAttribute('data-face', current);
  fieldRunning(current === 'canvas' && !document.hidden);
  showPicker();
}

function faceOption(name) {
  var node = el('span', name === current ? 'opt now' : 'opt', name);
  node.setAttribute('data-face-option', name);
  node.addEventListener('mouseenter', function () { armDwell(node, name); });
  node.addEventListener('mouseleave', cancelDwell);
  // A tap or click is an explicit choice: apply it at once rather than dwelling.
  node.addEventListener('click', function (event) {
    event.stopPropagation();
    cancelDwell();
    applyFace(name);
  });
  return node;
}

function showPicker() {
  cancelDwell();
  var nodes = FACES.map(function (name, index) {
    var parts = [];
    if (index > 0) parts.push(el('em', '', '·'));
    parts.push(faceOption(name));
    return parts;
  }).reduce(function (all, part) { return all.concat(part); }, []);
  nodes.push(el('em', '', '|'));
  var rooms = el('div', 'controls');
  var roomBtn = function (label, title, delta) {
    var b = el('span', 'ctl small', label);
    b.setAttribute('title', title);
    b.addEventListener('click', function (event) { event.stopPropagation(); cycleZone(delta); });
    return b;
  };
  rooms.appendChild(roomBtn('\u2039', 'previous room', -1));
  rooms.appendChild(el('span', 'roomchip', following ? 'following' : (zoneName.textContent || 'room')));
  rooms.appendChild(roomBtn('\u203A', 'next room', 1));
  nodes.push(rooms);

  var zone = currentZone();
  var controls = el('div', 'controls');
  var button = function (label, title, enabled, onPress) {
    var b = el('span', enabled ? 'ctl' : 'ctl off', label);
    b.setAttribute('title', title);
    if (enabled) {
      b.addEventListener('click', function (event) { event.stopPropagation(); onPress(); });
    }
    return b;
  };
  var playing = zone !== null && zone.state === 'playing';
  controls.appendChild(button('\u23EE', 'previous', zone !== null && zone.allowed.previous,
    function () { transport('previous'); }));
  controls.appendChild(button(playing ? '\u23F8' : '\u25B6', playing ? 'pause' : 'play',
    zone !== null && (zone.allowed.pause || zone.allowed.play), function () { transport('playpause'); }));
  controls.appendChild(button('\u23ED', 'next', zone !== null && zone.allowed.next,
    function () { transport('next'); }));

  // Volume: plus and minus only, no slider — a slider is a drag to miss on a TV.
  var output = volumeOutput();
  var hasVolume = output !== null && !!output.volume;
  controls.appendChild(button('\u2212', hasVolume ? ('quieter \u00B7 ' + output.name) : 'no volume control',
    hasVolume, function () { nudgeVolume(-1); }));
  controls.appendChild(button('+', hasVolume ? ('louder \u00B7 ' + output.name) : 'no volume control',
    hasVolume, function () { nudgeVolume(1); }));
  nodes.push(controls);
  nodes.push(el('em', 'hint', '◀▶ face   ▲▼ volume   OK artwork   ·   rest on a name to switch'));
  picker.replaceChildren.apply(picker, nodes);
  picker.hidden = false;
  if (pickerTimer !== null) clearTimeout(pickerTimer);
  pickerTimer = setTimeout(function () { picker.hidden = true; }, 8000);
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
  else fieldRunning(current === 'canvas');
});

/* ---------- transport ----------
 * Every gesture is a USER ACTION translated into a ROON-LED instruction: the
 * button posts to FlightDeck, FlightDeck asks the Core, and the new state arrives
 * on the ordinary zone subscription. Nothing is applied optimistically, so the
 * screen can never show a state the Core does not agree with.
 *
 * Volume acts on the BOUND OUTPUT only — the speaker in this room — so a screen
 * in the study cannot turn up a whole grouped house.
 */
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

function nudgeVolume(steps) {
  var output = volumeOutput();
  if (output === null) { flash('this screen is not bound to one speaker'); return; }
  if (!output.volume) { flash(output.name + ' has no volume control'); return; }
  command({ action: 'volume', output: output.id, steps: steps });
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
  return '';
}

function onKey(event) {
  var name = keyName(event);
  if (debugKeys) reportKey(event, name);
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

document.addEventListener('click', showPicker);

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
fieldRunning(current === 'canvas');
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
