import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from './support/store-harness.ts';

// 2026-08-28 (Peter): the Now Playing progress "skips a second back before going forwards — as though it's using two
// out of sync clocks". Roon's seek_position is a whole second on Roon's clock; the server samples it on its own 1 Hz
// timer; the face interpolates between frames. A frame that repeats the previous second used to replace the anchor
// and snap the display back. The store is now monotonic within a second and parks at R+1 on a stall.
const T0 = Date.parse('2026-08-28T15:00:00.000Z');
const realNow = Date.now;
function at(ms: number): string { return new Date(T0 + ms).toISOString(); }
function clock(ms: number): void { Date.now = () => T0 + ms; }

function playing(revision = 3, seekAtMs = 0) {
  return {
    generation: 'g', revision, at: at(seekAtMs),
    zones: [{ id: 'z', name: 'Study', state: 'playing', nowPlaying: { title: 'La mer', lengthSec: 200, seek: { positionSec: 40, at: at(seekAtMs) } } }],
  };
}
function frame(revision: number, ms: number, positionSec: number) {
  return { generation: 'g', revision, at: at(ms), zones: [{ id: 'z', positionSec }] };
}

test.afterEach(() => { Date.now = realNow; });

test('a frame that repeats the previous second (phase slip between the two 1 Hz clocks) never moves the display backwards', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  store.acceptSeek(frame(3, 0, 40)); clock(900);
  assert.ok(Math.abs(store.positionFor('z')! - 40.9) < 0.01);
  store.acceptSeek(frame(3, 1000, 41)); clock(1900);
  assert.ok(Math.abs(store.positionFor('z')! - 41.9) < 0.01);
  store.acceptSeek(frame(3, 2000, 41)); // Roon's tick has not fired yet — the same second again
  clock(2000);
  assert.ok(store.positionFor('z')! >= 41.9, `must not snap back (got ${store.positionFor('z')})`);
  clock(2900);
  assert.ok(store.positionFor('z')! <= 42.0 && store.positionFor('z')! >= 41.99, 'parks at R+1 until Roon advances');
  store.acceptSeek(frame(3, 3000, 42)); clock(3500);
  assert.ok(Math.abs(store.positionFor('z')! - 42.5) < 0.01, 'climbs smoothly from the next real second');
});

test('a stalled zone parks at R+1 instead of running ahead and jumping back', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  for (let i = 0; i <= 5; i += 1) { store.acceptSeek(frame(3, i * 1000, 157)); clock(i * 1000 + 500); assert.ok(store.positionFor('z')! <= 158.0); }
  clock(5900); assert.ok(store.positionFor('z')! <= 158.0 && store.positionFor('z')! >= 157.0);
});

test('a real seek re-anchors in both directions, and a track change starts fresh from the snapshot stamp', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  store.acceptSeek(frame(3, 0, 40)); clock(500);
  store.acceptSeek(frame(3, 500, 10)); clock(600);
  assert.ok(Math.abs(store.positionFor('z')! - 10.1) < 0.01, 'previous / drag back lands at once');
  store.acceptSeek(frame(3, 1000, 95)); clock(1000);
  assert.ok(Math.abs(store.positionFor('z')! - 95) < 0.01, 'drag forward lands at once');
  clock(2000); store.accept({ ...playing(4, 2000), zones: [{ ...playing(4, 2000).zones[0], nowPlaying: { title: 'Moanin', lengthSec: 573, seek: { positionSec: 0, at: at(2000) } } }] }, true);
  clock(2800); assert.ok(Math.abs(store.positionFor('z')! - 0.8) < 0.01, 'snapshot stamp interpolates until the first frame');
  store.acceptSeek(frame(4, 3000, 0)); clock(3000); // first frame repeats second 0 — must not step back below 0.8
  assert.ok(store.positionFor('z')! >= 0.8 && store.positionFor('z')! <= 1.0);
});
