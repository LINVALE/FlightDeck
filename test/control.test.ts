import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { IslandRegistry } from '../src/labels/islands.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder, type Commands, type PullAccess } from '../src/http/server.ts';
import { PullError } from '../src/control/pull.ts';

const ASSETS = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets');
const DOCS = resolve(fileURLToPath(import.meta.url), '..', '..', 'docs');

/** Two zones: one that allows everything, one that allows nothing and has a fixed-volume output. */
const ZONES: unknown[] = [
  {
    zone_id: 'zPlay', display_name: 'Study', state: 'playing',
    outputs: [{ output_id: 'oStudy', display_name: 'Study', can_group_with_output_ids: ['oStudy', 'oPeer'], volume: { type: 'number', min: 0, max: 100, value: 40, step: 1, is_muted: false, soft_limit: 80, hard_limit_max: 90 } }],
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
    /**
     * A GROUP with two rooms at different levels AND different ranges — the
     * Marantz here reports 0-80 while everything else reports 0-100, which is
     * exactly why the group level is normalised before it is averaged.
     */
    zone_id: 'zGroup', display_name: 'Downstairs', state: 'playing',
    outputs: [
      { output_id: 'oLoud', display_name: 'Hall', can_group_with_output_ids: ['oLoud', 'oSoft'],
        volume: { type: 'number', min: 0, max: 100, value: 60, step: 1, is_muted: false } },
      { output_id: 'oSoft', display_name: 'Landing', can_group_with_output_ids: ['oLoud', 'oSoft'],
        volume: { type: 'number', min: 0, max: 80, value: 16, step: 1, is_muted: false } },
    ],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: true, is_previous_allowed: true, is_seek_allowed: true,
    now_playing: { seek_position: 5, length: 100, image_key: 'k3', three_line: { line1: 'T', line2: 'A', line3: 'B' } },
  },
  {
    // Peter 09-06: a room standing exactly at Roon's comfort level, alone on its island
    zone_id: 'zLimit', display_name: 'Porch', state: 'paused',
    outputs: [{ output_id: 'oLimit', display_name: 'Porch', can_group_with_output_ids: ['oLimit'],
      volume: { type: 'number', min: 0, max: 100, value: 80, step: 1, is_muted: false, soft_limit: 80, hard_limit_max: 90 } }],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: false, is_previous_allowed: false, is_seek_allowed: false,
    now_playing: { seek_position: 0, length: 100, image_key: 'k9', three_line: { line1: 'Q', line2: 'W', line3: 'E' } },
  },
  {
    // same island as Study, and silent: the room a group would be formed with
    zone_id: 'zPeer', display_name: 'Kitchen', state: 'stopped',
    outputs: [{ output_id: 'oPeer', display_name: 'Kitchen', can_group_with_output_ids: ['oStudy', 'oPeer'] }],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: false, is_previous_allowed: false, is_seek_allowed: false,
  },
];

interface Sent { kind: string; a: string; b: unknown; c?: unknown }

async function serve(
  t: { after: (fn: () => void) => void },
  zones: unknown[] = ZONES,
  pull: PullAccess | null = null,
) {
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
    wake: async (output) => { sent.push({ kind: 'wake', a: output, b: null }); },
  };
  // the real registry: identity by overlap is the point of it, and a fake that
  // just held a map would have passed while the real one lost every name
  const registry = new IslandRegistry(null);
  const named = (): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    const snapshot = hub.snapshot();
    for (const island of snapshot?.islands ?? []) out[island.id] = registry.label(island.id);
    return out;
  };
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  const ledger = new RecentLedger(null);
  const server = createFlightDeckServer({
    hub, relay, ledger, islands: registry, assetDir: ASSETS, docDir: DOCS, commands, pull, browseAccess: null,
    mdns: () => null, urls: () => [], port: () => 0,
  });
  const at = new Date().toISOString();
  hub.publish(buildSnapshot({ generation: 'g', zones, coreName: 'C', corePaired: true, coreSinceAt: at, revision: 1, at,
    resolveIsland: (members, hash) => registry.resolve(members, hash) }, relay, ledger));
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch('http://127.0.0.1:' + String(port) + '/api/v1/control', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
  return { post, sent, port, registry };
}

