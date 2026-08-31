import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DisplayRegistry, IDLE_DELAY_MINUTES } from '../src/displays/registry.ts';

const AT = '2026-08-26T20:00:00.000Z';
const NOW = Date.parse(AT);

test('a screen is remembered by the id it made up, and its binding outlives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-displays-'));
  const first = new DisplayRegistry(dir);
  const introduced = first.see('d1', 'kitchen · presence', AT);
  assert.equal(introduced?.outputId, null, 'unbound to begin with');
  assert.equal(introduced?.idleDelayMinutes, 15, 'new displays get the safe default');
  assert.equal(first.bind('d1', 'oKitchen'), true);
  assert.equal(first.setIdleDelay('d1', 240), true);

  const second = new DisplayRegistry(dir);
  assert.equal(second.get('d1')?.outputId, 'oKitchen');
  assert.equal(second.get('d1')?.idleDelayMinutes, 240);
  // saying hello again must not clear what settings decided
  const returned = second.see('d1', 'kitchen · dial', AT);
  assert.equal(returned?.outputId, 'oKitchen');
  assert.equal(returned?.idleDelayMinutes, 240);
});

test('old and invalid display files migrate to the persisted fifteen-minute default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-display-migrate-'));
  const path = join(dir, 'displays.json');
  writeFileSync(path, JSON.stringify([
    { id: 'old', name: 'old screen', lastSeenAt: AT, outputId: null },
    { id: 'bad', name: 'bad screen', lastSeenAt: AT, outputId: null, idleDelayMinutes: 7 },
    { id: 'kept', name: 'kept screen', lastSeenAt: AT, outputId: null, idleDelayMinutes: 120 },
  ]));

  const store = new DisplayRegistry(dir);
  assert.equal(store.get('old')?.idleDelayMinutes, 15);
  assert.equal(store.get('bad')?.idleDelayMinutes, 15);
  assert.equal(store.get('kept')?.idleDelayMinutes, 120);

  const persisted = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
  assert.equal(persisted.find((record) => record.id === 'old')?.idleDelayMinutes, 15);
  assert.equal(persisted.find((record) => record.id === 'bad')?.idleDelayMinutes, 15);
});

test('only the declared idle delays are accepted, independently per display', () => {
  const store = new DisplayRegistry(null);
  store.see('d1', 'one', AT);
  store.see('d2', 'two', AT);

  for (const minutes of IDLE_DELAY_MINUTES) {
    assert.equal(store.setIdleDelay('d1', minutes), true);
    assert.equal(store.get('d1')?.idleDelayMinutes, minutes);
  }
  assert.equal(store.setIdleDelay('d1', 7), false);
  assert.equal(store.setIdleDelay('d1', -1), false);
  assert.equal(store.get('d1')?.idleDelayMinutes, 240, 'an invalid value cannot replace the last valid one');

  assert.equal(store.setIdleDelay('d2', 30), true);
  assert.equal(store.get('d1')?.idleDelayMinutes, 240);
  assert.equal(store.get('d2')?.idleDelayMinutes, 30);
  assert.equal(store.setIdleDelay('ghost', 15), false);
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
