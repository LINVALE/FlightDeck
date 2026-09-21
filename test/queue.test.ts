import assert from 'node:assert/strict';
import test from 'node:test';
import { QUEUE_MAX_ITEMS, QueueError, QueueGateway } from '../src/roon/queue.ts';

type QueueCallback = (event: unknown, body: unknown) => void;
type PlayCallback = (message: unknown, body: unknown) => void;

interface SubscriptionCall {
  readonly zoneId: string;
  readonly max: number;
  readonly callback: QueueCallback;
  unsubscribes: number;
}

interface PlayCall {
  readonly zoneId: string;
  readonly queueItemId: number;
  readonly callback: PlayCallback;
}

function serviceHarness() {
  const calls: SubscriptionCall[] = [];
  const plays: PlayCall[] = [];
  const service = {
    subscribe_queue(zoneId: string, max: number, callback: QueueCallback) {
      const call: SubscriptionCall = { zoneId, max, callback, unsubscribes: 0 };
      calls.push(call);
      return { unsubscribe: () => { call.unsubscribes += 1; } };
    },
    play_from_here(zoneId: string, queueItemId: number, callback: PlayCallback) {
      plays.push({ zoneId, queueItemId, callback });
    },
  };
  return { service, calls, plays };
}

function raw(qid: number, title = 'Track ' + String(qid)) {
  return {
    queue_item_id: qid,
    image_key: 'image-' + String(qid),
    length: 100 + qid,
    three_line: { line1: title, line2: 'Artist ' + String(qid), line3: 'Album ' + String(qid) },
  };
}

function rejectsWith(code: QueueError['code']): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof QueueError);
    assert.equal(error.code, code);
    return true;
  };
}

test('reconcile owns one bounded subscription per current zone and projects a safe ordered snapshot', () => {
  const harness = serviceHarness();
  const gateway = new QueueGateway();
  gateway.reconcile(harness.service, [{ id: 'study' }, { zone_id: 'garden' }, 'study', { id: 9 }]);
  gateway.reconcile(harness.service, ['study', 'garden']);

  assert.deepEqual(harness.calls.map((call) => [call.zoneId, call.max]), [
    ['study', QUEUE_MAX_ITEMS], ['garden', QUEUE_MAX_ITEMS],
  ], 'repeated zones and repeated reconciliation cannot duplicate subscriptions');
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: false, revision: 0, atLimit: false, items: [],
  });

  harness.calls[0].callback('Subscribed', { items: [
    {
      queue_item_id: 41,
      image_key: 'cover\u0000-key',
      length: 245.5,
      three_line: { line1: 'Current\u0007 song', line2: 'The Artist', line3: 'The Album' },
    },
    { queue_item_id: '42', two_line: { line1: 'Next song' }, length: -2, image_key: 12 },
    null,
    { queue_item_id: 'not-a-qid', three_line: { line1: 'unsafe identity' } },
  ] });

  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study',
    ready: true,
    revision: 1,
    atLimit: false,
    items: [
      {
        qid: 41, title: 'Current  song', artist: 'The Artist', album: 'The Album',
        length: 245.5, imageKey: 'cover-key',
      },
      { qid: '42', title: 'Next song', artist: '', album: '', length: null, imageKey: null },
    ],
  }, 'index zero remains Roon current and malformed items cannot cross the boundary');

  const detached = gateway.snapshot('study');
  (detached?.items as { title: string }[])[0].title = 'mutated by caller';
  assert.equal(gateway.snapshot('study')?.items[0]?.title, 'Current  song');
});

test('Changed insert, remove and replace operations fold sequentially, revise and expose a literal limit', () => {
  const harness = serviceHarness();
  const gateway = new QueueGateway();
  gateway.reconcile(harness.service, ['study']);
  const call = harness.calls[0];

  call.callback('Subscribed', { items: [raw(1), raw(2), raw(3)] });
  assert.equal(gateway.snapshot('study')?.revision, 1);
  call.callback('Changed', { changes: [
    { operation: 'insert', index: 1, items: [raw(4)] },
    { operation: 'remove', index: 0, count: 1 },
    { operation: 'replace', index: 1, items: [raw(5)] },
  ] });
  assert.deepEqual(gateway.snapshot('study')?.items.map((item) => item.qid), [4, 5, 3]);
  assert.equal(gateway.snapshot('study')?.revision, 2);

  call.callback('Subscribed', { items: Array.from({ length: 70 }, (_, index) => raw(index + 1)) });
  assert.equal(gateway.snapshot('study')?.revision, 3);
  assert.equal(gateway.snapshot('study')?.items.length, QUEUE_MAX_ITEMS);
  assert.equal(gateway.snapshot('study')?.atLimit, true,
    'atLimit means only that the bounded raw window is full');
  call.callback('Changed', { changes: [
    { operation: 'remove', index: QUEUE_MAX_ITEMS - 1, count: 1 },
  ] });
  assert.equal(gateway.snapshot('study')?.revision, 4);
  assert.equal(gateway.snapshot('study')?.items.length, QUEUE_MAX_ITEMS - 1);
  assert.equal(gateway.snapshot('study')?.atLimit, false);
});