test('transport reaches Roon as a zone-level instruction', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'playpause', zone: 'zPlay' })).status, 200);
  assert.deepEqual(sent[0], { kind: 'control', a: 'zPlay', b: 'playpause' });
  assert.equal((await post({ action: 'next', zone: 'zPlay' })).status, 200);
  assert.equal(sent[1].b, 'next');
});

test('pull route forwards the exact browser fence and durable output to its sole owner', async (t) => {
  const seen: unknown[] = [];
  const pull: PullAccess = {
    pull: async (request) => {
      seen.push(request);
      return { generation: request.generation, revision: 3, destinationZoneId: 'zNew', playIssued: true };
    },
  };
  const { post, sent } = await serve(t, ZONES, pull);
  const response = await post({ action: 'pull', from: 'zPlay', output: 'oPeer', generation: 'g', revision: 1 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, generation: 'g', revision: 3, destinationZoneId: 'zNew', playIssued: true,
  });
  assert.deepEqual(seen, [{
    sourceZoneId: 'zPlay', destinationOutputId: 'oPeer', generation: 'g', revision: 1,
  }]);
  assert.equal(sent.length, 0, 'the route never assembles transfer or Play itself');
});

test('pull route requires its complete fence before invoking the coordinator', async (t) => {
  let calls = 0;
  const pull: PullAccess = {
    pull: async () => {
      calls += 1;
      return { generation: 'g', revision: 2, destinationZoneId: 'z', playIssued: false };
    },
  };
  const { post } = await serve(t, ZONES, pull);
  const incomplete = [
    { action: 'pull', output: 'oPeer', generation: 'g', revision: 1 },
    { action: 'pull', from: 'zPlay', generation: 'g', revision: 1 },
    { action: 'pull', from: 'zPlay', output: 'oPeer', revision: 1 },
    { action: 'pull', from: 'zPlay', output: 'oPeer', generation: 'g', revision: '1' },
  ];
  for (const body of incomplete) assert.equal((await post(body)).status, 400);
  assert.equal(calls, 0);
});

test('pull errors map stale, missing, unavailable, timeout and Core failures honestly', async (t) => {
  const specimens = [
    { code: 'stale-request', status: 409 },
    { code: 'source-not-found', status: 404 },
    { code: 'closed', status: 503 },
    { code: 'timeout', status: 504 },
    { code: 'transfer-failed', status: 502 },
  ] as const;
  for (const specimen of specimens) {
    await t.test(specimen.code, async (inner) => {
      const pull: PullAccess = {
        pull: async () => { throw new PullError(specimen.code, 'deliberate ' + specimen.code); },
      };
      const { post } = await serve(inner, ZONES, pull);
      const response = await post({
        action: 'pull', from: 'zPlay', output: 'oPeer', generation: 'g', revision: 1,
      });
      assert.equal(response.status, specimen.status);
      assert.deepEqual(await response.json(), {
        error: 'deliberate ' + specimen.code,
        code: specimen.code,
      });
    });
  }
});

test('pull says unavailable when no shared coordinator was installed', async (t) => {
  const { post, sent } = await serve(t);
  const response = await post({
    action: 'pull', from: 'zPlay', output: 'oPeer', generation: 'g', revision: 1,
  });
  assert.equal(response.status, 503);
  assert.equal(sent.length, 0);
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

test('mute requires an explicit boolean and sends exactly the requested output state', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'mute', output: 'oStudy' })).status, 400);
  assert.equal((await post({ action: 'mute', output: 'oStudy', muted: 'yes' })).status, 400);
  assert.equal(sent.length, 0, 'an ambiguous mute request must never become unmute');

  assert.equal((await post({ action: 'mute', output: 'oStudy', muted: true })).status, 200);
  assert.equal((await post({ action: 'mute', output: 'oStudy', muted: false })).status, 200);
  assert.deepEqual(sent, [
    { kind: 'mute', a: 'oStudy', b: true },
    { kind: 'mute', a: 'oStudy', b: false },
  ]);
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
  const terminal = await post({ action: 'seek', zone: 'zPlay', seconds: 200 });
  assert.equal(terminal.status, 200);
  assert.deepEqual(await terminal.json(), { ok: true, seconds: 199, adjusted: true });
  assert.deepEqual(sent[1], { kind: 'seek', a: 'zPlay', b: 199 },
    'the duration itself is a hand-off boundary, not a playable position');
  // zRadio reports is_seek_allowed false — a live stream cannot be scrubbed.
  assert.equal((await post({ action: 'seek', zone: 'zRadio', seconds: 10 })).status, 409);
  // past the end of a 200s track
  assert.equal((await post({ action: 'seek', zone: 'zPlay', seconds: 9999 })).status, 400);
  assert.equal((await post({ action: 'seek', zone: 'zPlay' })).status, 400);
  assert.equal(sent.length, 2, 'only the valid and safely adjusted seeks reached the Core');
});

