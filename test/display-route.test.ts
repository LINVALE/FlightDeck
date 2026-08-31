import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtRelay } from '../src/art/relay.ts';
import { DisplayRegistry } from '../src/displays/registry.ts';
import { EventHub } from '../src/http/events.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { RecentLedger } from '../src/ledger/recent.ts';

interface DisplayReply {
  readonly output: string | null;
  readonly name: string;
  readonly idleDelayMinutes: number;
}

test('each display heartbeat delivers its current delay even when its room binding is unchanged', async (t) => {
  const displays = new DisplayRegistry(null);
  const server = createFlightDeckServer({
    hub: new EventHub(),
    relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null),
    displays,
    assetDir: '',
    docDir: '',
    commands: null,
    browseAccess: null,
    mdns: () => null,
    urls: () => [],
    port: () => 0,
  });
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + String(port);

  const hello = async (face: string): Promise<DisplayReply> => {
    const response = await fetch(base + '/api/v1/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'physical-study', name: 'study · ' + face }),
    });
    assert.equal(response.status, 200);
    return await response.json() as DisplayReply;
  };

  assert.deepEqual(await hello('canvas'), {
    output: null,
    name: 'study · canvas',
    idleDelayMinutes: 15,
  });
  assert.equal(displays.bind('physical-study', 'oStudy'), true);
  assert.equal(displays.setIdleDelay('physical-study', 240), true);
  assert.deepEqual(await hello('libretto'), {
    output: 'oStudy',
    name: 'study · libretto',
    idleDelayMinutes: 240,
  });

  assert.equal(displays.setIdleDelay('physical-study', 30), true);
  const changedDelayOnly = await hello('libretto');
  assert.equal(changedDelayOnly.output, 'oStudy', 'the room binding did not change');
  assert.equal(changedDelayOnly.idleDelayMinutes, 30, 'the new delay still rides the next heartbeat');
});