test('an invalid delta is discarded and resubscribed without letting its callback reach the successor', () => {
  const harness = serviceHarness();
  const gateway = new QueueGateway();
  gateway.reconcile(harness.service, ['study']);
  const stale = harness.calls[0];
  stale.callback('Subscribed', { items: [raw(1), raw(2)] });

  stale.callback('Changed', { changes: [
    { operation: 'insert', index: 1, items: [raw(8)] },
    { operation: 'remove', index: 99, count: 1 },
  ] });

  assert.equal(stale.unsubscribes, 1, 'the malformed stream is retired exactly once');
  assert.equal(harness.calls.length, 2, 'a fresh full-window subscription starts immediately');
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: false, revision: 0, atLimit: false, items: [],
  }, 'no partially applied delta crosses into the replacement cache');

  stale.callback('Subscribed', { items: [raw(90)] });
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: false, revision: 0, atLimit: false, items: [],
  }, 'late events from the malformed subscription stay fenced');

  harness.calls[1].callback('Subscribed', { items: [raw(4)] });
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: true, revision: 1, atLimit: false,
    items: [{
      qid: 4, title: 'Track 4', artist: 'Artist 4', album: 'Album 4',
      length: 104, imageKey: 'image-4',
    }],
  });
});

test('zone successors, service epochs and unpair retire each subscription exactly once', () => {
  const first = serviceHarness();
  const second = serviceHarness();
  const gateway = new QueueGateway();

  gateway.reconcile(first.service, ['study']);
  const stale = first.calls[0];
  stale.callback('Subscribed', { items: [raw(1)] });

  gateway.reconcile(first.service, []);
  gateway.reconcile(first.service, []);
  assert.equal(stale.unsubscribes, 1, 'a vanished zone has one teardown owner');

  gateway.reconcile(first.service, ['study']);
  const successor = first.calls[1];
  stale.callback('Subscribed', { items: [raw(90)] });
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: false, revision: 0, atLimit: false, items: [],
  },
    'a removed zone callback cannot mutate its same-id successor');
  successor.callback('Subscribed', { items: [raw(2)] });

  gateway.reconcile(second.service, ['study']);
  assert.equal(successor.unsubscribes, 1, 'a replacement transport retires the prior epoch once');
  const current = second.calls[0];
  successor.callback('Changed', { changes: [{ operation: 'replace', index: 0, items: [raw(91)] }] });
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: false, revision: 0, atLimit: false, items: [],
  },
    'an old service callback cannot settle the same zone in the new epoch');
  current.callback('Subscribed', { items: [raw(3)] });
  assert.equal(gateway.snapshot('study')?.items[0]?.qid, 3);

  gateway.reconcile(null, ['study']);
  gateway.reconcile(null, []);
  gateway.dispose();
  // 09-21: unpair means the connection is gone; unsubscribing into it crashed the SDK (moo.js:206).
  assert.equal(current.unsubscribes, 0, 'unpair forgets its subscriptions and sends nothing, and disposal adds nothing');
  assert.equal(gateway.available(), false);
  assert.equal(gateway.snapshot('study'), null);
});

test('playFromHere requires a ready, fresh, canonical and upcoming queue identity', async () => {
  const harness = serviceHarness();
  const gateway = new QueueGateway();
  gateway.reconcile(harness.service, ['study']);

  await assert.rejects(gateway.playFromHere('study', '2', 0), rejectsWith('unavailable'));
  harness.calls[0].callback('Subscribed', { items: [raw(1), raw(2), raw(3)] });
  const revision = gateway.snapshot('study')?.revision ?? -1;

  await assert.rejects(gateway.playFromHere('study', '2', revision - 1), rejectsWith('stale'));
  await assert.rejects(gateway.playFromHere('study', '02', revision), rejectsWith('invalid'));
  await assert.rejects(gateway.playFromHere('study', '1', revision), rejectsWith('current'));
  await assert.rejects(gateway.playFromHere('study', '99', revision), rejectsWith('stale'));
  assert.equal(harness.plays.length, 0, 'no rejected fence may reach Roon');

  harness.calls[0].callback('Changed', {
    changes: [{ operation: 'replace', index: 2, items: [raw(4)] }],
  });
  assert.equal(gateway.snapshot('study')?.revision, revision + 1);
  await assert.rejects(gateway.playFromHere('study', '2', revision), rejectsWith('stale'),
    'even an unchanged item id needs the current cache revision');
  assert.equal(harness.plays.length, 0);
});

test('playFromHere sends the numeric queue id and settles only from the Core callback result', async () => {
  const harness = serviceHarness();
  const gateway = new QueueGateway();
  gateway.reconcile(harness.service, ['study']);
  harness.calls[0].callback('Subscribed', { items: [raw(1), raw(2)] });
  const revision = gateway.snapshot('study')?.revision ?? -1;

  const accepted = gateway.playFromHere('study', '2', revision);
  assert.deepEqual(harness.plays.map((call) => [call.zoneId, call.queueItemId]), [['study', 2]]);
  harness.plays[0].callback({ name: 'Success' }, { ignored: true });
  await accepted;

  const refused = gateway.playFromHere('study', '2', revision);
  assert.equal(harness.plays.length, 2);
  harness.plays[1].callback({ name: 'InvalidRequest' }, { name: 'Success' });
  await assert.rejects(refused, rejectsWith('core-rejected'),
    'a success-looking body cannot override the callback message');
});

test('subscription errors retire the cache and late callbacks stay fenced', () => {
  const harness = serviceHarness();
  const gateway = new QueueGateway();
  gateway.reconcile(harness.service, ['study']);
  const failed = harness.calls[0];
  failed.callback('NetworkError', { message: 'gone' });
  // 09-21: a network error means the connection closed; there is nothing to end.
  assert.equal(failed.unsubscribes, 0);
  assert.equal(gateway.snapshot('study'), null);
  failed.callback('Subscribed', { items: [raw(8)] });
  assert.equal(gateway.snapshot('study'), null);

  gateway.reconcile(harness.service, ['study']);
  assert.equal(harness.calls.length, 2, 'a later reconciliation may create a clean successor');
  harness.calls[1].callback('Subscribed', { items: [] });
  assert.deepEqual(gateway.snapshot('study'), {
    zoneId: 'study', ready: true, revision: 1, atLimit: false, items: [],
  });
});