test('an absolute volume is held to Roon\'s comfort level, passes it only with an override, and never passes safety', async (t) => {
  const { post, sent } = await serve(t);
  // oStudy: comfort 80, safety 90
  const fine = await post({ action: 'volume', output: 'oStudy', value: 55 });
  assert.equal(fine.status, 200);
  assert.deepEqual(sent[0], { kind: 'setVolume', a: 'oStudy', b: 55 });
  const held = await post({ action: 'volume', output: 'oStudy', value: 85 });
  assert.equal(sent[1].b, 80, 'held at comfort');
  assert.equal((await held.json() as { held: string }).held, 'comfort', 'and says so');
  const passed = await post({ action: 'volume', output: 'oStudy', value: 85, override: true });
  assert.equal(sent[2].b, 85, 'a double tap passes comfort');
  assert.equal((await passed.json() as { held: string }).held, 'none');
  const refused = await post({ action: 'volume', output: 'oStudy', value: 95, override: true });
  assert.equal(refused.status, 409, 'nothing passes safety');
  assert.equal((await refused.json() as { code: string }).code, 'safety');
  assert.equal(sent.length, 3, 'and nothing was sent for it');
  await post({ action: 'volume', output: 'oStudy', value: -40 });
  assert.equal(sent[3].b, 0, 'clamped to min');
});

test('steps are held the same way: room to comfort, more with an override, none past safety, down always free', async (t) => {
  const { post, sent } = await serve(t);
  // oLimit stands at 80 = its comfort level
  const atComfort = await post({ action: 'volume', output: 'oLimit', steps: 1 });
  assert.equal(atComfort.status, 200);
  assert.deepEqual(await atComfort.json(), { ok: true, steps: 0, held: 'comfort', comfort: 80, safety: 90 });
  assert.equal(sent.length, 0, 'a single press at comfort sends nothing');
  const above = await post({ action: 'volume', output: 'oLimit', steps: 4, override: true });
  assert.deepEqual(sent[0], { kind: 'volume', a: 'oLimit', b: 4, c: false }, 'a double press may take the room to safety (four steps of ten)');
  assert.equal((await above.json() as { held: string }).held, 'none');
  await post({ action: 'volume', output: 'oLimit', steps: -1 });
  assert.deepEqual(sent[1], { kind: 'volume', a: 'oLimit', b: -1, c: false }, 'down is free');
  // oStudy at 40 with comfort 80: four steps fit
  await post({ action: 'volume', output: 'oStudy', steps: 4 });
  assert.deepEqual(sent[2], { kind: 'volume', a: 'oStudy', b: 4, c: false });
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

/**
 * A grouped zone, for taking single rooms out. The leader is outputs[0] — the
 * zone whose queue the group plays — and it is PINNED: HEOS's line, because
 * `ungroup_outputs` tears a Squeezebox zone down on every call, so what removing
 * the leader leaves behind is not something Roon defines for us.
 */
const GROUPED: unknown[] = [
  ...ZONES,
  {
    zone_id: 'zTrio', display_name: 'Lounge + 2', state: 'playing',
    outputs: [
      { output_id: 'oLounge', display_name: 'Lounge', can_group_with_output_ids: ['oLounge', 'oHall', 'oDen'] },
      { output_id: 'oHall', display_name: 'Hall', can_group_with_output_ids: ['oLounge', 'oHall', 'oDen'] },
      { output_id: 'oDen', display_name: 'Den', can_group_with_output_ids: ['oLounge', 'oHall', 'oDen'] },
    ],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: true, is_previous_allowed: true, is_seek_allowed: true,
    now_playing: { seek_position: 5, length: 100, image_key: 'k3', three_line: { line1: 'Trio', line2: 'Band', line3: '' } },
  },
];

test('ungroup of a whole group sends every member in one call', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  assert.equal((await post({ action: 'ungroup', zone: 'zTrio' })).status, 200);
  assert.deepEqual(sent, [{ kind: 'ungroup', a: 'oLounge+oHall+oDen', b: null }]);
});

/**
 * Taking ONE room out sends exactly that room, in ONE call — never dissolve and
 * rebuild. Roon tears a Squeezebox grouped zone down on every ungroup_outputs,
 * and a rebuild stops the music in rooms that were not being changed.
 */
test('taking one member out sends only that member', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  assert.equal((await post({ action: 'ungroup', zone: 'zTrio', output: 'oDen' })).status, 200);
  assert.deepEqual(sent, [{ kind: 'ungroup', a: 'oDen', b: null }]);
});

