import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { normalizePuckPx } from '../src/http/pages.ts';

test('?px pins the glass only within the bounds a device could actually be', () => {
  assert.equal(normalizePuckPx('360'), 360);
  assert.equal(normalizePuckPx('240'), 240);
  // Rounded, not refused: a fractional CSS pixel is still an intent.
  assert.equal(normalizePuckPx('360.4'), 360);
  // Outside the range of any panel, and outright nonsense, fall back to sizing
  // off the short side rather than rendering a device nobody could hold.
  assert.equal(normalizePuckPx('4'), null);
  assert.equal(normalizePuckPx('99999'), null);
  assert.equal(normalizePuckPx('drop table'), null);
  assert.equal(normalizePuckPx(''), null);
  assert.equal(normalizePuckPx(null), null);
});

/**
 * ⚠️ THE REGRESSION THIS EXISTS FOR.
 *
 * `head()` used to pick the client script by sniffing the stylesheet href —
 * wall, else phone, else FACE. Any page whose name it did not know was served
 * face.js, so a fourth page would have rendered as a blank Face rather than as
 * an error: a fault invisible in the diff and explicable only from a screenshot.
 * Each page now NAMES its own client, and this holds every page to it.
 */
test('every page loads its own client, and the puck answers by name and by pixel', async (t) => {
  const server = createFlightDeckServer({
    hub: new EventHub(),
    relay: new ArtRelay({ artworkUrl: () => '' }),
    ledger: new RecentLedger(null),
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

  const body = async (path: string): Promise<string> => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    return await response.text();
  };

  for (const [path, script] of [['/', 'wall'], ['/phone', 'phone'], ['/now', 'face'], ['/puck', 'puck']]) {
    const html = await body(path);
    assert.ok(html.includes('src="/assets/' + script + '.js"'), path + ' must load ' + script + '.js');
  }

  // The three ways in, exactly as /phone offers them, plus the pinned glass.
  assert.ok((await body('/puck/')).includes('class="puck"'));
  assert.ok((await body('/puck/study')).includes('data-zone-slug="study"'));
  assert.ok((await body('/puck?px=360')).includes('data-px="360"'));
  // A refused pixel count leaves the client to size off the short side.
  assert.ok(!(await body('/puck?px=99999')).includes('data-px='));
});
