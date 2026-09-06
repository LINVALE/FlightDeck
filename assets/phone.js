import './compat.js';
import { createStore, formatTime } from './store.js';
import { createStream } from './stream.js';
import { seekTargetSecond } from './seek-target.js';
import { createSeekIntentGate } from './seek-intent.js';

/**
 * The Phone. FlightDeck as a REMOTE rather than a display: the same snapshot,
 * the same stream, the same accent lifted from the sleeve — but the grammar is
 * inverted. A TV hides its controls until a press summons them, because a TV is
 * furniture; a phone is picked up with intent, so the controls are already
 * standing when the glass lights, and everything a thumb needs sits in the
 * bottom third (docs/phone-interface.md).
 *
 * Kept to the same ES2018 floor discipline as the TV assets — one lint, one
 * dialect, no second rulebook to remember.
 */

var root = document.getElementById('phone');
var ZONE_KEY = 'flightdeck.phone.zone';
var SVG_NS = 'http://www.w3.org/2000/svg';
var LAMP_MIN = 20, LAMP_MAX = 48;

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- glyphs: the face's own line-work, unchanged ---------- */

function glyph(name) {
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
  }[name];
  if (d !== undefined) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }
  var strokes = {
    search: ['M10.5 4.8a5.7 5.7 0 1 1 0 11.4a5.7 5.7 0 0 1 0-11.4', 'M14.8 14.8 19.3 19.3'],
    queue: ['M5 7h14', 'M5 12h14', 'M5 17h9'],
    back: ['M14.5 6 8.5 12l6 6'],
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
    'repeat-one': [
      'M7.5 8h7a3.5 3.5 0 0 1 3.5 3.5V14',
      'M16 13.8 18 16 20 13.8',
      'M16.5 16h-7A3.5 3.5 0 0 1 6 12.5V10',
      'M4 10.2 6 8 8 10.2',
      'M11 11.2 12.6 10.2V14',
    ],
    group: [
      'M10.2 13.8a3.7 3.7 0 0 0 5.2 0l3.3-3.3a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4',
      'M13.8 10.2a3.7 3.7 0 0 0-5.2 0l-3.3 3.3a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4',
    ],
    ungroup: [
      'M14.5 9.5 16.8 7.2a3.6 3.6 0 1 1 5.1 5.1l-2.3 2.3',
      'M9.5 14.5 7.2 16.8a3.6 3.6 0 1 1-5.1-5.1l2.3-2.3',
    ],
    'send-to': [
      'M12.6 5.5H6.4A1.9 1.9 0 0 0 4.5 7.4v9.2a1.9 1.9 0 0 0 1.9 1.9h6.2',
      'M10.8 12h9.1',
      'M16.8 8.7 20.3 12l-3.5 3.3',
    ],
    rooms: ['M6.5 9.5 12 4.5l5.5 5', 'M6.5 14.5 12 19.5l5.5-5'],
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

function glyphSpeaker(level, muted) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('aria-hidden', 'true');
  var cone = document.createElementNS(SVG_NS, 'path');
  cone.setAttribute('fill', 'currentColor');
  cone.setAttribute('d', 'M4 9.5h3.4L12 5.4v13.2L7.4 14.5H4z');
  svg.appendChild(cone);
  var stroke = function (d, width) {
    var w = document.createElementNS(SVG_NS, 'path');
    w.setAttribute('fill', 'none');
    w.setAttribute('stroke', 'currentColor');
    w.setAttribute('stroke-width', width);
    w.setAttribute('stroke-linecap', 'round');
    w.setAttribute('d', d);
    return w;
  };
  if (muted) {
    svg.appendChild(stroke('M14.6 8.6l6.2 6.8', '2.4'));
    svg.appendChild(stroke('M20.8 8.6l-6.2 6.8', '2.4'));
  } else {
    if (level > 0.02) svg.appendChild(stroke('M14.6 10.2a3.4 3.4 0 0 1 0 3.6', '1.5'));
    if (level > 0.34) svg.appendChild(stroke('M16.9 8.4a6.6 6.6 0 0 1 0 7.2', '1.5'));
    if (level > 0.67) svg.appendChild(stroke('M19.2 6.6a9.8 9.8 0 0 1 0 10.8', '1.5'));
  }
  return svg;
}

/* ---------- which room this remote is holding ---------- */

var urlZone = root.getAttribute('data-zone') || '';
var urlSlug = (root.getAttribute('data-zone-slug') || '').toLowerCase();

function readRemembered() {
  try { return localStorage.getItem(ZONE_KEY) || ''; } catch (error) { return ''; }
}
function remember(id) {
  try { localStorage.setItem(ZONE_KEY, id); } catch (error) { /* private mode */ }
}

var chosenZoneId = urlZone !== '' ? urlZone : readRemembered();

