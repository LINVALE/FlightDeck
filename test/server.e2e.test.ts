import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { ZONES } from './fixtures/zones.ts';

const ASSETS = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets');
const DOCS = resolve(fileURLToPath(import.meta.url), '..', '..', 'docs');

/** A stand-in Roon Core image endpoint, so the relay is exercised for real. */
async function fakeCore(): Promise<{ port: number; hits: string[]; close: () => void }> {
  const hits: string[] = [];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const server = createServer((request, response) => {
    hits.push(request.url ?? '');
    if ((request.url ?? '').includes('missing')) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.byteLength });
    response.end(png);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { port, hits, close: () => server.close() };
}

test('the whole spine serves a wall, a snapshot, a live stream and real artwork', async (t) => {
  const core = await fakeCore();
  t.after(() => core.close());

  const ledger = new RecentLedger(null);
  const hub = new EventHub();
  const relay = new ArtRelay({
    artworkUrl: (key, size) =>
      'http://127.0.0.1:' + String(core.port) + '/api/image/' + key + '?size=' + size,
  });

  let port = 0;
  const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null,
    mdns: () => null,
    urls: () => ['http://flightdeck.local:' + String(port) + '/', 'http://192.168.1.114:' + String(port) + '/'],
    port: () => port,
  });
  port = await listenWithLadder(server, [0], () => {});
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : port;
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + String(port);

  hub.publish(buildSnapshot(
    { generation: 'test', zones: ZONES, coreName: 'ROCK', corePaired: true, coreSinceAt: new Date().toISOString(), revision: 1, at: new Date().toISOString() },
    relay, ledger));

  // ---- an asset is NEVER stored: a refreshed screen can never run old code ----
  const asset = await fetch(base + '/assets/puck.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'no-store',
    'no-cache let a plain refresh serve module imports from memory cache (2026-09-03)');

  // ---- the Wall renders, and carries the name fallback a TV needs ----
  const wall = await fetch(base + '/');
  assert.equal(wall.status, 200);
  const wallHtml = await wall.text();
  assert.match(wallHtml, /FLIGHT<span>DECK<\/span>/);
  // ONE address, and the NUMERIC one: `.local` does not resolve on Fire OS, Echo
  // Show or Android <= 11, so the address a TV shows has to be typeable there.
  assert.match(wallHtml, /192\.168\.1\.114/, 'the IP URL must be printed for TVs that cannot resolve .local');
  assert.equal((wallHtml.match(/class="url/g) ?? []).length, 1, 'one address, not three');
  assert.match(wallHtml, new RegExp('Room display: <code>http://192\\.168\\.1\\.114:' + String(port) + '/name</code>'),
    'the footer explains a direct room address');
  assert.doesNotMatch(wallHtml, /\/now|Now Playing:/, 'the auto-follow address is no longer advertised');
  // The QR was never once scanned successfully, so it does not take a corner of
  // the wall. qrSvg itself stays, for a click-to-show once a phone has read one.
  assert.doesNotMatch(wallHtml, /aria-label="QR code"/, 'no QR on the wall');
  assert.match(wall.headers.get('content-security-policy') ?? '', /default-src 'none'/);

  // ---- the snapshot is the wire contract, with no Roon shape leaking ----
  const snapshot = await (await fetch(base + '/api/v1/snapshot')).json() as Record<string, any>;
  assert.equal(snapshot.zones.length, 4);
  // Recency ordering: Study and Garden are both playing, so both rank as "now"
  // and the tie breaks on name. On a cold boot the ledger has no history yet, so
  // a paused zone is indistinguishable from one that never played — the ledger
  // accrues that distinction as the house is used.
  assert.deepEqual(snapshot.zones.map((zone: any) => zone.name), ['Garden', 'Study', 'Kitchen', 'Terrace']);
  const study = snapshot.zones.find((zone: any) => zone.name === 'Study');
  assert.equal(study.state, 'playing');
  assert.ok(!JSON.stringify(snapshot).includes('zone_id'), 'Roon field names must not reach the browser');
  assert.ok(!JSON.stringify(snapshot).includes('artist_image_keys'));
  assert.match(study.nowPlaying.artistArt.path, /^\/api\/v1\/art\//);

  // ---- artwork resolves through the opaque token, and the Core URL never leaks ----
  const artPath = study.nowPlaying.art.path as string;
  const art = await fetch(base + artPath);
  assert.equal(art.status, 200);
  assert.equal(art.headers.get('content-type'), 'image/png');
  assert.ok(core.hits.some((hit) => hit.includes('1777dafbf8282dfacc794fff03d05a36')));
  assert.ok(core.hits.some((hit) => hit.includes('size=cover')), 'the cover uses the cover size class');

  // The artist backdrop is a SEPARATE opaque token on the same relay, and it is
  // requested at the small `bg` size: Roon's artist images are 1024x448 banners
  // and the backdrop is blurred, so asking for more only makes the Core upscale.
  const artistPath = study.nowPlaying.artistArt.path as string;
  assert.notEqual(artistPath, artPath, 'the artist backdrop must not share the cover token');
  const artist = await fetch(base + artistPath);
  assert.equal(artist.status, 200);
  assert.ok(core.hits.some((hit) => hit.includes('size=bg')), 'the artist backdrop uses the bg size class');
  assert.ok(core.hits.some((hit) => hit.includes('43f123b4d4ad8f5d62794f8f68b847c1')));
  // Second fetch is served from the relay cache, not the Core.
  const hitsBefore = core.hits.length;
  await fetch(base + artPath);
  assert.equal(core.hits.length, hitsBefore, 'a cached image must not re-hit the Core');

  // ---- a bad token is a plain 404, never a crash ----
  assert.equal((await fetch(base + '/api/v1/art/' + 'z'.repeat(20))).status, 404);

  // ---- health reports what the installer needs ----
  const health = await (await fetch(base + '/api/v1/health')).json() as Record<string, any>;
  assert.equal(health.ok, true);
  assert.equal(health.revision, 1);
  assert.ok(Array.isArray(health.urls) && health.urls.length >= 2);

  // ---- the live stream delivers a snapshot then an update ----
  const controller = new AbortController();
  const stream = await fetch(base + '/api/v1/events', { signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = async (until: RegExp, budgetMs = 3000): Promise<string> => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (until.test(buffer)) return buffer;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ value?: Uint8Array }>((done) => setTimeout(() => done({}), 250)),
      ]);
      if (chunk.value !== undefined) buffer += decoder.decode(chunk.value, { stream: true });
    }
    throw new Error('timed out waiting for ' + String(until) + ' — got: ' + buffer.slice(0, 400));
  };
  await pump(/event: snapshot/);
  assert.match(buffer, /id: 1/);

  const moved = JSON.parse(JSON.stringify(ZONES)) as Record<string, any>[];
  moved[1].state = 'playing';
  hub.publish(buildSnapshot(
    { generation: 'test', zones: moved, coreName: 'ROCK', corePaired: true, coreSinceAt: new Date().toISOString(), revision: 2, at: new Date().toISOString() },
    relay, ledger));
  await pump(/event: update/);
  assert.match(buffer, /id: 2/);

  // ---- a seek frame arrives without an id, so the client revision is untouched ----
  hub.publishSeek({ revision: 2, at: new Date().toISOString(), zones: [{ id: '1601abc', positionSec: 777 }] });
  await pump(/event: seek/);
  const seekFrame = buffer.slice(buffer.lastIndexOf('event: seek'));
  assert.ok(!/\nid: /.test(seekFrame), 'seek must not carry an id');
  assert.match(seekFrame, /"positionSec":777/);

  controller.abort();
});