test('the leader is pinned: removing it is refused, by name', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  const response = await post({ action: 'ungroup', zone: 'zTrio', output: 'oLounge' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Lounge leads this group/);
  assert.equal(sent.length, 0, 'nothing reached the Core');
});

test('a room that is not in the group cannot be taken out of it', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  assert.equal((await post({ action: 'ungroup', zone: 'zTrio', output: 'oStudy' })).status, 404);
  assert.equal(sent.length, 0);
});

/**
 * ⚖️ THE PLAYBACK GLITCH THIS EXISTS TO STOP (Peter, 08-28: "I think we are
 * repeating and it causes a playback glitch repeating the first second or so").
 *
 * `group_outputs` is not idempotent at the audio layer: handing Roon a
 * membership it already has still tears the zone down and rebuilds it, and every
 * room restarts the track. The same set is therefore not sent at all.
 */
test('a group that is already exactly this is not re-formed', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  const response = await post({ action: 'group', outputs: ['oLounge', 'oHall', 'oDen'] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).unchanged, true);
  assert.equal(sent.length, 0, 'nothing reached the Core');
});

/** Order is not decoration: Roon keeps the FIRST output's queue. */
test('the same rooms in a different order is a different group, and is sent', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  assert.equal((await post({ action: 'group', outputs: ['oHall', 'oLounge', 'oDen'] })).status, 200);
  assert.deepEqual(sent, [{ kind: 'group', a: 'oHall+oLounge+oDen', b: null }]);
});

/**
 * ⚖️ ONE GESTURE, ONE REGROUPING. Somebody adds two rooms and drops one before
 * they have finished deciding; that is ONE instruction, and it must reach Roon
 * as the smallest set of calls that gets to the membership they settled on.
 */
test('regroup drops and adds in one instruction: ungroup first, then the new group', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  assert.equal((await post({ action: 'regroup', zone: 'zTrio', outputs: ['oLounge', 'oHall'] })).status, 200);
  assert.deepEqual(sent, [{ kind: 'ungroup', a: 'oDen', b: null }, { kind: 'group', a: 'oLounge+oHall', b: null }]);
});

test('regroup can add a solo room while preserving the target as leader', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'regroup', zone: 'zPlay', outputs: ['oStudy', 'oPeer'] })).status, 200);
  assert.deepEqual(sent, [{ kind: 'group', a: 'oStudy+oPeer', b: null }]);
});

test('regroup to the membership it already has sends nothing at all', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  const response = await post({ action: 'regroup', zone: 'zTrio', outputs: ['oLounge', 'oHall', 'oDen'] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).unchanged, true);
  assert.equal(sent.length, 0);
});

/** Down to the lead alone is an ungroup, not a group of one. */
test('regroup to the lead alone takes everybody out and forms nothing', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  assert.equal((await post({ action: 'regroup', zone: 'zTrio', outputs: ['oLounge'] })).status, 200);
  assert.deepEqual(sent, [{ kind: 'ungroup', a: 'oHall+oDen', b: null }]);
});

test('regroup cannot drop the lead: it owns the queue', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  const response = await post({ action: 'regroup', zone: 'zTrio', outputs: ['oHall', 'oDen'] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Lounge leads this group/);
  assert.equal(sent.length, 0);
});

test('regroup refuses a room from another island, by name', async (t) => {
  const { post, sent } = await serve(t, GROUPED);
  const response = await post({ action: 'regroup', zone: 'zTrio', outputs: ['oLounge', 'oFixed'] });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /cannot be grouped with Lounge/);
  assert.equal(sent.length, 0);
});

