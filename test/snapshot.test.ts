import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, islandOf, orderByRecency, projectZone, structuralSignature } from '../src/model/snapshot.ts';
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
  const input = { generation: 'test', zones: ZONES, coreName: 'ROCK', corePaired: true, coreSinceAt: AT, revision: 1, at: AT };
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
    { generation: 'test', zones, coreName: null, corePaired: true, coreSinceAt: AT, revision: 1, at: AT }, art, ledger);
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

test('a face URL accepts a zone NAME, preferring the room that is playing', async () => {
  const { resolveZone, zoneSlug } = await import('../src/http/pages.ts');
  const zones = [
    { id: 'idA', name: 'Study RHEOS', state: 'playing' },
    { id: 'idB', name: 'Study Airplay', state: 'paused' },
    { id: 'idC', name: 'Study ROON', state: 'paused' },
    { id: 'idD', name: 'Dining Room', state: 'stopped' },
  ];
  assert.equal(zoneSlug('Study RHEOS'), 'studyrheos');
  // the real id still wins
  assert.equal(resolveZone(zones, 'idB'), 'idB');
  // a partial name lands on the room making sound
  assert.equal(resolveZone(zones, 'study'), 'idA');
  // an exact name beats the playing preference
  assert.equal(resolveZone(zones, 'Study Airplay'), 'idB');
  assert.equal(resolveZone(zones, 'studyroon'), 'idC');
  // punctuation and case are irrelevant
  assert.equal(resolveZone(zones, 'dining-room'), 'idD');
  assert.equal(resolveZone(zones, 'DINING ROOM'), 'idD');
  // nothing sensible: null, so the client can say so rather than guess
  assert.equal(resolveZone(zones, 'garage'), null);
  assert.equal(resolveZone(zones, ''), null);
});

test('a grouped zone is still findable by the ROOM name, which lives on its outputs', async () => {
  const { resolveZone } = await import('../src/http/pages.ts');
  // What Roon does when rooms are grouped: the ZONE takes the group's name and
  // the rooms survive only as outputs.
  const zones = [
    {
      id: 'grp', name: 'Downstairs', state: 'playing',
      outputs: [{ name: 'Kitchen' }, { name: 'Dining Room' }, { name: 'Family Room' }],
    },
    { id: 'std', name: 'Study RHEOS', state: 'paused', outputs: [{ name: 'Study RHEOS' }] },
  ];
  assert.equal(resolveZone(zones, 'kitchen'), 'grp', 'a room inside a group must still resolve');
  assert.equal(resolveZone(zones, 'dining-room'), 'grp');
  assert.equal(resolveZone(zones, 'downstairs'), 'grp', 'the group name works too');
  assert.equal(resolveZone(zones, 'study'), 'std');
  assert.equal(resolveZone(zones, 'garage'), null);
});

test('a display binds to its OUTPUT, so grouping the room does not strand it', async () => {
  const { resolveOutput } = await import('../src/http/pages.ts');
  // Ungrouped: the Study speaker is its own zone.
  const alone = [
    { id: 'zStudy', name: 'Study RHEOS', state: 'playing', outputs: [{ id: 'oStudy', name: 'Study RHEOS' }] },
    { id: 'zKit', name: 'Kitchen RHEOS', state: 'stopped', outputs: [{ id: 'oKit', name: 'Kitchen RHEOS' }] },
  ];
  const bound = resolveOutput(alone, 'study');
  assert.deepEqual(bound, { outputId: 'oStudy', zoneId: 'zStudy' });
  assert.deepEqual(resolveOutput(alone, 'oStudy'), { outputId: 'oStudy', zoneId: 'zStudy' },
    'the durable output id itself is a bookmarkable room identity');

  // Grouped: the SAME output now sits inside Downstairs. The screen must follow
  // it there, because that is what the speaker beside the TV is playing.
  const grouped = [
    {
      id: 'zDown', name: 'Downstairs', state: 'playing',
      outputs: [{ id: 'oKit', name: 'Kitchen RHEOS' }, { id: 'oStudy', name: 'Study RHEOS' }],
    },
  ];
  const regrouped = resolveOutput(grouped, 'study');
  assert.equal(regrouped?.outputId, 'oStudy', 'the output identity is stable');
  assert.equal(regrouped?.zoneId, 'zDown', 'the ZONE follows the grouping');
  assert.deepEqual(resolveOutput(grouped, 'oStudy'), { outputId: 'oStudy', zoneId: 'zDown' },
    'the same Wall link follows its physical room into the successor group');

  // A group name is not an output, so it does not resolve here — the zone
  // fallback handles it.
  assert.equal(resolveOutput(grouped, 'downstairs'), null);
});

/**
 * Roon's own vocabulary, kept verbatim: 'disabled' | 'loop' | 'loop_one'. A Core
 * that says something else, or nothing, must read as OFF rather than as a value
 * the buttons cannot draw.
 */
test('queue settings are projected, and anything unrecognised reads as off', () => {
  const build = (settings: unknown) =>
    projectZone({ zone_id: 'z', display_name: 'Z', state: 'playing', outputs: [], settings },
      art, noRecency, AT)?.settings ?? null;

  assert.deepEqual(build({ shuffle: true, loop: 'loop_one', auto_radio: true }),
    { shuffle: true, loop: 'loop_one', autoRadio: true });
  assert.deepEqual(build({ shuffle: false, loop: 'nonsense', auto_radio: false }),
    { shuffle: false, loop: 'disabled', autoRadio: false });
  assert.deepEqual(build({}), { shuffle: false, loop: 'disabled', autoRadio: false });
  assert.equal(build(undefined), null, 'a Core that never said must stay null, not guess');
});