function slugOf(name) { return String(name).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function zoneMatchesSlug(zone, slug) {
  if (slug === '') return false;
  var names = [slugOf(zone.name)];
  for (var o = 0; o < zone.outputs.length; o += 1) names.push(slugOf(zone.outputs[o].name));
  for (var n = 0; n < names.length; n += 1) if (names[n].indexOf(slug) === 0) return true;
  return false;
}

/**
 * The room on the glass. The URL wins, then what this phone last held, then —
 * because a remote picked up cold should hold something worth holding — the room
 * that is actually playing, then the first room there is.
 */
function pickZone(snapshot) {
  var zones = snapshot.zones;
  var i;
  for (i = 0; i < zones.length; i += 1) if (zones[i].id === chosenZoneId) return zones[i];
  // The id is stale — a Core restart renumbers zones. Re-find the room by NAME.
  if (urlSlug !== '') {
    for (i = 0; i < zones.length; i += 1) {
      if (zoneMatchesSlug(zones[i], urlSlug)) { chosenZoneId = zones[i].id; return zones[i]; }
    }
  }
  for (i = 0; i < zones.length; i += 1) {
    if (zones[i].state === 'playing' || zones[i].state === 'loading') { chosenZoneId = zones[i].id; return zones[i]; }
  }
  if (zones.length > 0) { chosenZoneId = zones[0].id; return zones[0]; }
  return null;
}

function currentZone() {
  var snapshot = store.snapshot();
  return snapshot === null ? null : pickZone(snapshot);
}

/* ---------- the page ---------- */

var bg = el('div', 'bg');
var canvas = document.createElement('canvas');
canvas.width = 54; canvas.height = 96;      // portrait weather for a portrait glass
bg.appendChild(canvas);
bg.appendChild(el('div', 'wash'));

var safe = el('div', 'safe');
var head = el('div', 'head');
// The wordmark is the way back to the phone wall — every room in one column.
head.setAttribute('role', 'link');
head.setAttribute('aria-label', 'all rooms');
head.addEventListener('click', function () { location.href = '/phone'; });
var brand = el('div', 'brand', 'FLIGHT');
brand.appendChild(el('span', '', 'DECK'));
var status = el('div', 'status');
head.appendChild(brand); head.appendChild(status);

var art = el('div', 'art');
var cover = el('div', 'cover');
var coverImg = document.createElement('img');
coverImg.alt = '';
cover.appendChild(coverImg);
art.appendChild(cover);

var copy = el('div', 'copy');
var title = el('h1', 'title');
var line2 = el('div', 'line2');
var line3 = el('div', 'line3');
copy.appendChild(title); copy.appendChild(line2); copy.appendChild(line3);

var runway = el('div', 'runway');
var lamps = el('div', 'lamps');
var times = el('div', 'times');
var elapsed = el('div', 'time pos');
var remaining = el('div', 'time remain');
var ends = el('div', 'time ends');
times.appendChild(elapsed);
times.appendChild(remaining);
times.appendChild(ends);
runway.appendChild(lamps); runway.appendChild(times);

var deck = el('div', 'deck');
var volHost = el('div', 'vol');
var roombar = el('div', 'roombar');
/**
 * ⚖️ THE WAYS IN (Peter, 09-06: "neither are connecting to browse or queue
 * screens"). Beside the room: a way into Roon's library and a way into the
 * queue. Both are sheets, like the rooms — lists, which is what a phone is
 * good at and what Roon's Browse API is shaped as.
 */
var ways = el('div', 'ways');
var browseWay = el('span', 'way');
browseWay.setAttribute('role', 'button');
browseWay.setAttribute('aria-label', 'browse Roon');
browseWay.appendChild(glyph('search'));
browseWay.addEventListener('click', function () { openSheet('browse'); });
var queueWay = el('span', 'way');
queueWay.setAttribute('role', 'button');
queueWay.setAttribute('aria-label', 'the queue');
queueWay.appendChild(glyph('queue'));
queueWay.addEventListener('click', function () { openSheet('queue'); });
ways.appendChild(roombar); ways.appendChild(browseWay); ways.appendChild(queueWay);
var controlsHost = el('div', 'controls');
deck.appendChild(volHost); deck.appendChild(ways); deck.appendChild(controlsHost);

safe.appendChild(head);
safe.appendChild(art);
safe.appendChild(copy);
safe.appendChild(runway);
safe.appendChild(deck);

var scrim = el('div', 'scrim');
scrim.hidden = true;
var sheet = el('div', 'sheet');
sheet.hidden = true;
var toast = el('div', 'toast');

root.appendChild(bg);
root.appendChild(safe);
root.appendChild(scrim);
root.appendChild(sheet);
root.appendChild(toast);

/* ---------- backdrop + palette: the face's image engine, portrait ---------- */

var ctx = canvas.getContext('2d');
var backdropKey = null;
var palette = ['#3a2b24', '#7a4a32', '#e0b070'];

function drawBackdrop(url, tones) {
  var image = new Image();
  image.onload = function () {
    try {
      ctx.save();
      var scale = Math.max(canvas.width / image.width, canvas.height / image.height);
      var w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      ctx.restore();
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
    } catch (error) { /* a broken image leaves the wash */ }
  };
  image.src = url;
}

/** The palette pass: 32x32, bucketed, accent LIFTED until it clears the deck. */
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
      var luminance = function (rgb) {
        var chan = [];
        for (var c = 0; c < 3; c += 1) {
          var v = Math.max(0, Math.min(1, rgb[c] / 255));
          chan.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        }
        return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
      };
      var GROUND = 0.00518;
      var contrast = function (rgb) { return (luminance(rgb) + 0.05) / (GROUND + 0.05); };
      var liftToContrast = function (rgb, target) {
        var out = [rgb[0], rgb[1], rgb[2]];
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

var artKey = null;
function setCover(artRef) {
  var key = artRef ? artRef.key : null;
  if (key === artKey) return;
  artKey = key;
  if (artRef === null) { coverImg.removeAttribute('src'); return; }
  var next = new Image();
  var swap = function () {
    coverImg.src = next.src;
    readPalette(next.src, function (tones) {
      palette = tones;
      document.documentElement.style.setProperty('--accent', tones[2]);
      drawBackdrop(next.src, tones);
    });
  };
  next.onload = swap;
  // Decode before swap: a half-painted sleeve is worse than a beat of delay.
  if ('decode' in HTMLImageElement.prototype) {
    next.decode().then(swap).catch(function () { /* onload covers it */ });
  }
  next.src = artRef.path;
}

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

var seekIntent = createSeekIntentGate(function (body) { return command(body); });

var toastTimer = null;
function flash(message) {
  toast.textContent = message;
  toast.className = 'toast is-lit';
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.className = 'toast'; }, 2600);
}