test('transfer resolves a durable destination output and refuses unsafe moves', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'transfer', zone: 'zPlay', output: 'oStudy' })).status, 409);
  assert.equal((await post({ action: 'transfer', zone: 'zPeer', output: 'oStudy' })).status, 409);
  assert.equal((await post({ action: 'transfer', zone: 'zPlay', output: 'missing' })).status, 404);
  assert.equal(sent.length, 0);
  assert.equal((await post({ action: 'transfer', zone: 'zPlay', output: 'oPeer' })).status, 200);
  assert.deepEqual(sent.at(-1), { kind: 'transfer', a: 'zPlay', b: 'oPeer' });
});

test('a face left open across restart has its legacy transfer zone resolved once to an output', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'transfer', zone: 'zPlay', to: 'zPeer' })).status, 200);
  assert.deepEqual(sent, [{ kind: 'transfer', a: 'zPlay', b: 'oPeer' }]);
});

/**
 * Roon says which outputs group together and never says what they ARE — no
 * protocol field, no MAC, and `source_controls` names the device rather than the
 * transport. So the name is a person's, stored against the island's own identity
 * and republished, because every display in the house should call the same set of
 * rooms the same thing.
 */
test('an island can be named, and only one the Core actually reported', async (t) => {
  const { post, port, registry } = await serve(t);
  const snapshot = await (await fetch('http://127.0.0.1:' + String(port) + '/api/v1/snapshot')).json() as
    { islands: { id: string; count: number; label: string | null }[] };
  // Three islands: Study+Kitchen, the Downstairs pair, and Porch alone — an
  // island of one is still an island (Peter 09-06: "Study ROON should trigger
  // a new tab"). Garden names no peer at all and is in none.
  assert.equal(snapshot.islands.length, 3);
  assert.ok(snapshot.islands.some((i) => i.count === 1), 'the lone Roon Ready room has a family of its own');
  const island = snapshot.islands.find((i) => i.count === 2 && i.label === null) as { id: string; count: number; label: string | null };
  assert.ok(island, 'the Study/Kitchen island');
  assert.equal(island.count, 2);
  assert.equal(island.label, null, 'unnamed until somebody says');

  assert.equal((await post({ action: 'label-island', island: island.id, label: '  Roon   Ready ' })).status, 200);
  assert.equal(registry.label(island.id), 'Roon Ready', 'and tidied on the way in');

  const refused = await post({ action: 'label-island', island: 'nope', label: 'x' });
  assert.equal(refused.status, 404);
  assert.match(((await refused.json()) as { error: string }).error, /unknown island/);
  assert.equal((await post({ action: 'label-island', label: 'x' })).status, 400);
});

/**
 * ROON HAS NEVER HAD A GROUP VOLUME — per-endpoint sliders and relative nudges,
 * asked for since 2018. Sonos specifies the contract precisely, so it is adopted
 * verbatim: the group level is the AVERAGE of its members and moving it PRESERVES
 * the offsets between them. The quiet room must stay quieter.
 */
test('group volume moves every room and keeps them in proportion', async (t) => {
  const { post, sent } = await serve(t);
  // Hall is 60/100 = 0.60, Landing is 16/80 = 0.20 -> average 0.40, offsets +0.20 / -0.20
  assert.equal((await post({ action: 'group-volume', zone: 'zGroup', level: 0.5 })).status, 200);
  const moves = sent.filter((s) => s.kind === 'setVolume');
  assert.equal(moves.length, 2, 'every room with a volume moves');
  const by = Object.fromEntries(moves.map((m) => [m.a, m.b]));
  // +0.10 on each: Hall 0.70 of 100 = 70, Landing 0.30 of 80 = 24
  assert.equal(by.oLoud, 70);
  assert.equal(by.oSoft, 24);
  // and the gap between them is unchanged — compared to the gap they started
  // with, with a tolerance, because 0.7 - 0.3 is not 0.4 in binary floating point
  const before = (60 / 100) - (16 / 80);
  const after = (70 / 100) - (24 / 80);
  assert.ok(Math.abs(after - before) < 1e-9, 'the offset between the rooms survives the move');
});

/** At an end stop every member reaches the requested end, not merely the first. */
test('full group volume carries every room to its maximum', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group-volume', zone: 'zGroup', level: 1 })).status, 200);
  const by = Object.fromEntries(sent.filter((s) => s.kind === 'setVolume').map((m) => [m.a, m.b]));
  assert.equal(by.oLoud, 100);
  assert.equal(by.oSoft, 80, 'the quieter room continues after the louder room saturates');
});

