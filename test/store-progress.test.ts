import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from './support/store-harness.ts';

// 2026-08-28 (Peter): "the progress wobbles back and forth on the dial screens … just use the one Roon position
// reported every second for each zone — no correction needed". Roon's seek_position is a whole second on Roon's own
// clock and never runs backwards; interpolating it on the browser clock did. The store now shows Roon's number verbatim.
const T0 = Date.parse('2026-08-28T15:00:00.000Z');
const realNow = Date.now;
function at(ms: number): string { return new Date(T0 + ms).toISOString(); }
function clock(ms: number): void { Date.now = () => T0 + ms; }

function playing(revision = 3, seekAtMs = 0) {
  return {
    generation: 'g', revision, at: at(seekAtMs),
    zones: [{ id: 'z', name: 'Study', state: 'playing', allowed: { seek: true },
      nowPlaying: { title: 'La mer', lengthSec: 200, seek: { positionSec: 40, at: at(seekAtMs) } } }],
  };
}
function frame(revision: number, ms: number, positionSec: number) {
  return { generation: 'g', revision, at: at(ms), zones: [{ id: 'z', positionSec }] };
}

test.afterEach(() => { Date.now = realNow; });

test('the face shows the second Roon reported, verbatim — nothing is added on the browser clock', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  assert.equal(store.positionFor('z'), 40, 'before the first frame: the snapshot stamp');
  clock(900); assert.equal(store.positionFor('z'), 40, 'no interpolation from the stamp');
  store.acceptSeek(frame(3, 1000, 41)); clock(1900);
  assert.equal(store.positionFor('z'), 41);
  clock(4000); assert.equal(store.positionFor('z'), 41, 'a missing frame holds the last number; it never runs ahead');
});

test("Roon's own sequence is followed exactly — a repeated second holds, a double step steps, nothing moves back", () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  const roon = [47, 48, 50, 50, 52, 52, 53, 54]; // Study, 2026-08-28 17:05Z capture: Roon's 1 Hz seek_position verbatim
  const shown: number[] = [];
  roon.forEach((positionSec, i) => { store.acceptSeek(frame(3, i * 1000, positionSec)); clock(i * 1000 + 500); shown.push(store.positionFor('z')!); });
  assert.deepEqual(shown, roon);
});

test('a real seek lands at once in both directions; a track change starts from the new snapshot stamp', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  store.acceptSeek(frame(3, 0, 40)); store.acceptSeek(frame(3, 500, 10)); clock(600);
  assert.equal(store.positionFor('z'), 10, 'previous / drag back');
  store.acceptSeek(frame(3, 1000, 95)); clock(1000);
  assert.equal(store.positionFor('z'), 95, 'drag forward');
  clock(2000); store.accept({ ...playing(4, 2000), zones: [{ ...playing(4, 2000).zones[0], nowPlaying: { title: 'Moanin', lengthSec: 573, seek: { positionSec: 0, at: at(2000) } } }] }, true);
  assert.equal(store.positionFor('z'), 0, 'the new track starts at its own stamp, the old frames forgotten');
  store.acceptSeek(frame(4, 3000, 1)); assert.equal(store.positionFor('z'), 1);
});

test('frames from another revision or generation are ignored; the value is clamped to the track length', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  store.acceptSeek(frame(2, 0, 99)); assert.equal(store.positionFor('z'), 40, 'stale revision');
  store.acceptSeek({ generation: 'other', revision: 3, at: at(0), zones: [{ id: 'z', positionSec: 99 }] }); assert.equal(store.positionFor('z'), 40, 'other generation');
  store.acceptSeek(frame(3, 0, 260)); assert.equal(store.positionFor('z'), 200, 'never past the end of the track');
});

test('radio and loading counters are never presented as finite progress', () => {
  const store = createStore(); clock(0); store.accept(playing(), true);
  store.acceptSeek(frame(3, 1000, 96));
  assert.equal(store.positionFor('z'), 96);

  const radio = {
    ...playing(4, 2000),
    zones: [{
      ...playing(4, 2000).zones[0],
      allowed: { seek: false },
      nowPlaying: { title: 'BBC Radio 3', lengthSec: null, seek: { positionSec: 118, at: at(2000) } },
    }],
  };
  store.accept(radio, true);
  assert.equal(store.positionFor('z'), null, 'a live stream counter is not a timeline');
  store.acceptSeek(frame(4, 3000, 119));
  assert.equal(store.positionFor('z'), null, 'same-revision radio frames remain suppressed');

  const loading = {
    ...playing(5, 4000),
    zones: [{ ...playing(5, 4000).zones[0], state: 'loading' }],
  };
  store.accept(loading, true);
  assert.equal(store.positionFor('z'), null, 'loading never flashes stale finite metadata');
});

test('a late authoritative fetch cannot regress one process, but a new generation can', () => {
  const store = createStore(); clock(0);
  store.accept(playing(8), true);
  store.accept({ ...playing(5), zones: [{ ...playing(5).zones[0], nowPlaying: { ...playing(5).zones[0].nowPlaying, title: 'stale' } }] }, true);
  assert.equal(store.snapshot().revision, 8);
  assert.equal(store.snapshot().zones[0].nowPlaying.title, 'La mer');

  store.accept({ ...playing(2), generation: 'new-process' }, true);
  assert.equal(store.snapshot().revision, 2, 'a process restart resets the revision domain');
});
