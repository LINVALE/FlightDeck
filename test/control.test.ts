import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder, type Commands } from '../src/http/server.ts';

const ASSETS = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets');
const DOCS = resolve(fileURLToPath(import.meta.url), '..', '..', 'docs');

/** Two zones: one that allows everything, one that allows nothing and has a fixed-volume output. */
const ZONES: unknown[] = [
  {
    zone_id: 'zPlay', display_name: 'Study', state: 'playing',
    outputs: [{ output_id: 'oStudy', display_name: 'Study', can_group_with_output_ids: ['oStudy', 'oPeer'], volume: { type: 'number', min: 0, max: 100, value: 40, step: 1, is_muted: false } }],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: true, is_previous_allowed: true, is_seek_allowed: true,
    now_playing: { seek_position: 10, length: 200, image_key: 'k1', three_line: { line1: 'A Track', line2: 'An Artist', line3: 'An Album' } },
    settings: { shuffle: true, loop: 'loop', auto_radio: false },
  },
  {
    zone_id: 'zRadio', display_name: 'Garden', state: 'playing',
    outputs: [{ output_id: 'oFixed', display_name: 'Garden Fixed' }],   // no volume control, and its own island
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: false, is_previous_allowed: false, is_seek_allowed: false,
    now_playing: { seek_position: 3, image_key: 'k2', three_line: { line1: 'Radio', line2: 'Station', line3: '' } },
  },
  {
    // same island as Study, and silent: the room a group would be formed with
    zone_id: 'zPeer', display_name: 'Kitchen', state: 'stopped',
    outputs: [{ output_id: 'oPeer', display_name: 'Kitchen', can_group_with_output_ids: ['oStudy', 'oPeer'] }],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: false, is_previous_allowed: false, is_seek_allowed: false,
  },
];

interface Sent { kind: string; a: string; b: unknown; c?: unknown }

async function serve(t: { after: (fn: () => void) => void }) {
  const sent: Sent[] = [];
  const commands: Commands = {
    control: async (zone, action) => { sent.push({ kind: 'control', a: zone, b: action }); },
    seek: async (zone, seconds) => { sent.push({ kind: 'seek', a: zone, b: seconds }); },
    setVolume: async (output, value) => { sent.push({ kind: 'setVolume', a: output, b: value }); },
    changeVolume: async (output, steps, incremental) => { sent.push({ kind: 'volume', a: output, b: steps, c: incremental }); },
    mute: async (output, muted) => { sent.push({ kind: 'mute', a: output, b: muted }); },
    changeSettings: async (zone, settings) => { sent.push({ kind: 'settings', a: zone, b: settings }); },
    groupOutputs: async (ids) => { sent.push({ kind: 'group', a: ids.join('+'), b: null }); },
    ungroupOutputs: async (ids) => { sent.push({ kind: 'ungroup', a: ids.join('+'), b: null }); },
    transferZone: async (from, to) => { sent.push({ kind: 'transfer', a: from, b: to }); },
  };
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  const ledger = new RecentLedger(null);
  const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: ASSETS, docDir: DOCS, commands, browseAccess: null,
    mdns: () => null, urls: () => [], port: () => 0,
  });
  const at = new Date().toISOString();
  hub.publish(buildSnapshot({ generation: 'g', zones: ZONES, coreName: 'C', corePaired: true, coreSinceAt: at, revision: 1, at }, relay, ledger));
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch('http://127.0.0.1:' + String(port) + '/api/v1/control', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
  return { post, sent, port };
}

test('transport reaches Roon as a zone-level instruction', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'playpause', zone: 'zPlay' })).status, 200);
  assert.deepEqual(sent[0], { kind: 'control', a: 'zPlay', b: 'playpause' });
  assert.equal((await post({ action: 'next', zone: 'zPlay' })).status, 200);
  assert.equal(sent[1].b, 'next');
});

test("a control Roon says is not allowed is refused, not sent", async (t) => {
  const { post, sent } = await serve(t);
  // Roon reports next/previous unavailable on this zone; sending anyway would
  // fail silently somewhere the viewer cannot see.
  assert.equal((await post({ action: 'next', zone: 'zRadio' })).status, 409);
  assert.equal((await post({ action: 'previous', zone: 'zRadio' })).status, 409);
  assert.equal(sent.length, 0, 'nothing reached the Core');
});

test('volume acts on the OUTPUT, never the zone', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'volume', output: 'oStudy', steps: 1 })).status, 200);
  assert.deepEqual(sent[0], { kind: 'volume', a: 'oStudy', b: 1, c: false });

  // A zone id is not an output id, so it cannot be used to move a whole group.
  assert.equal((await post({ action: 'volume', output: 'zPlay', steps: 1 })).status, 404);
});

test('an output with no volume control says so rather than failing quietly', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'volume', output: 'oFixed', steps: 1 })).status, 409);
  assert.equal(sent.length, 0);
});

test('volume steps are bounded, so a stuck key cannot slam the room', async (t) => {
  const { post, sent } = await serve(t);
  await post({ action: 'volume', output: 'oStudy', steps: 999 });
  assert.equal(sent[0].b, 4, 'clamped up');
  await post({ action: 'volume', output: 'oStudy', steps: -999 });
  assert.equal(sent[1].b, -4, 'clamped down');
  assert.equal((await post({ action: 'volume', output: 'oStudy', steps: 0 })).status, 400);
});

test('a cross-origin page cannot control the music', async (t) => {
  const { post, sent } = await serve(t);
  const response = await post({ action: 'playpause', zone: 'zPlay' }, { origin: 'http://evil.example' });
  assert.equal(response.status, 403);
  assert.equal(sent.length, 0);
});

