import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsOf, bandOf, bandsOf, bandAtFraction, askedLevel, askedSteps, createDoubleTap } from '../assets/volume-limits.js';
import { limitsOf as serverLimitsOf, askedLevel as serverAskedLevel, askedSteps as serverAskedSteps } from '../src/model/volume-limits.ts';

// Peter 09-06: comfort (soft_limit) is a stop a double tap may pass; safety (hard_limit_max) is a wall.
const ROON = { type: 'number', min: 0, max: 100, value: 40, step: 1, muted: false, softLimit: 80, hardLimitMax: 90 };

test('the four numbers: comfort inside safety inside the scale; missing limits collapse inward', () => {
  assert.deepEqual(limitsOf(ROON), { min: 0, max: 100, comfort: 80, safety: 90, step: 1 });
  assert.deepEqual(limitsOf({ ...ROON, softLimit: null, hardLimitMax: null }), { min: 0, max: 100, comfort: 100, safety: 100, step: 1 }, 'no limits: the whole scale is comfortable');
  assert.deepEqual(limitsOf({ ...ROON, softLimit: 95 }), { min: 0, max: 100, comfort: 90, safety: 90, step: 1 }, 'a comfort above safety is safety');
  assert.deepEqual(limitsOf({ ...ROON, softLimit: 100, hardLimitMax: 100 }).comfort, 100, 'Roon reports 100/100 when nothing is set');
  assert.deepEqual(limitsOf({ ...ROON, min: -80, max: 0, softLimit: -20, hardLimitMax: -10 }), { min: -80, max: 0, comfort: -20, safety: -10, step: 1 }, 'a dB scale');
  assert.deepEqual(serverLimitsOf(ROON), limitsOf(ROON), 'the server reads the same numbers');
  // measured 09-07: a Marantz over RAAT reports max 80 · hard 80 for the same limits a RHEOS room reports as max 100 · hard 80
  const folded = { ...ROON, max: 80, softLimit: 60, hardLimitMax: 80 };
  assert.deepEqual(limitsOf(folded), { min: 0, max: 100, comfort: 60, safety: 80, step: 1 }, 'a percent scale whose top is its safety limit reads to 100, red above the limit');
  assert.deepEqual(serverLimitsOf(folded), limitsOf(folded));
  assert.deepEqual(limitsOf({ ...ROON, type: 'db', min: -80, max: -10, softLimit: -20, hardLimitMax: -10 }).max, -10, 'a dB scale is left as reported');
  assert.deepEqual(limitsOf({ ...ROON, max: 80, softLimit: 60, hardLimitMax: 100 }).max, 80, 'a genuine 0–80 device (its limit above its top) is left as reported');
});

test('bands: ok to comfort, amber to safety, red beyond — and the scale is painted to the top', () => {
  const L = limitsOf(ROON);
  assert.equal(bandOf(40, L), 'ok'); assert.equal(bandOf(80, L), 'ok'); assert.equal(bandOf(81, L), 'comfort'); assert.equal(bandOf(90, L), 'comfort'); assert.equal(bandOf(91, L), 'danger');
  assert.deepEqual(bandsOf(L), { comfortAt: 0.8, safetyAt: 0.9 });
  const B = bandsOf(L);
  assert.equal(bandAtFraction(0.5, B), 'ok'); assert.equal(bandAtFraction(0.8, B), 'comfort'); assert.equal(bandAtFraction(0.9, B), 'danger'); assert.equal(bandAtFraction(1, B), 'danger');
  assert.equal(bandAtFraction(0.95, bandsOf(limitsOf({ ...ROON, softLimit: null, hardLimitMax: null }))), 'ok', 'no limits, no bands');
});

test('a hand may ask up to comfort; a double tap up to safety; beyond safety nothing is asked', () => {
  const L = limitsOf(ROON);
  assert.deepEqual(askedLevel(60, L, false), { value: 60, held: 'none' });
  assert.deepEqual(askedLevel(85, L, false), { value: 80, held: 'comfort' }, 'a drag stops at comfort');
  assert.deepEqual(askedLevel(85, L, true), { value: 85, held: 'none' }, 'a double tap passes it');
  assert.equal(askedLevel(95, L, true), null, 'never above safety, even overridden');
  assert.equal(askedLevel(95, L, false), null);
  assert.deepEqual(askedLevel(-5, L, false), { value: 0, held: 'none' });
  for (const [v, o] of [[60, false], [85, false], [85, true], [95, true]] as const) {
    assert.deepEqual(serverAskedLevel(v, L, o), askedLevel(v, L, o), 'server and client agree on ' + String(v));
  }
});

test('steps: room up to comfort, more with a double tap, none past safety; downward is free', () => {
  const L = limitsOf(ROON);
  assert.deepEqual(askedSteps(40, 1, L, false), { steps: 1, held: 'none' });
  assert.deepEqual(askedSteps(79, 4, L, false), { steps: 1, held: 'none' }, 'cut to reach comfort');
  assert.deepEqual(askedSteps(80, 1, L, false), { steps: 0, held: 'comfort' }, 'at comfort a single press does nothing');
  assert.deepEqual(askedSteps(80, 1, L, true), { steps: 1, held: 'none' }, 'a double press steps above');
  assert.deepEqual(askedSteps(90, 1, L, true), { steps: 0, held: 'safety' }, 'never past safety');
  assert.deepEqual(askedSteps(90, -1, L, false), { steps: -1, held: 'none' }, 'down is always free');
  assert.deepEqual(serverAskedSteps(80, 1, L, true), askedSteps(80, 1, L, true));
});

test('a double tap is a second press of the same thing inside the window', () => {
  const gate = createDoubleTap(700);
  assert.equal(gate.press('vol', 1000), false);
  assert.equal(gate.press('vol', 1500), true, 'second press, 500ms later');
  assert.equal(gate.press('vol', 1600), false, 'the pair is spent');
  assert.equal(gate.press('vol', 3000), false);
  assert.equal(gate.press('other', 3100), false, 'a different control does not pair');
  assert.equal(gate.press('other', 3200), true);
  assert.equal(gate.press('vol', 5000), false);
  assert.equal(gate.press('vol', 5800), false, 'too late');
});
