import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonesOf, rankTones, contrast, luminance, inRingBand, inFoot } from '../assets/sleeve-palette.js';

/** A 32x32 sleeve painted by a function of (x, y), as RGBA bytes. */
function sleeve(paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const [r, g, b] = paint(x, y);
      const at = (y * 32 + x) * 4;
      data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 255;
    }
  }
  return data;
}
const hexToRgb = (hex: string): [number, number, number] =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * ⚖️ COLOUR FROM THE SLEEVE, CONTRAST MEASURED (Peter, 09-03: "subtle colour
 * and contrast based on the album art"). A dark red sleeve must yield an accent
 * that is still red and genuinely legible — lifted until it clears the ground,
 * not multiplied and hoped for.
 */
test('a dark red sleeve gives a red accent that clears the deck, and a ring that clears its own edge', () => {
  const tones = tonesOf(sleeve(() => [120, 20, 24]), 32);
  assert.ok(tones);
  const lit = hexToRgb(tones.lit);
  assert.ok(lit[0] > lit[1] && lit[0] > lit[2], 'the hue survives the lift');
  assert.ok(contrast(lit, 0.00518) >= 4.5, 'text-grade against the deck');
  const rich = hexToRgb(tones.rich);
  assert.ok(contrast(rich, 0.00518) >= 2.6 && luminance(rich) < luminance(lit), 'the ring tone keeps more of its colour');
  // The ring is drawn OVER the sleeve's edge band, which here is that same dark red.
  assert.ok(contrast(hexToRgb(tones.ring), tones.band) >= 2.2, 'the ring clears the band it sits on');
  assert.ok(tones.foot < 0.2, 'a dark foot');
});

/**
 * A bright sleeve is where lifting would wash the ring out, so it is SUNK
 * instead — toward black with the hue kept. Never the raw deep tone: that
 * painted Charlie Brown's ring mud-brown, contrast without colour.
 */
test('on a bright sleeve the ring darkens with its hue kept, rather than washing out or going to mud', () => {
  const tones = tonesOf(sleeve(() => [210, 200, 120]), 32);
  assert.ok(tones);
  assert.ok(tones.band > 0.5, 'a bright band');
  const ring = hexToRgb(tones.ring);
  const rich = hexToRgb(tones.rich);
  assert.ok(luminance(ring) < luminance(rich), 'sunk, not lifted');
  assert.ok(ring[0] > ring[2] && ring[1] > ring[2], 'still the sleeve\'s yellow');
  assert.notEqual(tones.ring, tones.deep, 'and not the flat deep tone');
  assert.ok(contrast(ring, tones.band) >= 2.2);
  assert.ok(tones.foot > 0.35, 'a bright foot, so the scrim must be stronger');
});

test('near-black and near-white are the ground and the highlights, not the colour', () => {
  assert.equal(tonesOf(sleeve(() => [4, 4, 4]), 32), null, 'an all-black sleeve has no colour to lend');
  assert.equal(tonesOf(sleeve(() => [250, 250, 250]), 32), null);
  // Weight is count TIMES saturation: at an even split the vivid half leads a
  // dull one, though three quarters of dull grey would still outweigh it —
  // colour tips the balance, it does not overturn it.
  const even = rankTones(sleeve((x) => (x < 16 ? [110, 110, 110] : [200, 30, 30])));
  assert.ok(even[0].rgb[0] > 150 && even[0].rgb[1] < 60, 'the vivid half leads');
  const mostlyGrey = rankTones(sleeve((x) => (x < 24 ? [110, 110, 110] : [200, 30, 30])));
  assert.ok(mostlyGrey[0].rgb[0] < 120, 'three quarters of grey still leads');
});

test('the ring band and the foot are the regions they claim', () => {
  assert.equal(inRingBand(16, 2, 32), true, 'the top edge is in the band');
  assert.equal(inRingBand(16, 16, 32), false, 'the centre is not');
  assert.equal(inRingBand(0, 0, 32), false, 'a corner is outside the circle');
  assert.equal(inFoot(5, 21, 32), true);
  assert.equal(inFoot(5, 20, 32), false);
});

/** The wheel's ground is the sleeve's: nearer its deep tone than the grey it started from. */
test('the bezel face follows the sleeve\'s deep tone, not the default grey', () => {
  const tones = tonesOf(sleeve(() => [40, 120, 60]), 32);
  assert.ok(tones);
  const face = hexToRgb(tones.bezelFace);
  const deep = hexToRgb(tones.deep);
  const dist = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(dist(face, deep) < dist(face, [32, 35, 41]), 'nearer the sleeve than the grey');
  assert.ok(face[1] > face[0] && face[1] > face[2], 'a green sleeve gives a green wheel');
});
