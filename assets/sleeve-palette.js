/**
 * THE SLEEVE'S OWN COLOURS — lifted from the artwork and MEASURED for contrast,
 * never merely sampled.
 *
 * This is the Face's reader (face.js readPalette), made a module the puck can
 * share. The pure parts take raw pixel bytes so they can be proven in node;
 * only `readPalette` touches the DOM.
 *
 * The tones, as the Face names them:
 *   deep   the dominant tone at 42%: a ground, a tint for the bezel
 *   mid    the second tone at 80%
 *   lit    the dominant tone lifted until it clears 4.5:1 on the deck — for text
 *   rich   the dominant tone lifted only to 2.6:1 — for large shapes, which keep
 *          their colour where text would be washed to white
 *
 * ⚖️ THE PUCK'S RING SITS ON THE ART, NOT ON THE DECK (Peter, 09-03: "subtle
 * colour and contrast based on the album art"). So `ring` is chosen against the
 * luminance of the sleeve's own edge band, where the ring is drawn: the rich
 * tone lifted until it clears 3:1 there — or, on a bright band where lifting
 * would only wash it out, the deep tone instead. And `foot` reports how bright
 * the lower third is, so the scrim under the credit can be as strong as the
 * sleeve needs and no stronger.
 *
 * ES2018 floor, like every other shipped asset.
 */

var SAMPLE = 32;

export function luminance(rgb) {
  var chan = [];
  for (var c = 0; c < 3; c += 1) {
    var v = Math.max(0, Math.min(1, rgb[c] / 255));
    chan.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  }
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

export function contrast(rgb, againstLuminance) {
  var a = luminance(rgb) + 0.05;
  var b = againstLuminance + 0.05;
  return a > b ? a / b : b / a;
}

/** Up to 24 steps of 8% toward white; stops the moment it is legible. */
export function liftToContrast(rgb, target, againstLuminance) {
  var out = [rgb[0], rgb[1], rgb[2]];
  for (var step = 0; step < 24 && contrast(out, againstLuminance) < target; step += 1) {
    for (var c = 0; c < 3; c += 1) out[c] = out[c] + (255 - out[c]) * 0.08;
  }
  return out;
}

export function toHex(rgb, lift) {
  var scale = typeof lift === 'number' ? lift : 1;
  var out = '#';
  for (var c = 0; c < 3; c += 1) {
    var value = Math.max(0, Math.min(255, Math.round(rgb[c] * scale)));
    out += (value < 16 ? '0' : '') + value.toString(16);
  }
  return out;
}

export function mix(a, b, amount) {
  var out = [];
  for (var c = 0; c < 3; c += 1) out.push(a[c] + (b[c] - a[c]) * amount);
  return out;
}

/**
 * The dominant tones of a SAMPLE x SAMPLE RGBA byte array, most weighty first —
 * weight is count times saturation, so a large dull field does not beat a
 * smaller vivid one. Near-black and near-white are left out: they are the
 * ground and the highlights, not the colour.
 */
export function rankTones(data) {
  var buckets = {};
  for (var i = 0; i + 3 < data.length; i += 4) {
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
  return ranked;
}

/** Mean luminance of the pixels a predicate picks, or null if it picks none. */
export function regionLuminance(data, size, pick) {
  var sum = 0;
  var n = 0;
  for (var y = 0; y < size; y += 1) {
    for (var x = 0; x < size; x += 1) {
      if (!pick(x, y, size)) continue;
      var at = (y * size + x) * 4;
      sum += luminance([data[at], data[at + 1], data[at + 2]]);
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

/** The band the progress ring is drawn over: 0.78–0.92 of the radius. */
export function inRingBand(x, y, size) {
  var half = size / 2;
  var dx = (x + 0.5 - half) / half;
  var dy = (y + 0.5 - half) / half;
  var r = Math.sqrt(dx * dx + dy * dy);
  return r >= 0.78 && r <= 0.92;
}

/** The lower third, where the credit is read. */
export function inFoot(x, y, size) {
  return y >= Math.floor(size * 2 / 3);
}

var DECK = 0.00518;   // #0a0b0d

/**
 * Everything the face needs from one sample. `null` when the sleeve has no
 * colour to speak of (an all-black or all-white cover), so the caller keeps
 * its own defaults rather than painting with nothing.
 */
export function tonesOf(data, size) {
  var n = typeof size === 'number' ? size : SAMPLE;
  var ranked = rankTones(data);
  if (ranked.length === 0) return null;
  var top = ranked[0].rgb;
  var second = ranked[Math.min(1, ranked.length - 1)].rgb;
  var band = regionLuminance(data, n, inRingBand);
  var foot = regionLuminance(data, n, inFoot);
  var rich = liftToContrast(top, 2.6, DECK);
  var deep = [top[0] * 0.42, top[1] * 0.42, top[2] * 0.42];
  // The ring against the sleeve's own edge: lift the rich tone until it clears
  // 3:1 there; on a bright band, where lifting only washes it out, the deep tone
  // is the one that reads — whichever of the two clears the band better wins.
  var ring = rich;
  if (band !== null) {
    var lifted = liftToContrast(rich, 3.0, band);
    ring = contrast(lifted, band) >= contrast(deep, band) ? lifted : deep;
  }
  return {
    deep: toHex(deep),
    mid: toHex(second, 0.8),
    lit: toHex(liftToContrast(top, 4.5, DECK)),
    rich: toHex(rich),
    ring: toHex(ring),
    bezelFace: toHex(mix([32, 35, 41], deep, 0.35)),
    bezelLip: toHex(mix([52, 56, 63], deep, 0.35)),
    foot: foot === null ? 0 : foot,
    band: band === null ? 0 : band,
  };
}

/** Read a same-origin sleeve into a 32x32 sample and hand back its tones. */
export function readPalette(url, done) {
  var image = new Image();
  image.onload = function () {
    try {
      var pad = document.createElement('canvas');
      pad.width = SAMPLE; pad.height = SAMPLE;
      var context = pad.getContext('2d');
      context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
      done(tonesOf(context.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE));
    } catch (error) { done(null); }
  };
  image.onerror = function () { done(null); };
  image.src = url;
}