test('a face page pins its zone and honours an explicit ?face=', async (t) => {
  const ledger = new RecentLedger(null);
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  let port = 0;
  const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => ['http://flightdeck.local/'], port: () => port,
  });
  port = await listenWithLadder(server, [0], () => {});
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : port;
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + String(port);
  hub.publish(buildSnapshot(
    { generation: 'face-route', zones: ZONES, coreName: 'ROCK', corePaired: true,
      coreSinceAt: new Date().toISOString(), revision: 1, at: new Date().toISOString() },
    relay, ledger));

  const page = await (await fetch(base + '/face/1601abc?face=classic')).text();
  assert.match(page, /data-zone="1601abc"/);
  assert.match(page, /data-face-param="classic"/);

  const durable = await (await fetch(base + '/face/1701a')).text();
  assert.match(durable, /data-zone="1601abc"/);
  assert.match(durable, /data-output="1701a"/,
    'a Wall link binds the physical room rather than its disposable zone');

  for (const path of ['/study', '/Study/', '/study?face=dial&follow=1']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    const room = await response.text();
    assert.match(room, /data-zone="1601abc"/);
    assert.match(room, /data-output="1701a"/);
    assert.match(room, /data-zone-slug="study"/);
    assert.match(room, /data-follow="0"/, 'a room bookmark does not follow unrelated players');
    if (path.includes('face=dial')) assert.match(room, /data-face-param="wheel"/, 'a room link with ?face=dial opens Wheel');
  }
  const member = await (await fetch(base + '/kitchen')).text();
  assert.match(member, /data-output="1701b"/);
  assert.match(member, /data-zone="1601abc"/, 'a room in a playing group resolves through its output name');
  assert.equal((await fetch(base + '/not-a-room')).status, 404);
  assert.equal((await fetch(base + '/favicon.ico')).status, 404);
  const guide = await fetch(base + '/guide');
  assert.equal(guide.status, 200, 'built-in pages retain precedence over short room names');
  assert.doesNotMatch(await guide.text(), /data-zone=/);

  // Every tournament face is built now, so each is honoured...
  for (const face of ['presence', 'classic', 'wheel', 'libretto', 'canvas']) {
    const page = await (await fetch(base + '/face/1601abc?face=' + face)).text();
    assert.match(page, new RegExp('data-face-param="' + face + '"'), face + ' must be selectable');
  }
  // Dial was renamed Wheel (2026-09-21): an old bookmark opens the same face.
  const oldDial = await (await fetch(base + '/face/1601abc?face=dial')).text();
  assert.match(oldDial, /data-face-param="wheel"/, 'a ?face=dial bookmark still opens Wheel');
  // ...but a name with no layout behind it is still refused, rather than becoming
  // a control that changes an attribute and nothing else.
  const unknownFace = await (await fetch(base + '/face/1601abc?face=hologram')).text();
  assert.ok(!unknownFace.includes('data-face-param'), 'an unknown face is not honoured');

  // An unknown face falls back to the screen's own memory rather than erroring.
  const unknown = await (await fetch(base + '/face/1601abc?face=nonsense')).text();
  assert.ok(!unknown.includes('data-face-param'));

  // A zone id is sanitised into the attribute, never injected.
  const nasty = await (await fetch(base + '/face/' + encodeURIComponent('a"><script>x</script>'))).text();
  assert.ok(!nasty.includes('<script>x</script>'));
});

