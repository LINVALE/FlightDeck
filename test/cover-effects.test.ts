import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The shipped browser module is intentionally plain ES2018 JavaScript.
import { chooseCoverEffect } from '../assets/cover-effects.js';

test('tasteful random uses the complete repertoire without immediately repeating', () => {
  const repertoire = ['flip', 'slide', 'dissolve', 'lift'];
  assert.deepEqual(
    new Set([0, 0.25, 0.5, 0.999999].map((sample) => chooseCoverEffect('random', '', sample))),
    new Set(repertoire),
    'a fresh face can reach every tasteful effect');

  for (const previous of repertoire) {
    const choices = [0, 0.34, 0.67, 0.999999]
      .map((sample) => chooseCoverEffect('random', previous, sample));
    assert.ok(!choices.includes(previous), previous + ' cannot immediately repeat');
    assert.deepEqual(new Set(choices), new Set(repertoire.filter((effect) => effect !== previous)),
      'all three alternatives remain reachable after ' + previous);
  }
});

test('fixed effects remain fixed while none and unknown choices fail quiet', () => {
  for (const effect of ['flip', 'slide', 'dissolve', 'lift']) {
    assert.equal(chooseCoverEffect(effect, 'flip', 0.5), effect);
  }
  assert.equal(chooseCoverEffect('none', 'flip', 0.5), null);
  assert.equal(chooseCoverEffect('unknown', 'flip', 0.5), null);
});