test('malformed and unknown requests are refused cleanly', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'explode', zone: 'zPlay' })).status, 400);
  assert.equal((await post({ action: 'playpause' })).status, 400);
  assert.equal((await post({ action: 'playpause', zone: 'nope' })).status, 404);
  assert.equal(sent.length, 0);
});

test('with no Core attached the route says so instead of pretending', async (t) => {
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  const server = createFlightDeckServer({
    hub, relay, ledger: new RecentLedger(null), assetDir: ASSETS, docDir: DOCS,
    commands: null, mdns: () => null, urls: () => [], port: () => 0,
  });
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  const response = await fetch('http://127.0.0.1:' + String(port) + '/api/v1/control', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'playpause', zone: 'z' }),
  });
  assert.equal(response.status, 503);
});

test('seek is refused where Roon says it is not allowed, and clamped to the track', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'seek', zone: 'zPlay', seconds: 90 })).status, 200);
  assert.deepEqual(sent[0], { kind: 'seek', a: 'zPlay', b: 90 });
  // zRadio reports is_seek_allowed false — a live stream cannot be scrubbed.
  assert.equal((await post({ action: 'seek', zone: 'zRadio', seconds: 10 })).status, 409);
  // past the end of a 200s track
  assert.equal((await post({ action: 'seek', zone: 'zPlay', seconds: 9999 })).status, 400);
  assert.equal((await post({ action: 'seek', zone: 'zPlay' })).status, 400);
  assert.equal(sent.length, 1, 'only the valid seek reached the Core');
});

test('an absolute volume is clamped to what the device accepts', async (t) => {
  const { post, sent } = await serve(t);
  await post({ action: 'volume', output: 'oStudy', value: 55 });
  assert.deepEqual(sent[0], { kind: 'setVolume', a: 'oStudy', b: 55 });
  // the output reports min 0 max 100
  await post({ action: 'volume', output: 'oStudy', value: 5000 });
  assert.equal(sent[1].b, 100, 'clamped to max');
  await post({ action: 'volume', output: 'oStudy', value: -40 });
  assert.equal(sent[2].b, 0, 'clamped to min');
});

/**
 * Shuffle reads the LIVE snapshot and sends the inverse. If it trusted what the
 * screen last drew, two displays — or one stale one — would fight over it, and
 * the mute button taught us that lesson already: it latched because its handler
 * captured the state at build time instead of reading it at press time.
 */
test('shuffle sends the inverse of what Roon currently reports', async (t) => {
  const { post, sent } = await serve(t);
  const response = await post({ action: 'shuffle', zone: 'zPlay' });
  assert.equal(response.status, 200);
  assert.deepEqual(sent.at(-1), { kind: 'settings', a: 'zPlay', b: { shuffle: false } });
});

/** Repeat asks the CORE to cycle, so off/all/one is Roon's order, not ours. */
test('repeat asks the core to cycle rather than naming a state', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'repeat', zone: 'zPlay' })).status, 200);
  assert.deepEqual(sent.at(-1), { kind: 'settings', a: 'zPlay', b: { loop: 'next' } });
});

test('a zone the Core reports no settings for refuses both', async (t) => {
  const { post, sent } = await serve(t);
  for (const action of ['shuffle', 'repeat']) {
    const response = await post({ action, zone: 'zRadio' });
    assert.equal(response.status, 409, action + ' on a zone with no settings');
  }
  assert.equal(sent.filter((s) => s.kind === 'settings').length, 0);
});

test('an unknown zone is refused before any command is sent', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'shuffle', zone: 'nope' })).status, 404);
  assert.equal(sent.length, 0);
});

/**
 * Roon partitions grouping by protocol — measured on a live Core, 08-26 — and
 * refuses across the partition silently. The rule is therefore enforced HERE and
 * not only drawn: a stale screen, or a request that never came from our page,
 * must not be able to ask for a group the viewer would see quietly fail.
 */
test('a group across Roon\u2019s protocol islands is refused, by name', async (t) => {
  const { post, sent } = await serve(t);
  const response = await post({ action: 'group', outputs: ['oStudy', 'oFixed'] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Garden Fixed cannot be grouped with Study/);
  assert.equal(sent.length, 0, 'nothing should reach the Core');
});

test('a group inside one island is sent in the order given', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group', outputs: ['oStudy', 'oPeer'] })).status, 200);
  // the HEAD leads: Roon preserves the first output's queue
  assert.deepEqual(sent.at(-1), { kind: 'group', a: 'oStudy+oPeer', b: null });
});

test('a group of one is not a group', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group', outputs: ['oStudy'] })).status, 400);
  assert.equal(sent.length, 0);
});

test('an unknown output never reaches the Core', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group', outputs: ['oStudy', 'ghost'] })).status, 404);
  assert.equal(sent.length, 0);
});

/** One call for the whole set: Roon tears a Squeezebox zone down on every ungroup. */
test('ungroup refuses a zone that is not a group, and sends one call when it is', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'ungroup', zone: 'zPlay' })).status, 409);
  assert.equal(sent.length, 0);
});

test('transfer refuses the room it is already in, and one with nothing playing', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'transfer', zone: 'zPlay', to: 'zPlay' })).status, 409);
  assert.equal((await post({ action: 'transfer', zone: 'zPeer', to: 'zPlay' })).status, 409);
  assert.equal(sent.length, 0);
  assert.equal((await post({ action: 'transfer', zone: 'zPlay', to: 'zPeer' })).status, 200);
  assert.deepEqual(sent.at(-1), { kind: 'transfer', a: 'zPlay', b: 'zPeer' });
});
