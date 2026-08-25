import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, orderByRecency, projectZone, structuralSignature } from '../src/model/snapshot.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { ZONES } from './fixtures/zones.ts';
import type { Zone } from '../src/model/types.ts';

const art = {
  pathFor: (key: unknown, size: 'cover' | 'bg') =>
    typeof key === 'string' && key !== '' ? { path: '/api/v1/art/' + size + '-' + key, key } : null,
};
const noRecency = { lastPlayedAt: () => null, runStartedAt: () => null };
const AT = '2026-08-25T21:00:00.000Z';

test('projects a zone into the wire contract without leaking Roon shape', () => {
  const zone = projectZone(ZONES[0], art, noRecency, AT);
  assert.ok(zone);
  assert.equal(zone.name, 'Study');
  assert.equal(zone.state, 'playing');
  assert.equal(zone.nowPlaying?.title, 'Piano Concerto No. 2 in C Minor, Op. 18: I. Moderato');
  assert.equal(zone.outputs.length, 2);
  assert.equal(zone.allowed.pause, true);
  assert.equal(zone.allowed.play, false);
  assert.equal(zone.nowPlaying?.seek?.positionSec, 512);
});

test('the artist backdrop comes from artist_image_keys[0] and is optional forever', () => {
  const withArtist = projectZone(ZONES[0], art, noRecency, AT);
  assert.equal(withArtist?.nowPlaying?.artistArt?.key, '43f123b4d4ad8f5d62794f8f68b847c1');
  // Internet radio: a cover, no artist keys — must project cleanly, not throw.
  const radio = projectZone(ZONES[2], art, noRecency, AT);
  assert.equal(radio?.nowPlaying?.artistArt, null);
  assert.ok(radio?.nowPlaying?.art);
});

test('a vanished or malformed artist_image_keys never breaks the projection', () => {
  for (const broken of [undefined, null, 'not-an-array', [], [null], [''], [42]]) {
    const raw = { ...(ZONES[0] as Record<string, unknown>) };
    raw.now_playing = { ...(raw.now_playing as Record<string, unknown>), artist_image_keys: broken };
    const zone = projectZone(raw, art, noRecency, AT);
    assert.equal(zone?.nowPlaying?.artistArt, null, 'broken keys: ' + JSON.stringify(broken));
    assert.ok(zone?.nowPlaying?.art, 'the cover must survive a broken artist key');
  }
});

test('the House Wall orders by most recently played, not by state', () => {
  const zones: Zone[] = [
    { id: 'a', name: 'Old', state: 'stopped', outputs: [], nowPlaying: null,
      allowed: { play: true, pause: false, next: false, previous: false, seek: false },
      lastPlayedAt: '2026-08-25T09:00:00.000Z', runStartedAt: null },
    { id: 'b', name: 'Recent', state: 'paused', outputs: [], nowPlaying: null,
      allowed: { play: true, pause: false, next: false, previous: false, seek: false },
      lastPlayedAt: '2026-08-25T20:55:00.000Z', runStartedAt: null },
    { id: 'c', name: 'Live', state: 'playing', outputs: [], nowPlaying: null,
      allowed: { play: false, pause: true, next: true, previous: true, seek: true },
      lastPlayedAt: '2026-08-25T20:00:00.000Z', runStartedAt: '2026-08-25T20:00:00.000Z' },
    { id: 'd', name: 'Never', state: 'stopped', outputs: [], nowPlaying: null,
      allowed: { play: true, pause: false, next: false, previous: false, seek: false },
      lastPlayedAt: null, runStartedAt: null },
  ];
  const ordered = orderByRecency(zones, Date.parse('2026-08-25T21:00:00.000Z'));
  assert.deepEqual(ordered.map((z) => z.id), ['c', 'b', 'a', 'd'],
    'playing counts as now; then most-recent; a zone that never played sinks last');
});