function transport(action) {
  var zone = currentZone();
  if (zone === null) return;
  if (action === 'next' && !zone.allowed.next) { flash('next is not available here'); return; }
  if (action === 'previous' && !zone.allowed.previous) { flash('previous is not available here'); return; }
  command({ action: action, zone: zone.id });
}

/* ---------- transport row: already standing when the glass lights ---------- */

var ctlRefs = null;   // { shuffle, prev, play, next, repeat } — built once, painted forever

function buildControls() {
  var make = function (name, extra) {
    var b = el('span', 'ctl' + (extra ? ' ' + extra : ''));
    b.appendChild(glyph(name));
    return b;
  };
  ctlRefs = {
    shuffle: make('shuffle', 'side'),
    prev: make('prev'),
    play: make('play', 'main'),
    next: make('next'),
    repeat: make('repeat', 'side'),
  };
  ctlRefs.shuffle.addEventListener('click', function () {
    var zone = currentZone();
    if (zone === null || zone.settings === null) return;
    command({ action: 'shuffle', zone: zone.id });
  });
  ctlRefs.prev.addEventListener('click', function () { transport('previous'); });
  ctlRefs.play.addEventListener('click', function () { transport('playpause'); });
  ctlRefs.next.addEventListener('click', function () { transport('next'); });
  ctlRefs.repeat.addEventListener('click', function () {
    var zone = currentZone();
    if (zone === null || zone.settings === null) return;
    command({ action: 'repeat', zone: zone.id });
  });
  controlsHost.appendChild(ctlRefs.shuffle);
  controlsHost.appendChild(ctlRefs.prev);
  controlsHost.appendChild(ctlRefs.play);
  controlsHost.appendChild(ctlRefs.next);
  controlsHost.appendChild(ctlRefs.repeat);
}

function paintControls(zone) {
  var playing = zone !== null && zone.state === 'playing';
  var wantMain = playing ? 'pause' : 'play';
  if (ctlRefs.play.getAttribute('data-shows') !== wantMain) {
    ctlRefs.play.setAttribute('data-shows', wantMain);
    ctlRefs.play.replaceChildren(glyph(wantMain));
    ctlRefs.play.setAttribute('aria-label', wantMain);
  }
  var set = function (node, enabled, litState, label) {
    var want = 'ctl' + (node === ctlRefs.play ? ' main' : (node === ctlRefs.shuffle || node === ctlRefs.repeat ? ' side' : ''))
      + (enabled ? '' : ' off') + (litState ? ' lit' : '');
    if (node.className !== want) node.className = want;
    node.setAttribute('aria-label', label);
  };
  var settings = zone === null ? null : zone.settings;
  set(ctlRefs.shuffle, settings !== null, settings !== null && settings.shuffle,
    settings !== null && settings.shuffle ? 'shuffle is on' : 'shuffle');
  set(ctlRefs.prev, zone !== null && zone.allowed.previous, false, 'previous');
  set(ctlRefs.play, zone !== null && (zone.allowed.pause || zone.allowed.play), false, wantMain);
  set(ctlRefs.next, zone !== null && zone.allowed.next, false, 'next');
  var loop = settings === null ? 'disabled' : settings.loop;
  var wantRepeat = loop === 'loop_one' ? 'repeat-one' : 'repeat';
  if (ctlRefs.repeat.getAttribute('data-shows') !== wantRepeat) {
    ctlRefs.repeat.setAttribute('data-shows', wantRepeat);
    ctlRefs.repeat.replaceChildren(glyph(wantRepeat));
  }
  set(ctlRefs.repeat, settings !== null, loop !== 'disabled',
    loop === 'loop_one' ? 'repeating this track' : (loop === 'loop' ? 'repeating the queue' : 'repeat'));
}

/* ---------- volume: one row per speaker, never the whole group at once ---------- */

var SEGMENTS = 28;
var volRows = [];      // [{ outputId, row, speaker, scale, pct }]
var volKey = null;
var volDragging = false;

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

function outputById(id) {
  var zone = currentZone();
  if (zone === null) return null;
  for (var i = 0; i < zone.outputs.length; i += 1) if (zone.outputs[i].id === id) return zone.outputs[i];
  return null;
}

function volumeScale(outputId) {
  var scale = el('span', 'vol-scale');
  for (var i = 0; i < SEGMENTS; i += 1) scale.appendChild(el('b'));
  var setFrom = function (clientX) {
    var output = outputById(outputId);
    if (output === null || output.volume === null || output.volume.max === null) return;
    var box = scale.getBoundingClientRect();
    if (box.width <= 0) return;
    var min = output.volume.min === null ? 0 : output.volume.min;
    var span = Math.max(1, output.volume.max - min);
    var fraction = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    paintScale(scale, fraction, false);      // answer the thumb NOW; the snapshot confirms
    command({ action: 'volume', output: outputId, value: Math.round(min + fraction * span) });
  };
  scale.addEventListener('pointerdown', function (event) {
    volDragging = true;
    setFrom(event.clientX);
    if (scale.setPointerCapture && event.pointerId !== undefined) {
      try { scale.setPointerCapture(event.pointerId); } catch (error) { /* fine */ }
    }
    event.preventDefault();
  });
  scale.addEventListener('pointermove', function (event) {
    if (volDragging) { setFrom(event.clientX); event.preventDefault(); }
  });
  var stop = function () { volDragging = false; };
  scale.addEventListener('pointerup', stop);
  scale.addEventListener('pointercancel', stop);
  scale.addEventListener('click', function (event) { setFrom(event.clientX); });
  return scale;
}

