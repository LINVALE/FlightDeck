import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { BrowseGateway } from '../src/roon/browse.ts';

function turn(): Promise<void> { return new Promise((resolveTurn) => setImmediate(resolveTurn)); }

test('one Browse stack is serial within a screen and independent across screens', async () => {
  const pending: { key: string; done: (error: unknown, body: unknown) => void }[] = [];
  const service = {
    browse(options: unknown, done: (error: unknown, body: unknown) => void): void {
      pending.push({ key: String((options as { multi_session_key: string }).multi_session_key), done });
    },
  };
  const gateway = new BrowseGateway(() => service, 1000);
  const call = (sessionKey: string) => gateway.browse({ hierarchy: 'genres', sessionKey });

  const first = call('face-one');
  const behindIt = call('face-one');
  const otherScreen = call('face-two');
  await turn();
  assert.deepEqual(pending.map((entry) => entry.key), ['face-one', 'face-two'],
    'a second screen does not wait behind the first screen stack');

  pending[0].done(false, { action: 'list' });
  await turn();
  assert.deepEqual(pending.map((entry) => entry.key), ['face-one', 'face-two', 'face-one'],
    'calls within one screen remain ordered');
  pending[1].done(false, { action: 'list' });
  pending[2].done(false, { action: 'list' });
  await Promise.all([first, behindIt, otherScreen]);
  await turn();
  const chains = (gateway as unknown as { chains: Map<string, unknown> }).chains;
  assert.equal(chains.size, 0, 'finished screen identities are not retained forever');
});

test('the Face derives Browse identity per display instead of sharing a literal key', () => {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'face.js'), 'utf8');
  assert.doesNotMatch(source, /sessionKey:\s*['"]flightdeck-face['"]/);
  assert.ok((source.match(/sessionKey: browseSessionKey/g) ?? []).length >= 7);
});

test('Search forwards one bounded query on the requesting display stack', async () => {
  let received: Record<string, unknown> | null = null;
  const service = {
    browse(options: unknown, done: (error: unknown, body: unknown) => void): void {
      received = options as Record<string, unknown>;
      done(false, { action: 'list', list: { title: 'Search results', count: 0, level: 0 } });
    },
  };
  const gateway = new BrowseGateway(() => service, 1000);
  const input = 'm'.repeat(420);
  await gateway.browse({
    hierarchy: 'search',
    sessionKey: 'face-search',
    input,
    popAll: true,
  });
  assert.equal(received?.hierarchy, 'search');
  assert.equal(received?.multi_session_key, 'face-search');
  assert.equal(received?.pop_all, true);
  assert.equal(received?.input, input.slice(0, 400));
});
