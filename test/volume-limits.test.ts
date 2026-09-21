import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsOf, bandOf, bandsOf, bandAtFraction, askedLevel, askedSteps, createDoubleTap } from '../assets/volume-limits.js';
import { limitsOf as serverLimitsOf, askedLevel as serverAskedLevel, askedSteps as serverAskedSteps } from '../src/model/volume-limits.ts';

// Peter 09-06: comfort (soft_limit) is a stop a double tap may pass; safety (hard_limit_max) is a wall.
const ROON = { type: 'number', min: 0, max: 100, value: 40, step: 1, muted: false, softLimit: 80, hardLimitMax: 90 };

test('the four numbers: the scale ends at the safety limit, as RAAT reports it; missing limits collapse inward', () => {
  // Peter 09-07: "match what RAAT does" — Roon folds a RAAT device's safety limit into its range; every scale now ends there
  assert.deepEqual(limitsOf(ROON), { min: 0, max: 90, comfort: 80, safety: 90, step: 1 });
  assert.deepEqual(limitsOf({ ...ROON, softLimit: null, hardLimitMax: null }), { min: 0, max: 100, comfort: 100, safety: 100, step: 1 }, 'no limits: the whole scale is comfortable');
  assert.deepEqual(limitsOf({ ...ROON, softLimit: 95 }), { min: 0, max: 90, comfort: 90, safety: 90, step: 1 }, 'a comfort above safety is safety');
  assert.deepEqual(limitsOf({ ...ROON, softLimit: 100, hardLimitMax: 100 }).comfort, 100, 'Roon reports 100/100 when nothing is set');
  assert.deepEqual(limitsOf({ ...ROON, min: -80, max: 0, softLimit: -20, hardLimitMax: -10 }), { min: -80, max: -10, comfort: -20, safety: -10, step: 1 }, 'a dB scale ends at its safety limit too');
  assert.deepEqual(serverLimitsOf(ROON), limitsOf(ROON), 'the server reads the same numbers');
  // measured 09-07: a Marantz over RAAT reports max 80 · hard 80 for the same limits a RHEOS room reports as max 100 · hard 80
  const raat = { ...ROON, max: 80, softLimit: 60, hardLimitMax: 80 };      // Study ROON as measured
  const rheos = { ...ROON, max: 100, softLimit: 60, hardLimitMax: 80 };    // Study RHEOS as measured, the same limits in Roon
  assert.deepEqual(limitsOf(raat), { min: 0, max: 80, comfort: 60, safety: 80, step: 1 });
  assert.deepEqual(limitsOf(rheos), limitsOf(raat), 'two rooms with the same limits read the same');
  assert.deepEqual(serverLimitsOf(rheos), limitsOf(rheos));
  assert.deepEqual(limitsOf({ ...ROON, max: 80, softLimit: 60, hardLimitMax: 100 }).max, 80, 'a genuine 0–80 device is left as reported');
});

test('bands: ok to comfort, amber from comfort to the end of the scale; a level past safety (set from Roon) reads as danger', () => {
  const L = limitsOf(ROON);   // 0..90, comfort 80
  assert.equal(bandOf(40, L), 'ok'); assert.equal(bandOf(80, L), 'ok'); assert.equal(bandOf(81, L), 'comfort'); assert.equal(bandOf(90, L), 'comfort'); assert.equal(bandOf(91, L), 'danger');
  assert.deepEqual(bandsOf(L), { comfortAt: 80 / 90, safetyAt: 1 }, 'the scale ends at safety: no red band is drawn');
  const B = bandsOf(L);
  assert.equal(bandAtFraction(0.5, B), 'ok'); assert.equal(bandAtFraction(0.9, B), 'comfort'); assert.equal(bandAtFraction(1, B), 'comfort');
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


test('fractional dB steps and lower hard limits have identical browser/server behaviour', () => {
  const volume = { ...ROON, min: -80, max: 0, value: -20.5, step: .5, hardLimitMin: -60.25, hardLimitMax: -10.25, softLimit: -20.25 };
  const limits = limitsOf(volume);
  assert.deepEqual(limits, { min: -60, max: -10.5, comfort: -20.5, safety: -10.5, step: .5 });
  assert.deepEqual(limits, serverLimitsOf(volume));
  assert.equal(askedLevel(-20.5, limits, false)?.value, -20.5);
  assert.equal(askedLevel(-20.3, limits, false)?.value, -20.5);
  assert.equal(askedLevel(-70, limits, true)?.value, -60);
  assert.equal(askedLevel(-10, limits, true), null);
  assert.equal(askedSteps(-59.5, -4, limits, false).steps, -1);
  assert.equal(askedSteps(-60, -1, limits, true).steps, 0);
  for (let i = -900; i <= 0; i++) {
    const value = i / 10;
    for (const override of [true, false]) {
      const result = askedLevel(value, limits, override);
      assert.deepEqual(result, serverAskedLevel(value, limits, override));
      if (result) { assert.ok(result.value >= limits.min); assert.ok(result.value <= (override ? limits.safety : limits.comfort)); assert.equal(result.value * 2, Math.round(result.value * 2)); }
      assert.deepEqual(askedSteps(value, -4, limits, override), serverAskedSteps(value, -4, limits, override));
    }
  }
  const tenths = limitsOf({ ...volume, step: .1, hardLimitMin: -60, hardLimitMax: -10, softLimit: -20 });
  assert.equal(askedLevel(-20.3, tenths, false)?.value, -20.3);
  assert.equal(askedSteps(-20.3, 3, tenths, false).steps, 3);
});
