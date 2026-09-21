import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { stripInert } from '../scripts/floor-lint.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const ASSETS = resolve(ROOT, 'assets');

// The screen check exists to answer on browsers that cannot run FlightDeck, so
// its main script must parse on the oldest of them.
test('the screen check script is written in pre-2015 JavaScript', () => {
  const code = stripInert(readFileSync(resolve(ASSETS, 'check.js'), 'utf8'));
  for (const [pattern, what] of [
    [/=>/, 'an arrow function'], [/\blet\s/, 'let'], [/\bconst\s/, 'const'], [/`/, 'a template string'],
    [/\bclass\s/, 'a class'], [/\.\.\./, 'spread'], [/\?\./, 'optional chaining'], [/\bimport\b|\bexport\b/, 'a module'],
  ] as const) {
    assert.doesNotMatch(code, pattern, 'check.js must not use ' + what);
  }
});

test('the screen check page answers without script, and its result reaches the server log', async (t) => {
  const lines: string[] = [];
  let port = 0;
  const server = createFlightDeckServer({
    hub: new EventHub(), relay: new ArtRelay({ artworkUrl: () => 'http://127.0.0.1:1/' }), ledger: new RecentLedger(null),
    assetDir: ASSETS, docDir: resolve(ROOT, 'docs'), commands: null, browseAccess: null,
    mdns: () => null, urls: () => [], port: () => port, log: (message: string) => { lines.push(message); },
  });
  port = await listenWithLadder(server, [0], () => {});
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + String(port);

  const page = await fetch(base + '/check');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="verdict" class="fail">This browser did not run the check/, 'the no-script answer is in the HTML');
  assert.match(html, /<script src="\/assets\/check-syntax\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/assets\/check-module\.js"><\/script>/);
  assert.match(html, /<script src="\/assets\/check\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/, 'no inline script: a CSP-1 browser would block it');
  for (const asset of ['check.js', 'check-syntax.js', 'check-module.js', 'check.css']) {
    const served = await fetch(base + '/assets/' + asset);
    await served.text();
    assert.equal(served.status, 200, asset);
  }

  const posted = await fetch(base + '/api/v1/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line: 'FDC1 PASS · Chrome 108 · Tizen 7.0\nforged: line', ua: 'Mozilla/5.0 (SMART-TV; Tizen 7.0)' }),
  });
  assert.equal(posted.status, 200);
  await posted.text();
  const logged = lines.find((line) => line.startsWith('screen check: '));
  assert.ok(logged !== undefined, 'the result is logged');
  assert.equal(logged, 'screen check: FDC1 PASS · Chrome 108 · Tizen 7.0 forged: line | Mozilla/5.0 (SMART-TV; Tizen 7.0)',
    'a newline cannot forge a second log line');

  const empty = await fetch(base + '/api/v1/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(empty.status, 400);
  await empty.text();
});