test('legacy auto-follow bookmarks work, and short room bookmarks can open before the first snapshot', async (t) => {
  const server = createFlightDeckServer({
    hub: new EventHub(), relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null), assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => ['http://flightdeck.local/'], port: () => 0,
  });
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + String(port);

  for (const path of ['/now', '/face', '/face/']) {
    const page = await (await fetch(base + path)).text();
    assert.match(page, /data-follow="1"/, path + ' must turn following on');
    assert.match(page, /data-zone=""/, path + ' must pin no zone');
  }
  // An explicit ?follow=0 on a named zone still pins it.
  const pinned = await (await fetch(base + '/face/abc?follow=0')).text();
  assert.match(pinned, /data-follow="0"/);
  assert.match(pinned, /data-zone="abc"/);
  const starting = await (await fetch(base + '/study')).text();
  assert.match(starting, /data-zone-slug="study"/);
  assert.match(starting, /data-follow="0"/);
});

test('the port ladder falls back, and says something useful when it cannot', async (t) => {
  const blocker = createFlightDeckServer({
    hub: new EventHub(), relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null), assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => [], port: () => 0,
  });
  await listenWithLadder(blocker, [0], () => {});
  const blocked = blocker.address();
  const taken = typeof blocked === 'object' && blocked !== null ? blocked.port : 0;
  t.after(() => blocker.close());

  // Falls THROUGH a taken port to a free one.
  const lines: string[] = [];
  const second = createFlightDeckServer({
    hub: new EventHub(), relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null), assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => [], port: () => 0,
  });
  const bound = await listenWithLadder(second, [taken, 0], (line) => lines.push(line));
  t.after(() => second.close());
  assert.notEqual(bound, taken);
  assert.ok(lines.some((line) => line.includes('trying the next')));

  // With no fallback left it must not claim to be trying one.
  const doomed = createFlightDeckServer({
    hub: new EventHub(), relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null), assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => [], port: () => 0,
  });
  const last: string[] = [];
  await assert.rejects(() => listenWithLadder(doomed, [taken], (line) => last.push(line)));
  assert.ok(!last.some((line) => line.includes('trying the next')), 'must not promise a fallback it does not have');
  assert.ok(last.some((line) => line.includes('already in use')));
  assert.ok(last.some((line) => line.includes('FLIGHTDECK_PORT')), 'must say how to fix it');
});