test('a track change does not reshuffle the wall', () => {
  const base: Zone = {
    id: 'x', name: 'Study', state: 'playing', outputs: [], nowPlaying: null,
    allowed: { play: false, pause: true, next: true, previous: true, seek: true },
    lastPlayedAt: '2026-08-25T20:00:00.000Z', runStartedAt: '2026-08-25T19:00:00.000Z',
  };
  const other: Zone = { ...base, id: 'y', name: 'Kitchen', runStartedAt: '2026-08-25T19:30:00.000Z' };
  const now = Date.parse('2026-08-25T21:00:00.000Z');
  const before = orderByRecency([base, other], now).map((z) => z.id);
  // A new track bumps lastPlayedAt but NOT runStartedAt — the order must hold.
  const after = orderByRecency(
    [{ ...base, lastPlayedAt: '2026-08-25T20:59:00.000Z' }, { ...other, lastPlayedAt: '2026-08-25T20:59:30.000Z' }],
    now,
  ).map((z) => z.id);
  assert.deepEqual(after, before, 'ties among live zones break on run start, not track start');
});

test('the revision signature ignores seek but catches a real change', () => {
  const ledger = new RecentLedger(null);
  const input = { zones: ZONES, coreName: 'ROCK', corePaired: true, coreSinceAt: AT, revision: 1, at: AT };
  const first = buildSnapshot(input, art, ledger);
  const moved = JSON.parse(JSON.stringify(ZONES)) as Record<string, unknown>[];
  (moved[0].now_playing as Record<string, unknown>).seek_position = 600;
  const second = buildSnapshot({ ...input, zones: moved, at: '2026-08-25T21:00:30.000Z' }, art, ledger);
  assert.equal(structuralSignature(first), structuralSignature(second), 'a seek tick must not bump the revision');

  const retitled = JSON.parse(JSON.stringify(ZONES)) as Record<string, unknown>[];
  ((retitled[0].now_playing as Record<string, unknown>).three_line as Record<string, unknown>).line1 = 'Next track';
  const third = buildSnapshot({ ...input, zones: retitled }, art, ledger);
  assert.notEqual(structuralSignature(first), structuralSignature(third), 'a new track must bump the revision');
});

test('a malformed zone is dropped rather than crashing the snapshot', () => {
  const ledger = new RecentLedger(null);
  const zones = [null, 'nonsense', {}, { zone_id: '' }, ...ZONES];
  const snapshot = buildSnapshot(
    { zones, coreName: null, corePaired: true, coreSinceAt: AT, revision: 1, at: AT }, art, ledger);
  assert.equal(snapshot.zones.length, ZONES.length);
});

test('a restart does not re-log the track that is already playing', () => {
  const ledger = new RecentLedger(null);
  ledger.observe('z1', 'Study', 'playing', 'Dis-Moi', 'Jill Barber', 'k1', '2026-08-25T16:01:00.000Z');
  ledger.observe('z1', 'Study', 'playing', 'Dis-Moi', 'Jill Barber', 'k1', '2026-08-25T16:01:30.000Z');
  assert.equal(ledger.recent().length, 1, 'the same track observed twice is one row');

  // A pause and resume is still the same track.
  ledger.observe('z1', 'Study', 'paused', 'Dis-Moi', 'Jill Barber', 'k1', '2026-08-25T16:02:00.000Z');
  ledger.observe('z1', 'Study', 'playing', 'Dis-Moi', 'Jill Barber', 'k1', '2026-08-25T16:02:30.000Z');
  assert.equal(ledger.recent().length, 1, 'a pause/resume must not log the track twice');

  // A genuinely new track does get a row.
  ledger.observe('z1', 'Study', 'playing', 'Took Me By Surprise', 'Jill Barber', 'k2', '2026-08-25T16:03:00.000Z');
  assert.equal(ledger.recent().length, 2);
  assert.equal(ledger.recent()[0].title, 'Took Me By Surprise');
});
