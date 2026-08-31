import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The shipped browser module is intentionally plain ES2018 JavaScript.
import { seekTargetSecond } from '../assets/seek-target.js';

test('a progress press never seeks onto the track hand-off boundary', () => {
  assert.equal(seekTargetSecond(0, 211), 0);
  assert.equal(seekTargetSecond(0.5, 211), 106);
  assert.equal(seekTargetSecond(1, 211), 210);
  assert.equal(seekTargetSecond(0.9999, 211), 210,
    'rounding near the right edge cannot manufacture an exact-duration seek');
});

test('fractional and very short timelines still choose a position strictly inside', () => {
  assert.equal(seekTargetSecond(1, 211.7), 211);
  assert.equal(seekTargetSecond(1, 0.4), 0);
  assert.equal(seekTargetSecond(-1, 100), 0);
  assert.equal(seekTargetSecond(2, 100), 99);
});

test('invalid timelines fail quiet', () => {
  assert.equal(seekTargetSecond(Number.NaN, 100), null);
  assert.equal(seekTargetSecond(0.5, 0), null);
  assert.equal(seekTargetSecond(0.5, Number.POSITIVE_INFINITY), null);
});
