import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IslandLabels } from '../src/labels/islands.ts';
import { collectIslands } from '../src/model/snapshot.ts';
import type { Zone } from '../src/model/types.ts';

const zone = (id: string, island: string): Zone => ({
  id, name: id, state: 'stopped', nowPlaying: null,
  outputs: [{ id: id + '-o', name: id, volume: null, groupableWith: [], island }],
  allowed: { play: false, pause: false, next: false, previous: false, seek: false },
  settings: null, lastPlayedAt: null, runStartedAt: null,
});

test('a name survives a restart, and an empty one clears it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-islands-'));
  const first = new IslandLabels(dir);
  first.set('abc', 'Roon Ready');
  assert.equal(first.get('abc'), 'Roon Ready');

  // a second process reads what the first wrote — this is why it is on disk
  assert.equal(new IslandLabels(dir).get('abc'), 'Roon Ready');
  assert.match(readFileSync(join(dir, 'island-labels.json'), 'utf8'), /Roon Ready/);

  first.set('abc', '   ');
  assert.equal(first.get('abc'), null, 'blank clears it, which is how a screen undoes a rename');
  assert.equal(new IslandLabels(dir).get('abc'), null);
});

test('a name is tidied and bounded, and an island with no id is not nameable', () => {
  const store = new IslandLabels(null);            // no data dir: names live for this run
  store.set('a', '  Roon   Ready  ');
  assert.equal(store.get('a'), 'Roon Ready', 'runs of whitespace collapse');
  store.set('b', 'x'.repeat(80));
  assert.equal(store.get('b')?.length, 24, 'a label cannot be a paragraph');
  store.set('', 'nowhere');
  assert.equal(store.get(''), null);
});

/**
 * Roon says which outputs group together and never says what they ARE — no
 * protocol field, no MAC, and `source_controls` names the device ("Marantz LINK
 * 10n", "Study (RHEOS)") rather than the transport. So the label is carried, not
 * derived, and an island nobody has named yet reads as null rather than a guess.
 */
test('islands come out largest first, carrying whatever names they have', () => {
  const zones = [zone('a', 'i1'), zone('b', 'i1'), zone('c', 'i1'), zone('d', 'i2'), zone('e', '')];
  const islands = collectIslands(zones, { i1: 'Squeezebox' });
  assert.deepEqual(islands, [
    { id: 'i1', count: 3, label: 'Squeezebox' },
    { id: 'i2', count: 1, label: null },
  ]);
});

test('an output that can group with nothing is in no island at all', () => {
  assert.deepEqual(collectIslands([zone('lonely', '')], {}), []);
});
