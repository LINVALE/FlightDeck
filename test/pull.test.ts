import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PullCoordinator,
  PullError,
  type PullCommandPort,
  type PullErrorCode,
  type PullRequest,
  type PullSnapshotSource,
} from '../src/control/pull.ts';
import { EventHub } from '../src/http/events.ts';
import type { NowPlaying, Snapshot, Zone, ZoneState } from '../src/model/types.ts';

const ITEM: NowPlaying = {
  title: 'Kiss and Run', line2: 'Sam Jones', line3: 'The Chant',
  art: { path: '/api/v1/art/cover', key: 'cover-1' },
  artistArt: null, artistArts: [], lengthSec: 214,
  seek: { positionSec: 12, at: '2026-08-30T12:00:00.000Z' },
};
const OTHER: NowPlaying = { ...ITEM, title: 'Something Else', art: null };
const ALLOWED = { play: true, pause: true, next: true, previous: true, seek: true };

function zone(
  id: string,
  outputId: string,
  state: ZoneState,
  nowPlaying: NowPlaying | null,
  playAllowed = true,
): Zone {
  return {
    id, name: id, state,
    outputs: [{ id: outputId, name: outputId, volume: null, groupableWith: [outputId], island: outputId }],
    nowPlaying,
    allowed: { ...ALLOWED, play: playAllowed },
    settings: null, lastPlayedAt: null, runStartedAt: null,
  };
}

function snapshot(revision: number, zones: readonly Zone[], generation = 'generation-1'): Snapshot {
  return {
    generation, revision, generatedAt: '2026-08-30T12:00:00.000Z',
    core: { state: 'paired', name: 'Core', sinceAt: '2026-08-30T11:00:00.000Z' },
    zones, islands: [],
  };
}

function initial(zones?: readonly Zone[]): Snapshot {
  return snapshot(7, zones ?? [
    zone('source-zone', 'source-output', 'playing', ITEM, false),
    zone('destination-zone', 'destination-output', 'stopped', null),
  ]);
}

const REQUEST: PullRequest = {
  sourceZoneId: 'source-zone',
  destinationOutputId: 'destination-output',
  generation: 'generation-1',
  revision: 7,
};

interface Call { readonly kind: 'transfer' | 'control'; readonly target: string; readonly other: string }
interface Behaviour {
  readonly transfer?: (publish: (frame: Snapshot) => void) => void | Promise<void>;
  readonly control?: (publish: (frame: Snapshot) => void) => void | Promise<void>;
}

function harness(behaviour: Behaviour = {}, first = initial(), timeoutMs = 50) {
  const hub = new EventHub();
  hub.publish(first);
  const calls: Call[] = [];
  const commands: PullCommandPort = {
    transferZone: async (from, to) => {
      calls.push({ kind: 'transfer', target: from, other: to });
      await behaviour.transfer?.((frame) => hub.publish(frame));
    },
    control: async (output, action) => {
      calls.push({ kind: 'control', target: output, other: action });
      await behaviour.control?.((frame) => hub.publish(frame));
    },
  };
  const coordinator = new PullCoordinator({ snapshots: hub, commands, timeoutMs });
  return { hub, calls, coordinator };
}

function expectCode(code: PullErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof PullError && error.code === code;
}

test('ordered intermediate publications may precede an exact playing landing', async () => {
  const h = harness({
    transfer: (publish) => {
      publish(snapshot(8, [
        zone('source-zone', 'source-output', 'stopped', null),
        zone('destination-zone', 'destination-output', 'stopped', null),
      ]));
      publish(snapshot(9, [
        zone('source-zone', 'source-output', 'stopped', null),
        zone('new-destination-zone', 'destination-output', 'playing', { ...ITEM, seek: null }),
      ]));
    },
  });

  const outcome = await h.coordinator.pull(REQUEST);
  assert.deepEqual(outcome, {
    generation: 'generation-1', revision: 9, destinationZoneId: 'new-destination-zone', playIssued: false,
  });
  assert.deepEqual(h.calls, [{ kind: 'transfer', target: 'source-zone', other: 'destination-output' }]);
});

