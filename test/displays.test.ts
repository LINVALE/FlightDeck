import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DisplayRegistry } from '../src/displays/registry.ts';

const AT = '2026-08-26T20:00:00.000Z';
const NOW = Date.parse(AT);

test('a screen is remembered by the id it made up, and its binding outlives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-displays-'));
  const first = new DisplayRegistry(dir);
  assert.equal(first.see('d1', 'kitchen · presence', AT)?.outputId, null, 'unbound to begin with');
  assert.equal(first.bind('d1', 'oKitchen'), true);

  const second = new DisplayRegistry(dir);
  assert.equal(second.get('d1')?.outputId, 'oKitchen');
  // saying hello again must not clear what settings decided
  assert.equal(second.see('d1', 'kitchen · dial', AT)?.outputId, 'oKitchen');
});

test('binding an unknown screen is refused rather than inventing one', () => {
  const store = new DisplayRegistry(null);
  assert.equal(store.bind('ghost', 'oKitchen'), false);
  assert.equal(store.get('ghost'), null);
});

test('an empty name never overwrites the one on record', () => {
  const store = new DisplayRegistry(null);
  store.see('d1', 'the kitchen telly', AT);
  assert.equal(store.see('d1', '   ', AT)?.name, 'the kitchen telly');
});

test('a screen not seen for a fortnight drops off the list', () => {
  const store = new DisplayRegistry(null);
  store.see('recent', 'here', AT);
  store.see('gone', 'moved house', '2026-08-01T00:00:00.000Z');
  assert.deepEqual(store.active(NOW).map((d) => d.id), ['recent']);
});

test('an id that is absurd is refused, so a stray request cannot fill the registry', () => {
  const store = new DisplayRegistry(null);
  assert.equal(store.see('', 'x', AT), null);
  assert.equal(store.see('x'.repeat(200), 'x', AT), null);
});