function buildVolume(zone) {
  volRows = [];
  var rows = [];
  var outputs = zone === null ? [] : zone.outputs;
  var several = outputs.length > 1;
  for (var i = 0; i < outputs.length; i += 1) {
    (function (output) {
      var vol = output.volume;
      if (vol === null && !several) return;             // one room, no knob: say nothing
      var row = el('div', 'vol-row');
      if (several) row.appendChild(el('span', 'vol-name', output.name));
      if (vol === null) {
        row.appendChild(el('span', 'vol-quiet', 'fixed volume'));
        rows.push(row);
        return;
      }
      var speaker = el('span', 'vol-mute');
      speaker.appendChild(glyphSpeaker(0.5, !!vol.muted));
      speaker.addEventListener('click', function () {
        var live = outputById(output.id);
        var isMuted = !!(live && live.volume && live.volume.muted);
        command({ action: 'mute', output: output.id, muted: !isMuted });
      });
      row.appendChild(speaker);
      if (vol.type === 'incremental' || vol.value === null || vol.max === null) {
        // Roon says there is no level to show — only steps.
        var step = function (name, delta, label) {
          var b = el('span', 'vol-step');
          b.appendChild(glyph(name));
          b.setAttribute('aria-label', label + ' · ' + output.name);
          b.addEventListener('click', function () { command({ action: 'volume', output: output.id, steps: delta }); });
          return b;
        };
        row.appendChild(step('minus', -1, 'quieter'));
        row.appendChild(step('plus', 1, 'louder'));
        volRows.push({ outputId: output.id, row: row, speaker: speaker, scale: null, pct: null });
      } else {
        var scale = volumeScale(output.id);
        row.appendChild(scale);
        var pct = el('span', 'vol-pct');
        row.appendChild(pct);
        volRows.push({ outputId: output.id, row: row, speaker: speaker, scale: scale, pct: pct });
      }
      rows.push(row);
    })(outputs[i]);
  }
  volHost.replaceChildren.apply(volHost, rows);
}

function paintVolumeRows() {
  for (var i = 0; i < volRows.length; i += 1) {
    var ref = volRows[i];
    var output = outputById(ref.outputId);
    if (output === null || output.volume === null) continue;
    var vol = output.volume;
    var muted = !!vol.muted;
    var min = vol.min === null ? 0 : vol.min;
    var span = Math.max(1, (vol.max === null ? 100 : vol.max) - min);
    var level = vol.value === null ? 0.5 : Math.max(0, Math.min(1, (vol.value - min) / span));
    var wantRow = 'vol-row' + (muted ? ' is-muted' : '');
    if (ref.row.className !== wantRow) ref.row.className = wantRow;
    var shown = ref.speaker.getAttribute('data-muted') === '1';
    var levelKey = String(Math.round(level * 3));
    if (shown !== muted || ref.speaker.getAttribute('data-level') !== levelKey) {
      ref.speaker.setAttribute('data-muted', muted ? '1' : '0');
      ref.speaker.setAttribute('data-level', levelKey);
      ref.speaker.replaceChildren(glyphSpeaker(level, muted));
      ref.speaker.setAttribute('aria-label', (muted ? 'unmute · ' : 'mute · ') + output.name);
    }
    var wantMuteCls = 'vol-mute' + (muted ? ' is-muted' : '');
    if (ref.speaker.className !== wantMuteCls) ref.speaker.className = wantMuteCls;
    if (ref.scale !== null && !volDragging) paintScale(ref.scale, level, muted);
    if (ref.pct !== null) ref.pct.textContent = vol.value === null ? '' : String(Math.round(level * 100));
  }
}

/* ---------- the runway seeks: press or drag, send on release ---------- */

var scrub = null;      // { fraction } while a thumb is on the runway

function runwayFraction(clientX) {
  var box = lamps.getBoundingClientRect();
  if (box.width <= 0) return 0;
  return Math.max(0, Math.min(1, (clientX - box.left) / box.width));
}

runway.addEventListener('pointerdown', function (event) {
  var zone = currentZone();
  if (zone === null || !zone.allowed.seek || zone.nowPlaying === null || !zone.nowPlaying.lengthSec) return;
  scrub = { fraction: runwayFraction(event.clientX) };
  root.setAttribute('data-scrub', '1');
  if (runway.setPointerCapture && event.pointerId !== undefined) {
    try { runway.setPointerCapture(event.pointerId); } catch (error) { /* fine */ }
  }
  event.preventDefault();
  paint('seek');
});
runway.addEventListener('pointermove', function (event) {
  if (scrub === null) return;
  scrub.fraction = runwayFraction(event.clientX);
  event.preventDefault();
  paint('seek');
});
function endScrub(send) {
  if (scrub === null) return;
  var fraction = scrub.fraction;
  scrub = null;
  root.removeAttribute('data-scrub');
  var zone = currentZone();
  if (send && zone !== null && zone.nowPlaying !== null && zone.nowPlaying.lengthSec) {
    var seconds = seekTargetSecond(fraction, zone.nowPlaying.lengthSec);
    if (seconds !== null) seekIntent.seek({ zone: zone.id, seconds: seconds });
  }
  paint('seek');
}
runway.addEventListener('pointerup', function () { endScrub(true); });
runway.addEventListener('pointercancel', function () { endScrub(false); });

/* ---------- the room bar + the rooms sheet ---------- */

var roombarArt = el('span', 'roombar-art');
var roombarArtImg = document.createElement('img');
roombarArtImg.alt = '';
roombarArt.appendChild(roombarArtImg);
var roombarName = el('span', 'roombar-name');
var roombarChips = el('span');
var roombarMark = el('span', 'roombar-mark');
roombarMark.appendChild(glyph('rooms'));
roombar.appendChild(roombarArt);
roombar.appendChild(roombarName);
roombar.appendChild(roombarChips);
roombar.appendChild(roombarMark);
roombar.setAttribute('aria-label', 'rooms');
roombar.addEventListener('click', function () { openSheet('rooms'); });

