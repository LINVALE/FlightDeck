import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { createFlightDeckServer, listenWithLadder, type QueueAccess } from '../src/http/server.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { QueueError, type QueueSnapshot } from '../src/roon/queue.ts';

const ASSETS = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets');
const DOCS = resolve(fileURLToPath(import.meta.url), '..', '..', 'docs');
const ZONE_ID = 'zone-study';
const GENERATION = 'queue-route-generation';

async function serve(
  t: { after: (fn: () => void) => void }, queue?: QueueAccess | null,
): Promise<{ base: string }> {
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  const ledger = new RecentLedger(null);
  const server = createFlightDeckServer({
    hub, relay, ledger, queueAccess: queue, assetDir: ASSETS, docDir: DOCS,
    commands: null, browseAccess: null, mdns: () => null, urls: () => [], port: () => 0,
  });
  const now = new Date().toISOString();
  hub.publish(buildSnapshot({
    generation: GENERATION,
    revision: 12,
    at: now,
    coreName: 'Core',
    corePaired: true,
    coreSinceAt: now,
    zones: [{
      zone_id: ZONE_ID,
      display_name: 'Study',
      state: 'playing',
      outputs: [{ output_id: 'output-study', display_name: 'Study' }],
      is_play_allowed: false,
      is_pause_allowed: true,
      is_next_allowed: true,
      is_previous_allowed: true,
      is_seek_allowed: true,
    }],
  }, relay, ledger));
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  return { base: 'http://127.0.0.1:' + String(port) };
}

function queueSnapshot(count: number): QueueSnapshot {
  return {
    zoneId: ZONE_ID,
    ready: true,
    revision: 7,
    atLimit: true,
    items: Array.from({ length: count }, (_, index) => ({
      qid: index + 41,
      title: index === 0 ? 'Current\u0007 track' : 'Track ' + String(index + 1),
      artist: 'Artist ' + String(index + 1),
      album: 'Album ' + String(index + 1),
      length: 120 + index,
      imageKey: index === 0 ? 'cover123' : null,
    })),
  };
}

test('GET queue projects one bounded, sanitized zone window with relayed artwork', async (t) => {
  let current = queueSnapshot(55);
  const seen: string[] = [];
  const queue: QueueAccess = {
    snapshot: (zoneId) => { seen.push(zoneId); return current; },
    playFromHere: async () => {},
  };
  const { base } = await serve(t, queue);

  const response = await fetch(base + '/api/v1/queue?zone=' + ZONE_ID);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.generation, GENERATION);
  assert.equal(body.ready, true);
  assert.equal(body.revision, 7);
  assert.equal(body.currentIndex, 0);
  assert.equal(body.atLimit, true);
  const items = body.items as Record<string, unknown>[];
  assert.equal(items.length, 50, 'the HTTP boundary keeps the Roon window bounded');
  assert.equal(items[0].id, '41', 'opaque queue ids cross HTTP as strings');
  assert.equal(items[0].title, 'Current  track', 'control characters cannot reach a face');
  assert.equal(items[0].lengthSec, 120);
  assert.match(String(items[0].art), /^\/api\/v1\/art\//);
  assert.ok(!JSON.stringify(body).includes('imageKey'));
  assert.ok(!JSON.stringify(body).includes('qid'));
  assert.deepEqual(seen, [ZONE_ID]);

  current = { zoneId: ZONE_ID, ready: false, revision: 0, atLimit: false, items: [] };
  const loading = await (await fetch(base + '/api/v1/queue?zone=' + ZONE_ID)).json() as Record<string, unknown>;
  assert.equal(loading.ready, false);
  assert.equal(loading.currentIndex, null);
  assert.deepEqual(loading.items, []);
});

test('GET queue distinguishes bad zones, unavailable access and a loading cache', async (t) => {
  const queue: QueueAccess = {
    snapshot: () => null,
    playFromHere: async () => {},
  };
  const { base } = await serve(t, queue);
  assert.equal((await fetch(base + '/api/v1/queue')).status, 400);
  assert.equal((await fetch(base + '/api/v1/queue?zone=vanished')).status, 404);
  assert.equal((await fetch(base + '/api/v1/queue?zone=' + ZONE_ID)).status, 503);

  await t.test('the optional dependency preserves preview and old test callers', async (inner) => {
    const absent = await serve(inner);
    assert.equal((await fetch(absent.base + '/api/v1/queue?zone=' + ZONE_ID)).status, 503);
  });
});

test('POST queue requires same-origin and the exact generation, zone and queue revision fence', async (t) => {
  const calls: unknown[][] = [];
  const queue: QueueAccess = {
    snapshot: () => queueSnapshot(2),
    playFromHere: async (...args) => { calls.push(args); },
  };
  const { base } = await serve(t, queue);
  const post = (body: unknown, origin = base) => fetch(base + '/api/v1/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });

  const accepted = await post({
    zone: ZONE_ID, itemId: '42', generation: GENERATION, queueRevision: 7,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true });
  assert.deepEqual(calls, [[ZONE_ID, '42', 7]]);

  assert.equal((await post({
    zone: ZONE_ID, itemId: '42', generation: GENERATION, queueRevision: 7,
  }, 'http://evil.example')).status, 403);
  assert.equal((await post({
    zone: ZONE_ID, itemId: '42', generation: 'old-generation', queueRevision: 7,
  })).status, 409);
  assert.equal((await post({
    zone: 'vanished', itemId: '42', generation: GENERATION, queueRevision: 7,
  })).status, 404);
  assert.equal((await post({
    zone: ZONE_ID, item: '42', generation: GENERATION, revision: 7,
  })).status, 400, 'legacy item/revision names cannot bypass the queue fence');
  assert.equal(calls.length, 1, 'every refused request stops before the gateway');
});

test('POST queue maps each QueueError without hiding stale or unavailable state', async (t) => {
  let failure: unknown = null;
  const queue: QueueAccess = {
    snapshot: () => queueSnapshot(2),
    playFromHere: async () => { throw failure; },
  };
  const { base } = await serve(t, queue);
  const post = () => fetch(base + '/api/v1/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      zone: ZONE_ID, itemId: '42', generation: GENERATION, queueRevision: 7,
    }),
  });
  const specimens = [
    { code: 'invalid', status: 400 },
    { code: 'stale', status: 409 },
    { code: 'current', status: 409 },
    { code: 'unavailable', status: 503 },
    { code: 'core-rejected', status: 502 },
  ] as const;
  for (const specimen of specimens) {
    failure = new QueueError(specimen.code, 'deliberate ' + specimen.code);
    const response = await post();
    assert.equal(response.status, specimen.status, specimen.code);
    assert.deepEqual(await response.json(), {
      error: 'deliberate ' + specimen.code,
      code: specimen.code,
    });
  }

  failure = new Error('unexpected gateway failure');
  const unexpected = await post();
  assert.equal(unexpected.status, 502);
  assert.deepEqual(await unexpected.json(), { error: 'unexpected gateway failure' });
});