test('assets are served, and a path traversal is refused', async (t) => {
  const server = createFlightDeckServer({
    hub: new EventHub(), relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null), assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => [], port: () => 0,
  });
  const port = await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const real = typeof address === 'object' && address !== null ? address.port : port;
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + String(real);

  const js = await fetch(base + '/assets/store.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /javascript/);

  assert.equal((await fetch(base + '/assets/../package.json')).status, 404);
  assert.equal((await fetch(base + '/assets/nope.js')).status, 404);
});

test('a display survives a server restart without being reloaded', async () => {
  const { createStore } = await import('./support/store-harness.ts');
  const store = createStore();

  // A long-running display, holding a high revision from the process that has
  // been up all evening.
  store.accept({ generation: 'genA', revision: 700, generatedAt: 'x', core: { state: 'paired', name: 'C', sinceAt: 'x' }, zones: [] }, true);
  assert.equal(store.snapshot().revision, 700);

  // FlightDeck restarts. Its revision counter begins again near zero.
  const afterRestart = { generation: 'genB', revision: 3, generatedAt: 'y', core: { state: 'paired', name: 'C', sinceAt: 'y' }, zones: [] };

  // Before the fix this frame was silently discarded and the display froze
  // forever. A changed generation must be trusted.
  store.accept(afterRestart, false);
  assert.equal(store.snapshot().revision, 3, 'a new process must be believed, however low its revision');
  assert.equal(store.snapshot().generation, 'genB');

  // Within one generation the monotonic guard still holds: a late frame from a
  // dying socket must not undo a fresher one.
  store.accept({ ...afterRestart, revision: 9 }, false);
  store.accept({ ...afterRestart, revision: 5 }, false);
  assert.equal(store.snapshot().revision, 9, 'stale frames within a generation are still refused');

  // And a seek frame from the previous process must not be applied.
  store.acceptSeek({ generation: 'genA', revision: 9, at: new Date().toISOString(), zones: [{ id: 'z', positionSec: 5 }] });
  assert.equal(store.positionFor('z'), null, 'a seek from a dead generation is ignored');
});


test('/phone is the remote: a third page with the same organs', async (t) => {
  const ledger = new RecentLedger(null);
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  let port = 0;
  const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: ASSETS, docDir: DOCS, commands: null, browseAccess: null, mdns: () => null,
    urls: () => ['http://flightdeck.local/'], port: () => port,
  });
  port = await listenWithLadder(server, [0], () => {});
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : port;
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + String(port);

  hub.publish(buildSnapshot(
    { generation: 'test', zones: ZONES, coreName: 'ROCK', corePaired: true, coreSinceAt: new Date().toISOString(), revision: 1, at: new Date().toISOString() },
    relay, ledger));

  // The bare address is the PHONE WALL (Peter 09-06): the house in one column.
  const bare = await fetch(base + '/phone');
  assert.equal(bare.status, 200);
  const bareHtml = await bare.text();
  assert.match(bare.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(bareHtml, /class="pwall" id="pwall"/);
  assert.match(bareHtml, /\/assets\/phone-wall\.css/);
  assert.match(bareHtml, /\/assets\/phone-wall\.js/, 'the phone wall must load its own script');
  assert.doesNotMatch(bareHtml, /data-zone=/, 'the wall pins no room');
  // A room's address below it is the remote, as before.
  const remote = await (await fetch(base + '/phone/1601abc')).text();
  assert.match(remote, /\/assets\/phone\.js/, 'the remote page must load the phone script, not the face');

  // A NAME resolves to a zone, exactly as /face/ does — typeable, bookmarkable.
  const named = await (await fetch(base + '/phone/study')).text();
  assert.match(named, /data-zone="1601abc"/);
  assert.match(named, /data-zone-slug="study"/);

  // A hostile token is sanitised into the attributes, never injected.
  const nasty = await (await fetch(base + '/phone/' + encodeURIComponent('a"><script>x</script>'))).text();
  assert.ok(!nasty.includes('<script>x</script>'));
});