var sheetMode = null;   // null | 'rooms' | 'group' | 'transfer'
var groupPick = [];

function roomRow(zone, marked, right, onPress) {
  var row = el('div', 'room' + (marked ? ' now' : ''));
  var artBox = el('span', 'room-art');
  var np = zone.nowPlaying;
  if (np !== null && np.art !== null) {
    var img = document.createElement('img');
    img.alt = '';
    img.src = np.art.path;
    artBox.appendChild(img);
  } else {
    artBox.appendChild(glyphSpeaker(0.5, false));
  }
  row.appendChild(artBox);
  var text = el('span', 'room-text');
  var nameLine = el('span', 'room-name', zone.name);
  text.appendChild(nameLine);
  var line = el('span', 'room-np');
  if (np !== null) {
    var mark = zone.state === 'playing' || zone.state === 'loading' ? 'play'
      : (zone.state === 'paused' ? 'pause' : null);
    if (mark !== null) {
      var svg = glyph(mark);
      svg.setAttribute('class', 'glyph np-mark');
      line.appendChild(svg);
    }
    var titleSpan = el('span', 'np-title', np.title);
    line.appendChild(titleSpan);
  }
  text.appendChild(line);
  row.appendChild(text);
  if (right !== null) row.appendChild(el('span', 'room-check', right));
  if (onPress !== null) row.addEventListener('click', onPress);
  return row;
}

/* ---------- browse: Roon's library as a list, a level at a time ---------- */

/**
 * The same Browse plane the Face and the puck use (/api/v1/browse): browse
 * INTO an item, then LOAD the level's rows; back is popLevels; the root is
 * popAll; search is its own hierarchy. A session key of this page's own, so
 * no other screen's position moves under this thumb.
 */
var browse = {
  session: 'phone-' + String(Date.now()).slice(-8) + Math.random().toString(36).slice(2, 8),
  hierarchy: 'browse', list: null, items: [], loading: false, error: null, query: '',
};
var BROWSE_PAGE = 60;

function ask(body) {
  body.sessionKey = browse.session;
  var zone = currentZone();
  if (zone !== null && body.load !== true) body.zoneId = zone.id;
  return fetch('/api/v1/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) throw new Error(data.error || ('browse failed ' + String(response.status)));
      return data;
    });
  });
}

function repaintSheet() { if (sheetMode === 'browse' || sheetMode === 'queue') buildSheet(); }

function browseTitle() {
  if (browse.list !== null && browse.list.level > 0) return browse.list.title;
  return browse.hierarchy === 'search' ? 'Search' : 'Browse';
}
function browseCanBack() { return browse.hierarchy === 'search' || (browse.list !== null && browse.list.level > 0); }

function browseShow() {
  return ask({ hierarchy: browse.hierarchy, load: true, offset: 0, count: BROWSE_PAGE }).then(function (loaded) {
    browse.list = loaded.list || null;
    browse.items = loaded.items || [];
    browse.loading = false;
    browse.error = null;
    repaintSheet();
  });
}
function browseFailed(error) {
  browse.loading = false;
  browse.error = String(error && error.message ? error.message : error);
  repaintSheet();
}
function browseBegin() { browse.loading = true; browse.error = null; repaintSheet(); }
function browseRoot() {
  browse.hierarchy = 'browse';
  browseBegin();
  return ask({ hierarchy: 'browse', popAll: true }).then(browseShow).catch(browseFailed);
}
function browseInto(item) {
  browseBegin();
  return ask({ hierarchy: browse.hierarchy, itemKey: item.itemKey }).then(function (result) {
    // An ACTION (Play Now, Add Next, Queue, Start Radio) is done the moment it
    // is browsed into; Roon answers with nothing to list.
    if (item.hint === 'action' || result.action === 'none' || result.action === 'message') {
      browse.loading = false;
      flash(result.message || item.title);
      closeSheet();
      return null;
    }
    return browseShow();
  }).catch(browseFailed);
}
function browseBack() {
  if (browse.hierarchy === 'search' && (browse.list === null || browse.list.level === 0)) return browseRoot();
  browseBegin();
  return ask({ hierarchy: browse.hierarchy, popLevels: 1 }).then(browseShow).catch(browseFailed);
}
function browseSearch(query) {
  if (query.trim() === '') return null;
  browse.query = query.trim();
  browse.hierarchy = 'search';
  browseBegin();
  return ask({ hierarchy: 'search', popAll: true, input: query.trim() }).then(browseShow).catch(browseFailed);
}
function browseMore() {
  return ask({ hierarchy: browse.hierarchy, load: true, offset: browse.items.length, count: BROWSE_PAGE }).then(function (loaded) {
    browse.items = browse.items.concat(loaded.items || []);
    repaintSheet();
  }).catch(browseFailed);
}

/** A row of the library: art if it has any, the words, a mark for what a tap does. */
function browseRow(item) {
  var goes = item.hint === 'list' || item.hint === 'action_list';
  var acts = item.hint === 'action';
  var row = el('div', 'brow' + (acts ? ' act' : '') + (!goes && !acts ? ' head' : ''));
  row.setAttribute('data-hint', item.hint || '');
  if (item.art) {
    var artBox = el('span', 'brow-art');
    var img = document.createElement('img');
    img.alt = '';
    img.src = item.art;
    artBox.appendChild(img);
    row.appendChild(artBox);
  }
  var text = el('span', 'brow-text');
  text.appendChild(el('span', 'brow-title', item.title));
  if (item.subtitle) text.appendChild(el('span', 'brow-sub', item.subtitle));
  row.appendChild(text);
  if (goes) row.appendChild(el('span', 'brow-go', '›'));
  if (goes || acts) row.addEventListener('click', function () { if (!browse.loading) browseInto(item); });
  return row;
}