test('zero group volume carries every room to its minimum', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group-volume', zone: 'zGroup', level: 0 })).status, 200);
  const by = Object.fromEntries(sent.filter((s) => s.kind === 'setVolume').map((m) => [m.a, m.b]));
  assert.equal(by.oSoft, 0);
  assert.equal(by.oLoud, 0, 'the louder room continues after the quieter room saturates');
});

function boundaryVolumeGroup(first: number, second: number): unknown[] {
  return [{
    zone_id: 'zBoundary', display_name: 'Boundary group', state: 'playing',
    outputs: [
      { output_id: 'oFirst', display_name: 'First', can_group_with_output_ids: ['oFirst', 'oSecond'],
        volume: { type: 'number', min: 0, max: 100, value: first, step: 1, is_muted: false } },
      { output_id: 'oSecond', display_name: 'Second', can_group_with_output_ids: ['oFirst', 'oSecond'],
        volume: { type: 'number', min: 0, max: 100, value: second, step: 1, is_muted: false } },
    ],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: false,
    is_previous_allowed: false, is_seek_allowed: false,
  }];
}

test('a room at zero does not prevent the remainder of its group being reduced', async (t) => {
  const { post, sent } = await serve(t, boundaryVolumeGroup(0, 60));
  assert.equal((await post({ action: 'group-volume', zone: 'zBoundary', level: 0.1 })).status, 200);
  const by = Object.fromEntries(sent.filter((s) => s.kind === 'setVolume').map((m) => [m.a, m.b]));
  assert.equal(by.oFirst, 0, 'the saturated room stays at its floor');
  assert.equal(by.oSecond, 20, 'the remaining room carries the requested average down to 10%');
});

test('a room at maximum does not prevent the remainder of its group being increased', async (t) => {
  const { post, sent } = await serve(t, boundaryVolumeGroup(100, 20));
  assert.equal((await post({ action: 'group-volume', zone: 'zBoundary', level: 0.9 })).status, 200);
  const by = Object.fromEntries(sent.filter((s) => s.kind === 'setVolume').map((m) => [m.a, m.b]));
  assert.equal(by.oFirst, 100, 'the saturated room stays at its ceiling');
  assert.equal(by.oSecond, 80, 'the remaining room carries the requested average up to 90%');
});

/** Fired together against one zone, volume sets race — the mutes proved it 08-28. */
test('the rooms are moved one at a time', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group-volume', zone: 'zGroup', level: 0.5 })).status, 200);
  const moves = sent.filter((s) => s.kind === 'setVolume');
  assert.equal(moves.length, 2);
  assert.deepEqual(moves.map((m) => m.a), ['oLoud', 'oSoft'], 'in the zone\u2019s own order');
});

test('group volume refuses a zone with nothing to move, and a level off the scale', async (t) => {
  const { post, sent } = await serve(t);
  assert.equal((await post({ action: 'group-volume', zone: 'zRadio', level: 0.5 })).status, 409);
  assert.equal((await post({ action: 'group-volume', zone: 'zGroup', level: 2 })).status, 400);
  assert.equal((await post({ action: 'group-volume', zone: 'nope', level: 0.5 })).status, 404);
  assert.equal(sent.length, 0);
});

const GROUP_MUTE_ZONES: unknown[] = [
  {
    zone_id: 'zMixedMute', display_name: 'Mixed mute group', state: 'playing',
    outputs: [
      { output_id: 'oNumber', display_name: 'Number',
        volume: { type: 'number', min: 0, max: 100, value: 35, step: 1, is_muted: false } },
      { output_id: 'oIncremental', display_name: 'Incremental',
        volume: { type: 'incremental', is_muted: true } },
      { output_id: 'oNoVolume', display_name: 'Fixed' },
    ],
    is_play_allowed: false, is_pause_allowed: true, is_next_allowed: false,
    is_previous_allowed: false, is_seek_allowed: false,
  },
  {
    zone_id: 'zAllMuted', display_name: 'Muted group', state: 'paused',
    outputs: [
      { output_id: 'oMutedOne', display_name: 'Muted one',
        volume: { type: 'number', min: 0, max: 100, value: 20, step: 1, is_muted: true } },
      { output_id: 'oMutedTwo', display_name: 'Muted two',
        volume: { type: 'incremental', is_muted: true } },
    ],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: false,
    is_previous_allowed: false, is_seek_allowed: false,
  },
  {
    zone_id: 'zNoMute', display_name: 'Fixed group', state: 'stopped',
    outputs: [
      { output_id: 'oFixedOne', display_name: 'Fixed one' },
      { output_id: 'oFixedTwo', display_name: 'Fixed two' },
    ],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: false,
    is_previous_allowed: false, is_seek_allowed: false,
  },
  {
    zone_id: 'zSoloMute', display_name: 'Solo', state: 'stopped',
    outputs: [{ output_id: 'oSolo', display_name: 'Solo',
      volume: { type: 'number', min: 0, max: 100, value: 35, step: 1, is_muted: false } }],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: false,
    is_previous_allowed: false, is_seek_allowed: false,
  },
];