test('paused landing gets one Play and only a later exact active publication completes it', async () => {
  const h = harness({
    transfer: (publish) => publish(snapshot(8, [
      zone('source-zone', 'source-output', 'stopped', null),
      zone('landed-zone', 'destination-output', 'paused', ITEM),
    ])),
    control: (publish) => {
      publish(snapshot(9, [
        zone('source-zone', 'source-output', 'stopped', null),
        zone('landed-zone', 'destination-output', 'paused', ITEM),
      ]));
      publish(snapshot(10, [
        zone('source-zone', 'source-output', 'stopped', null),
        zone('landed-zone', 'destination-output', 'loading', ITEM),
      ]));
    },
  });

  const outcome = await h.coordinator.pull(REQUEST);
  assert.deepEqual(outcome, {
    generation: 'generation-1', revision: 10, destinationZoneId: 'landed-zone', playIssued: true,
  });
  assert.deepEqual(h.calls, [
    { kind: 'transfer', target: 'source-zone', other: 'destination-output' },
    { kind: 'control', target: 'destination-output', other: 'play' },
  ]);
});

test('Play acknowledgement alone is not success and never causes a second Play', async () => {
  const h = harness({
    transfer: (publish) => publish(snapshot(8, [
      zone('source-zone', 'source-output', 'stopped', null),
      zone('landed-zone', 'destination-output', 'paused', ITEM),
    ])),
  }, initial(), 20);

  await assert.rejects(h.coordinator.pull(REQUEST), expectCode('timeout'));
  assert.equal(h.calls.filter((call) => call.kind === 'control').length, 1);
});

test('a stale browser generation/revision fence is rejected before transport I/O', async () => {
  const h = harness();
  await assert.rejects(h.coordinator.pull({ ...REQUEST, revision: 6 }), expectCode('stale-request'));
  await assert.rejects(h.coordinator.pull({ ...REQUEST, generation: 'old-process' }), expectCode('stale-request'));
  assert.equal(h.calls.length, 0);
});

test('observation is installed before the fence is rechecked and transfer is sent', async () => {
  const hub = new EventHub();
  hub.publish(initial());
  const source: PullSnapshotSource = {
    snapshot: () => hub.snapshot(),
    observe: (observer) => {
      const stop = hub.observe(observer);
      hub.publish(snapshot(8, [
        zone('source-zone', 'source-output', 'playing', ITEM),
        zone('destination-zone', 'destination-output', 'stopped', null),
      ]));
      return stop;
    },
  };
  let transfers = 0;
  const coordinator = new PullCoordinator({
    snapshots: source,
    commands: {
      transferZone: async () => { transfers += 1; },
      control: async () => {},
    },
  });

  await assert.rejects(coordinator.pull(REQUEST), expectCode('stale-request'));
  assert.equal(transfers, 0);
});

test('a destination already showing the source identity is rejected as unprovable', async () => {
  const h = harness({}, initial([
    zone('source-zone', 'source-output', 'playing', ITEM),
    zone('destination-zone', 'destination-output', 'paused', { ...ITEM, seek: null }),
  ]));
  await assert.rejects(h.coordinator.pull(REQUEST), expectCode('destination-ambiguous'));
  assert.equal(h.calls.length, 0);
});

test('duplicate ownership of the durable destination output is rejected before transfer', async () => {
  const h = harness({}, initial([
    zone('source-zone', 'source-output', 'playing', ITEM),
    zone('destination-a', 'destination-output', 'stopped', null),
    zone('destination-b', 'destination-output', 'stopped', null),
  ]));
  await assert.rejects(h.coordinator.pull(REQUEST), expectCode('destination-ambiguous'));
  assert.equal(h.calls.length, 0);
});