function buildBrowse(body, headRow) {
  if (browseCanBack()) {
    var back = el('span', 'sheet-back');
    back.setAttribute('role', 'button');
    back.setAttribute('aria-label', 'back');
    back.appendChild(glyph('back'));
    back.addEventListener('click', function () { if (!browse.loading) browseBack(); });
    headRow.insertBefore(back, headRow.firstChild);
  }
  var form = el('div', 'sheet-search');
  var input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'search Roon';
  input.setAttribute('aria-label', 'search Roon');
  input.setAttribute('autocomplete', 'off');
  input.value = browse.query;   // the words survive the redraw that brings their results
  var go = el('span', 'sheet-go', 'go');
  go.setAttribute('role', 'button');
  go.addEventListener('click', function () { browseSearch(input.value); input.blur(); });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { browseSearch(input.value); input.blur(); }
  });
  form.appendChild(input);
  form.appendChild(go);
  body.appendChild(form);
  if (browse.error !== null) body.appendChild(el('div', 'sheet-note', browse.error));
  else if (browse.loading) body.appendChild(el('div', 'sheet-note', 'loading…'));
  else {
    for (var i = 0; i < browse.items.length; i += 1) body.appendChild(browseRow(browse.items[i]));
    if (browse.items.length === 0) body.appendChild(el('div', 'sheet-note', 'nothing here'));
    if (browse.list !== null && browse.list.count > browse.items.length) {
      var more = el('div', 'brow-more', 'more · ' + String(browse.items.length) + ' of ' + String(browse.list.count));
      more.addEventListener('click', function () { browseMore(); });
      body.appendChild(more);
    }
  }
}

/* ---------- the queue: what is playing and what comes next ---------- */

/**
 * The deck's own queue mirror (/api/v1/queue), read as rows; a tap on a row
 * PLAYS FROM THERE — Roon's play_from_here, fenced by the screen generation
 * and the queue revision the rows were read at, so a queue that moved under
 * the thumb is read again, never guessed at.
 */
var queue = { data: null, loading: false, error: null, seenTitle: null };

function loadQueue(attempt) {
  var zone = currentZone();
  if (zone === null) return;
  queue.loading = true;
  queue.error = null;
  repaintSheet();
  fetch('/api/v1/queue?zone=' + encodeURIComponent(zone.id), { cache: 'no-store' }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) throw new Error(data.error || ('queue unavailable (' + String(response.status) + ')'));
      return data;
    });
  }).then(function (data) {
    if (data.ready !== true && attempt < 8) { setTimeout(function () { loadQueue(attempt + 1); }, 700); return; }
    queue.data = data;
    queue.loading = false;
    repaintSheet();
  }).catch(function (error) {
    queue.loading = false;
    queue.error = String(error && error.message ? error.message : error);
    repaintSheet();
  });
}

function playFromQueue(item, index) {
  if (index === 0) { flash('already playing'); return; }
  var zone = currentZone();
  if (zone === null || queue.data === null) return;
  fetch('/api/v1/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: zone.id, itemId: item.id, generation: queue.data.generation, queueRevision: queue.data.revision }),
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (response.ok) { flash('playing ' + item.title); closeSheet(); return; }
      if (data.code === 'stale' || data.code === 'current') { flash(data.error || 'the queue moved'); loadQueue(0); return; }
      flash(data.error || ('could not play from the queue (' + String(response.status) + ')'));
    });
  }).catch(function () { flash('could not reach FlightDeck'); });
}

function buildQueue(body) {
  if (queue.error !== null) { body.appendChild(el('div', 'sheet-note', queue.error)); return; }
  if (queue.loading || queue.data === null) { body.appendChild(el('div', 'sheet-note', 'loading…')); return; }
  var items = queue.data.items || [];
  if (items.length === 0) { body.appendChild(el('div', 'sheet-note', 'the queue is empty')); return; }
  for (var i = 0; i < items.length; i += 1) {
    (function (item, index) {
      var row = el('div', 'brow' + (index === 0 ? ' now' : ''));
      if (item.art) {
        var artBox = el('span', 'brow-art');
        var img = document.createElement('img');
        img.alt = '';
        img.src = item.art;
        artBox.appendChild(img);
        row.appendChild(artBox);
      }
      var text = el('span', 'brow-text');
      text.appendChild(el('span', 'brow-title', item.title));
      var sub = (item.artist || '') + (item.lengthSec !== null && item.lengthSec !== undefined ? (item.artist ? ' · ' : '') + formatTime(item.lengthSec) : '');
      if (sub !== '') text.appendChild(el('span', 'brow-sub', sub));
      row.appendChild(text);
      if (index === 0) {
        var mark = glyph('play');
        mark.setAttribute('class', 'glyph brow-now');
        row.appendChild(mark);
      }
      row.addEventListener('click', function () { playFromQueue(item, index); });
      body.appendChild(row);
    })(items[i], i);
  }
  if (queue.data.atLimit === true) body.appendChild(el('div', 'sheet-note', 'and more beyond what the deck holds'));
}