test('a change to shuffle or repeat reaches the screen', () => {
  const build = (settings: unknown) => buildSnapshot({
    generation: 'g', revision: 1, at: AT, coreName: 'C', corePaired: true, coreSinceAt: AT,
    zones: [{ zone_id: 'z', display_name: 'Z', state: 'playing', outputs: [], settings }],
  }, art, new RecentLedger(null));
  const off = structuralSignature(build({ shuffle: false, loop: 'disabled' }));
  assert.notEqual(off, structuralSignature(build({ shuffle: true, loop: 'disabled' })));
  assert.notEqual(off, structuralSignature(build({ shuffle: false, loop: 'loop' })));
});

/**
 * Roon never names the protocol — an output carries only id, name, volume, source
 * controls, zone and `can_group_with_output_ids` — so the RELATION is the
 * taxonomy. It is safe to read as an equivalence class: measured on a live Core,
 * 22 outputs gave exactly three membership lists, every one closed and identical
 * for all its members.
 */
test('outputs share an island exactly when Roon gives them the same membership', () => {
  const raat = ['oA', 'oB', 'oC'];
  assert.equal(islandOf(raat), islandOf(['oC', 'oA', 'oB']), 'order must not matter');
  assert.notEqual(islandOf(raat), islandOf(['oA', 'oB']), 'a different membership is a different island');
  assert.equal(islandOf(['oA']), '', 'an output that can group with nothing has no island');
  assert.equal(islandOf([]), '', 'and neither has one Roon said nothing about');
});

test('the island reaches the screen on every output', () => {
  const zone = projectZone({
    zone_id: 'z', display_name: 'Z', state: 'playing',
    outputs: [
      { output_id: 'oA', display_name: 'A', can_group_with_output_ids: ['oA', 'oB'] },
      { output_id: 'oB', display_name: 'B', can_group_with_output_ids: ['oA', 'oB'] },
      { output_id: 'oLone', display_name: 'Lone' },
    ],
  }, art, noRecency, AT);
  assert.ok(zone);
  assert.equal(zone.outputs[0].island, zone.outputs[1].island);
  assert.notEqual(zone.outputs[0].island, '');
  assert.equal(zone.outputs[2].island, '', 'no peers, no island');
});

/** A Roon Ready amp's power rides the wire as the honest word for "asleep". */
test('an output that supports standby carries its power; one that does not carries null', async () => {
  const { buildSnapshot } = await import('../src/model/snapshot.ts');
  const { ArtRelay } = await import('../src/art/relay.ts');
  const { RecentLedger } = await import('../src/ledger/recent.ts');
  const { ZONES } = await import('./fixtures/zones.ts');
  const snapshot = buildSnapshot(
    { generation: 'g', zones: ZONES, coreName: 'ROCK', corePaired: true, coreSinceAt: '2026-09-03T00:00:00Z', revision: 1, at: '2026-09-03T00:00:00Z' },
    new ArtRelay({ artworkUrl: () => '' }), new RecentLedger(null));
  const study = snapshot.zones.find((z) => z.id === '1601abc');
  assert.ok(study);
  assert.deepEqual(study.outputs[0].power, { wakeable: true, asleep: false, controlKey: '1' });
  assert.equal(study.outputs[1].power, null);
});

/**
 * ⚖️ ROON'S OWN LIMIT IS THE CEILING (Peter, 2026-09-05). The wire's volume
 * object carries `soft_limit` (measured on the Core); the snapshot carries it
 * as softLimit and never invents one.
 */
test('an output\'s soft_limit is carried as softLimit, null when Roon did not say', () => {
  const raw = ZONES[0] as unknown as { outputs: { volume?: Record<string, unknown> }[] };
  const plain = projectZone(ZONES[0], art, noRecency, AT);
  const plainVolume = plain?.outputs[0].volume;
  assert.ok(plainVolume === null || plainVolume === undefined || plainVolume.softLimit === null, 'null when Roon did not say');
  const limited = {
    ...(ZONES[0] as unknown as Record<string, unknown>),
    outputs: [{ ...raw.outputs[0], volume: { ...(raw.outputs[0].volume ?? {}), soft_limit: 60 } }, ...raw.outputs.slice(1)],
  } as unknown as Parameters<typeof projectZone>[0];
  const zone = projectZone(limited, art, noRecency, AT);
  assert.equal(zone?.outputs[0].volume?.softLimit, 60);
  // Peter 09-06: the SAFETY level (hard_limit_max) rides beside the comfort level
  const bothLimited = {
    ...(ZONES[0] as unknown as Record<string, unknown>),
    outputs: [{ ...raw.outputs[0], volume: { ...(raw.outputs[0].volume ?? {}), soft_limit: 60, hard_limit_max: 85 } }, ...raw.outputs.slice(1)],
  } as unknown as Parameters<typeof projectZone>[0];
  const both = projectZone(bothLimited, art, noRecency, AT);
  assert.equal(both?.outputs[0].volume?.hardLimitMax, 85);
  assert.equal(zone?.outputs[0].volume?.hardLimitMax, null, 'null when Roon did not say');
});