test('a publication gap and a process-generation change both fail passive', async (t) => {
  await t.test('revision gap', async () => {
    const h = harness({
      transfer: (publish) => publish(snapshot(9, [
        zone('landed-zone', 'destination-output', 'playing', ITEM),
      ])),
    });
    await assert.rejects(h.coordinator.pull(REQUEST), expectCode('revision-drift'));
    assert.equal(h.calls.filter((call) => call.kind === 'control').length, 0);
  });
  await t.test('generation change', async () => {
    const h = harness({
      transfer: (publish) => publish(snapshot(8, [
        zone('landed-zone', 'destination-output', 'playing', ITEM),
      ], 'generation-2')),
    });
    await assert.rejects(h.coordinator.pull(REQUEST), expectCode('generation-drift'));
    assert.equal(h.calls.filter((call) => call.kind === 'control').length, 0);
  });
});

test('a transient both-ends publication waits rather than issuing an early Play', async () => {
  const h = harness({
    transfer: (publish) => {
      publish(snapshot(8, [
        zone('source-zone', 'source-output', 'playing', ITEM),
        zone('landed-zone', 'destination-output', 'paused', ITEM),
      ]));
      publish(snapshot(9, [
        zone('source-zone', 'source-output', 'stopped', null),
        zone('landed-zone', 'destination-output', 'paused', ITEM),
      ]));
    },
    control: (publish) => publish(snapshot(10, [
      zone('source-zone', 'source-output', 'stopped', null),
      zone('landed-zone', 'destination-output', 'playing', ITEM),
    ])),
  });

  const outcome = await h.coordinator.pull(REQUEST);
  assert.equal(outcome.revision, 10);
  assert.equal(h.calls.filter((call) => call.kind === 'control').length, 1);
});

test('source item drift before landing and forbidden Play both fail passive', async (t) => {
  await t.test('source identity drift', async () => {
    const h = harness({
      transfer: (publish) => publish(snapshot(8, [
        zone('source-zone', 'source-output', 'playing', OTHER),
        zone('destination-zone', 'destination-output', 'stopped', null),
      ])),
    });
    await assert.rejects(h.coordinator.pull(REQUEST), expectCode('identity-drift'));
    assert.equal(h.calls.filter((call) => call.kind === 'control').length, 0);
  });
  await t.test('Play not allowed', async () => {
    const h = harness({
      transfer: (publish) => publish(snapshot(8, [
        zone('source-zone', 'source-output', 'stopped', null),
        zone('landed-zone', 'destination-output', 'paused', ITEM, false),
      ])),
    });
    await assert.rejects(h.coordinator.pull(REQUEST), expectCode('play-not-allowed'));
    assert.equal(h.calls.filter((call) => call.kind === 'control').length, 0);
  });
});

test('one shared coordinator excludes overlap and close cancels the owner', async () => {
  let releaseTransfer = (): void => { throw new Error('transfer was not waiting'); };
  const h = harness({
    transfer: async () => {
      await new Promise<void>((resolve) => { releaseTransfer = resolve; });
    },
  }, initial(), 100);
  const first = h.coordinator.pull(REQUEST);
  await Promise.resolve();
  await assert.rejects(h.coordinator.pull(REQUEST), expectCode('busy'));
  h.coordinator.close();
  releaseTransfer();
  await assert.rejects(first, expectCode('closed'));
  await assert.rejects(h.coordinator.pull(REQUEST), expectCode('closed'));
});

test('transfer failure releases ownership without sending Play', async () => {
  const h = harness({ transfer: () => { throw new Error('Core away'); } });
  await assert.rejects(h.coordinator.pull(REQUEST), expectCode('transfer-failed'));
  assert.deepEqual(h.calls, [{ kind: 'transfer', target: 'source-zone', other: 'destination-output' }]);
  assert.equal(h.coordinator.active, false);
});