function buildSheet() {
  var snapshot = store.snapshot();
  var zones = snapshot === null ? [] : snapshot.zones;
  var here = currentZone();
  var nodes = [el('div', 'sheet-grip')];

  var headRow = el('div', 'sheet-head');
  var titles = { rooms: 'Rooms', group: here === null ? 'Group' : 'Group with ' + here.name, transfer: 'Send the music to…', browse: browseTitle(), queue: 'Queue' };
  headRow.appendChild(el('span', 'sheet-title', titles[sheetMode] || 'Rooms'));
  var close = el('span', 'sheet-close', '×');
  close.setAttribute('aria-label', 'close');
  close.addEventListener('click', closeSheet);
  headRow.appendChild(close);
  nodes.push(headRow);

  var body = el('div', 'sheet-body');

  if (sheetMode === 'browse') buildBrowse(body, headRow);
  if (sheetMode === 'queue') buildQueue(body);

  if (sheetMode === 'rooms') {
    /**
     * What can be DONE with this room sits above which room to hold: the verbs
     * are why the sheet usually gets opened. Only the possible is offered.
     */
    var acts = el('div', 'sheet-acts');
    var canPeer = here !== null && here.outputs.length > 0 && here.outputs[0].groupableWith.length > 1;
    var isGroup = here !== null && here.outputs.length > 1;
    var act = function (mark, label, enabled, onPress) {
      var b = el('span', enabled ? 'act' : 'act off');
      b.appendChild(glyph(mark));
      b.appendChild(document.createTextNode(label));
      if (enabled) b.addEventListener('click', onPress);
      return b;
    };
    acts.appendChild(act('group', 'group…', canPeer, function () { groupPick = []; openSheet('group'); }));
    acts.appendChild(act('ungroup', 'ungroup', isGroup, function () {
      closeSheet();
      command({ action: 'ungroup', zone: here.id });
    }));
    acts.appendChild(act('send-to', 'send to…', here !== null && here.nowPlaying !== null,
      function () { openSheet('transfer'); }));
    nodes.push(acts);

    for (var r = 0; r < zones.length; r += 1) {
      (function (z) {
        body.appendChild(roomRow(z, here !== null && z.id === here.id, null, function () {
          chosenZoneId = z.id;
          remember(z.id);
          closeSheet();
          paint('snapshot');
        }));
      })(zones[r]);
    }
    var wall = el('div', 'walllink', 'all rooms →');
    wall.addEventListener('click', function () { location.href = '/phone'; });
    body.appendChild(wall);
  }

  if (sheetMode === 'group') {
    /**
     * Roon partitions grouping by protocol; a room it will not join is simply
     * not here, and the head of the list leads — Roon keeps the head's queue,
     * so grouping FROM the playing room carries that music to the others.
     */
    var island = here === null || here.outputs.length === 0 ? '' : here.outputs[0].island;
    for (var g = 0; g < zones.length; g += 1) {
      (function (z) {
        if (here !== null && z.id === here.id) return;
        var joinable = island !== '' && z.outputs.length > 0 && z.outputs.every(function (o) {
          return o.island === island;
        });
        if (!joinable) return;
        var picked = groupPick.indexOf(z.id) !== -1;
        body.appendChild(roomRow(z, picked, picked ? '✓' : '', function () {
          var at = groupPick.indexOf(z.id);
          if (at === -1) groupPick.push(z.id); else groupPick.splice(at, 1);
          buildSheet();
        }));
      })(zones[g]);
    }
  }

  if (sheetMode === 'transfer') {
    for (var x = 0; x < zones.length; x += 1) {
      (function (z) {
        if (here !== null && z.id === here.id) return;
        body.appendChild(roomRow(z, false, null, function () {
          closeSheet();
          command({ action: 'transfer', zone: here.id, to: z.id });
          chosenZoneId = z.id;
          remember(z.id);
          paint('snapshot');
        }));
      })(zones[x]);
    }
  }

  nodes.push(body);

  if (sheetMode === 'group') {
    var foot = el('div', 'sheet-foot');
    var confirm = el('span', groupPick.length === 0 ? 'confirm off' : 'confirm',
      groupPick.length === 0 ? 'choose rooms to add' : 'group ' + String(groupPick.length + 1) + ' rooms');
    if (groupPick.length > 0 && here !== null) {
      confirm.addEventListener('click', function () {
        var ids = here.outputs.map(function (o) { return o.id; });
        for (var i = 0; i < groupPick.length; i += 1) {
          for (var j = 0; j < zones.length; j += 1) {
            if (zones[j].id === groupPick[i]) {
              ids = ids.concat(zones[j].outputs.map(function (o) { return o.id; }));
            }
          }
        }
        groupPick = [];
        closeSheet();
        command({ action: 'group', outputs: ids });
      });
    }
    foot.appendChild(confirm);
    var cancel = el('span', 'cancel', 'back');
    cancel.addEventListener('click', function () { groupPick = []; openSheet('rooms'); });
    foot.appendChild(cancel);
    nodes.push(foot);
  }

  sheet.replaceChildren.apply(sheet, nodes);
}

function openSheet(mode) {
  sheetMode = mode;
  if (mode === 'queue') {
    var here = currentZone();
    queue.seenTitle = here !== null && here.nowPlaying !== null ? here.nowPlaying.title : null;
    loadQueue(0);
  }
  if (mode === 'browse' && browse.list === null && !browse.loading) browseRoot();
  buildSheet();
  scrim.hidden = false;
  sheet.hidden = false;
  // let display take effect before the transition class lands
  requestAnimationFrame(function () {
    scrim.className = 'scrim is-open';
    sheet.className = 'sheet is-open';
  });
}

function closeSheet() {
  sheetMode = null;
  groupPick = [];
  scrim.className = 'scrim';
  sheet.className = 'sheet';
  setTimeout(function () {
    if (sheetMode === null) { scrim.hidden = true; sheet.hidden = true; }
  }, 300);
}

scrim.addEventListener('click', closeSheet);

