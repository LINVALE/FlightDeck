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

/**
 * Roon's one markup: streaming results carry its link form in titles and
 * subtitles — `[[673402|Dua Lipa]]` (measured 2026-09-05 on a TIDAL album) —
 * and a screen must read the name alone.
 */
test('Roon link markup [[id|name]] is read as the name in titles, subtitles and the level', async () => {
  const service = {
    browse(_options: unknown, done: (error: unknown, body: unknown) => void): void {
      done(false, { action: 'list', list: { title: 'Radical Optimism (Extended Versions)', subtitle: '[[673402|Dua Lipa]]', count: 1, level: 2 } });
    },
    load(_options: unknown, done: (error: unknown, body: unknown) => void): void {
      done(false, { offset: 0, items: [{ title: '1. End Of An Era', subtitle: '[[1|Danny L Harle]], [[673402|Dua Lipa]]', item_key: 'k1', hint: 'action_list' }],
        list: { title: 'Radical Optimism (Extended Versions)', subtitle: '[[673402|Dua Lipa]]', count: 1, level: 2 } });
    },
  };
  const gateway = new BrowseGateway(() => service, 1000);
  const head = await gateway.browse({ hierarchy: 'search', sessionKey: 'face-markup' });
  assert.equal(head.list?.subtitle, 'Dua Lipa');
  const page = await gateway.load({ hierarchy: 'search', sessionKey: 'face-markup', count: 10, offset: 0 });
  assert.equal(page.items?.[0]?.subtitle, 'Danny L Harle, Dua Lipa');
  assert.equal(page.items?.[0]?.title, '1. End Of An Era');
});
