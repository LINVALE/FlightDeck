import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The shipped browser module is intentionally plain ES2018 JavaScript.
import {
  coverTransitionReceipt,
  shouldFlipCover,
  stableCoverReceipt,
} from '../assets/cover-transition.js';

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    generation: 'g', revision: 8, zoneId: 'study', state: 'playing',
    artKey: 'old-art', finite: true, trackKey: 'old-track', ...overrides,
  };
}

test('one witnessed live finite successor with a genuinely new cover may turn once', () => {
  const previous = receipt();
  const next = receipt({ revision: 12, artKey: 'new-art', trackKey: 'new-track' });
  assert.equal(shouldFlipCover(previous, next, 'update', 'old-art', true, true), true);
});

test('baselines, stale observations, room/process gaps, hidden and artist views never claim a transition', () => {
  const previous = receipt();
  const next = receipt({ revision: 9, artKey: 'new-art', trackKey: 'new-track' });
  assert.equal(shouldFlipCover(null, next, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, next, 'snapshot', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, generation: 'new' }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, revision: 8 }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, revision: 7 }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, zoneId: 'garden' }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, next, 'update', 'old-art', false, true), false);
  assert.equal(shouldFlipCover(previous, next, 'update', 'old-art', true, false), false);
});

test('pause, radio, metadata/art enrichment and a stale painted side settle directly', () => {
  const previous = receipt();
  const next = receipt({ revision: 9, artKey: 'new-art', trackKey: 'new-track' });
  assert.equal(shouldFlipCover({ ...previous, state: 'paused' }, next, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, finite: false }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, artKey: 'old-art' }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, { ...next, trackKey: 'old-track' }, 'update', 'old-art', true, true), false);
  assert.equal(shouldFlipCover(previous, next, 'update', 'something-else', true, true), false);
});

test('receipt excludes live radio and uses music metadata rather than artwork as track identity', () => {
  const snapshot = { generation: 'g', revision: 4 };
  const zone = {
    id: 'study', state: 'playing', allowed: { seek: true },
    nowPlaying: {
      title: 'Blue in Green', line2: 'Miles Davis', line3: 'Kind of Blue',
      lengthSec: 329, art: { key: 'cover-a', path: '/art/a' },
    },
  };
  const first = coverTransitionReceipt(snapshot, zone);
  const changedArt = coverTransitionReceipt({ ...snapshot, revision: 5 }, {
    ...zone, nowPlaying: { ...zone.nowPlaying, art: { key: 'cover-b', path: '/art/b' } },
  });
  assert.equal(first?.finite, true);
  const loading = coverTransitionReceipt(snapshot, { ...zone, allowed: { seek: false }, state: 'loading' });
  assert.equal(loading?.finite, true, 'temporary seek denial does not turn a timed track into radio');
  assert.equal(first?.trackKey, changedArt?.trackKey, 'an artwork correction alone is not a new track');
  const radio = coverTransitionReceipt(snapshot, {
    ...zone, allowed: { seek: false }, nowPlaying: { ...zone.nowPlaying, lengthSec: null },
  });
  assert.equal(radio?.finite, false);
});

test('the painted receipt survives intermediate loading but advances for real same-cover music', () => {
  const previous = receipt();
  const loading = receipt({ revision: 9, state: 'loading', finite: false });
  assert.equal(stableCoverReceipt(previous, loading, 'update', true), previous);
  const unrelatedRevision = receipt({ revision: 12 });
  assert.equal(stableCoverReceipt(previous, unrelatedRevision, 'update', true), previous);
  const sameCoverSuccessor = receipt({ revision: 13, trackKey: 'new-track' });
  assert.equal(stableCoverReceipt(previous, sameCoverSuccessor, 'update', true), sameCoverSuccessor);
  const paused = receipt({ revision: 14, state: 'paused' });
  assert.equal(stableCoverReceipt(previous, paused, 'update', true), paused);
  const newArt = receipt({ revision: 15, artKey: 'new-art', trackKey: 'new-track' });
  assert.equal(stableCoverReceipt(previous, newArt, 'update', false), newArt);
});