// A pull DOWN on the sheet is the other native way out.
var sheetDrag = null;
sheet.addEventListener('touchstart', function (event) {
  if (event.touches.length === 1) sheetDrag = { fromY: event.touches[0].clientY, moved: 0 };
});
sheet.addEventListener('touchmove', function (event) {
  if (sheetDrag === null) return;
  sheetDrag.moved = event.touches[0].clientY - sheetDrag.fromY;
});
sheet.addEventListener('touchend', function () {
  if (sheetDrag !== null && sheetDrag.moved > 70) closeSheet();
  sheetDrag = null;
});

/* ---------- paint ---------- */

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

var lastTitle = null;
var roomArtShown = null;

function paint(kind) {
  var snapshot = store.snapshot();
  if (snapshot === null) return;
  var zone = pickZone(snapshot);
  // An open queue is re-read when the music moves on (never while a read is in flight).
  if (sheetMode === 'queue' && zone !== null) {
    var nowTitle = zone.nowPlaying === null ? null : zone.nowPlaying.title;
    if (nowTitle !== queue.seenTitle) { queue.seenTitle = nowTitle; if (!queue.loading) loadQueue(0); }
  }
  if (zone === null) {
    root.setAttribute('data-state', 'stopped');
    title.textContent = 'No rooms yet';
    return;
  }

  var away = snapshot.core.state !== 'paired';
  root.setAttribute('data-state', away ? 'away' : zone.state);

  if (kind !== 'seek') {
    status.textContent = streamState === 'catching-up' ? 'catching up…'
      : (away ? 'Roon is away' : (zone.state === 'loading' ? 'loading' : ''));

    // the room bar: name, the rest of a group as chips, the sleeve in miniature
    roombarName.textContent = zone.name;
    // A COUNT, not a roster: three member names wrapped the bar into a ledger.
    // The names live one tap away, in the sheet, where there is room to read them.
    var others = zone.outputs.length - 1;
    var chipsKey = others > 0 ? '+' + String(others) : '';
    if (roombarChips.getAttribute('data-key') !== chipsKey) {
      roombarChips.setAttribute('data-key', chipsKey);
      roombarChips.replaceChildren.apply(roombarChips,
        chipsKey === '' ? [] : [el('span', 'chip', chipsKey)]);
    }
    var np = zone.nowPlaying;
    var roomArtPath = np !== null && np.art !== null ? np.art.path : null;
    if (roomArtPath !== roomArtShown) {
      roomArtShown = roomArtPath;
      if (roomArtPath === null) roombarArtImg.removeAttribute('src');
      else roombarArtImg.src = roomArtPath;
    }

    if (np === null || zone.state === 'stopped') {
      title.textContent = zone.name;
      line2.textContent = 'nothing playing';
      line3.textContent = '';
      setCover(np === null ? null : np.art);
    } else {
      if (np.title !== lastTitle) lastTitle = np.title;
      title.textContent = np.title;
      line2.textContent = np.line2;
      line3.textContent = np.line3;
      setCover(np.art);
    }

    paintControls(zone);

    // Volume rows are REBUILT only when the set of speakers changes, and
    // repainted otherwise — a thumb mid-drag must never have the scale it is
    // holding replaced underneath it.
    var wantVolKey = zone.outputs.map(function (o) {
      return o.id + ':' + (o.volume === null ? '-' : o.volume.type);
    }).join(',');
    if (wantVolKey !== volKey && !volDragging) {
      volKey = wantVolKey;
      buildVolume(zone);
    }
    // The ROOM sheets follow the snapshot. Browse and the queue must not: a
    // rebuild a second replaces the search field under a thumb and the
    // keyboard falls away (Peter, 09-06: "the keyboard appears but doesn't
    // stay"). The queue re-reads itself when the music moves on, above.
    if (sheetMode === 'rooms' || sheetMode === 'group' || sheetMode === 'transfer') buildSheet();
  }

  paintVolumeRows();

  var position = store.positionSec(zone);
  var length = zone.nowPlaying ? zone.nowPlaying.lengthSec : null;
  if (position === null || !length) {
    ensureLamps(0);
    elapsed.textContent = ''; remaining.textContent = ''; ends.textContent = '';
    return;
  }
  if (scrub !== null) position = scrub.fraction * length;
  var count = Math.max(LAMP_MIN, Math.min(LAMP_MAX, Math.round(length / 10)));
  ensureLamps(count);
  var litTo = Math.floor((position / length) * count);
  for (var l = 0; l < count; l += 1) {
    var node = lampNodes[l];
    var wantClass = l < litTo ? 'lit' : (l === litTo && (zone.state === 'playing' || scrub !== null) ? 'head' : '');
    if (node.className !== wantClass) node.className = wantClass;
  }
  elapsed.textContent = formatTime(position);
  remaining.textContent = '−' + formatTime(length - position);
  ends.textContent = zone.state === 'playing' && scrub === null
    ? 'ENDS ' + new Date(Date.now() + (length - position) * 1000).toTimeString().slice(0, 5) : '';
}

/* ---------- go ---------- */

buildControls();

// The store hands its listeners (snapshot, kind); paint reads the snapshot
// itself, so only the kind travels.
var store = createStore(function (snapshot, kind) { paint(kind); });
store.hydrate();
var streamState = 'live';
createStream(store, function (state) {
  streamState = state;
  if (state === 'catching-up') status.textContent = 'catching up…';
  else paint('snapshot');
});
setInterval(function () { paint('seek'); }, 500);

// /phone?rooms=1 opens straight onto the room list — the deep link for
// "I picked the phone up to move the music, not to look at it".
if (/[?&]rooms=1/.test(window.location.search)) {
  var opened = false;
  var tryOpen = function () {
    if (opened || store.snapshot() === null) return;
    opened = true;
    openSheet('rooms');
  };
  store.subscribe(tryOpen);
  tryOpen();
}