test('group mute mutes every mutable member in zone order, including incremental outputs', async (t) => {
  const { post, sent } = await serve(t, GROUP_MUTE_ZONES);
  const response = await post({ action: 'group-mute', zone: 'zMixedMute' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).muted, true);
  assert.deepEqual(sent, [
    { kind: 'mute', a: 'oNumber', b: true },
    { kind: 'mute', a: 'oIncremental', b: true },
  ]);
});

test('group mute unmutes only when every mutable member is already muted', async (t) => {
  const { post, sent } = await serve(t, GROUP_MUTE_ZONES);
  const response = await post({ action: 'group-mute', zone: 'zAllMuted' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).muted, false);
  assert.deepEqual(sent, [
    { kind: 'mute', a: 'oMutedOne', b: false },
    { kind: 'mute', a: 'oMutedTwo', b: false },
  ]);
});

test('group mute validates its zone and refuses a zone with no mutable output', async (t) => {
  const { post, sent } = await serve(t, GROUP_MUTE_ZONES);
  assert.equal((await post({ action: 'group-mute' })).status, 400);
  assert.equal((await post({ action: 'group-mute', zone: 'missing' })).status, 404);
  assert.equal((await post({ action: 'group-mute', zone: 'zSoloMute' })).status, 409);
  assert.equal((await post({ action: 'group-mute', zone: 'zNoMute' })).status, 409);
  assert.equal(sent.length, 0);
});

/**
 * ⚖️ START ON PLAY, AS IN ROON (Peter, 09-03). A Marantz LINK 10n went to
 * standby at the top of a volume runaway and its zone answered Play with
 * nothing audible — seven presses in the log. Roon's own app sends the
 * convenience switch before Play on a zone whose device can sleep; here the
 * study's amp carries exactly that control, and the kitchen's speaker does not.
 */
test('Play wakes every output that can sleep, then plays — and only those', async (t) => {
  const zones: unknown[] = [{
    zone_id: 'zAmp', display_name: 'Study', state: 'paused',
    outputs: [
      { output_id: 'oAmp', display_name: 'Study', can_group_with_output_ids: ['oAmp', 'oShelf'],
        source_controls: [{ control_key: '1', display_name: 'Marantz LINK 10n', supports_standby: true, status: 'standby' }] },
      { output_id: 'oShelf', display_name: 'Kitchen', can_group_with_output_ids: ['oAmp', 'oShelf'] },
    ],
    is_play_allowed: true, is_pause_allowed: false, is_next_allowed: true, is_previous_allowed: true, is_seek_allowed: true,
    now_playing: { seek_position: 5, length: 100, image_key: 'k9', three_line: { line1: 'T', line2: 'A', line3: 'B' } },
  }];
  const { post, sent } = await serve(t, zones);
  for (const action of ['play', 'playpause']) {
    sent.length = 0;
    assert.equal((await post({ action, zone: 'zAmp' })).status, 200, action);
    assert.deepEqual(sent.map((s) => s.kind + ':' + s.a), ['wake:oAmp', 'control:zAmp'],
      action + ' wakes the amp that can sleep — not the kitchen — and only then plays');
    assert.equal(sent[1].b, action);
  }
  // Pause and next leave the power alone: a sleeping amp stays asleep.
  for (const action of ['pause', 'next']) {
    sent.length = 0;
    await post({ action, zone: 'zAmp' });
    assert.deepEqual(sent.map((s) => s.kind), ['control'], action);
  }
});
