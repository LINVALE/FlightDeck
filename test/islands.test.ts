import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IslandRegistry } from '../src/labels/islands.ts';
import { collectIslands } from '../src/model/snapshot.ts';
import type { Zone } from '../src/model/types.ts';

const zone = (id: string, island: string, members: string[]): Zone => ({
  id, name: id, state: 'stopped', nowPlaying: null,
  outputs: [{ id: id + '-o', name: id, volume: null, groupableWith: members, island }],
  allowed: { play: false, pause: false, next: false, previous: false, seek: false },
  settings: null, lastPlayedAt: null, runStartedAt: null,
});

/**
 * ⚠️ THE ONE THAT MATTERS. The first version keyed a name on a hash of the
 * island's membership — and a device that goes to sleep leaves Roon's zone list,
 * so the membership changes, so the hash changes, so the name silently reverted
 * to "type 1" and the screen's remembered tab broke. On sixteen HEOS rooms that
 * is not an edge case.
 */
test('a name survives devices going to sleep and coming back', () => {
  const store = new IslandRegistry(null);
  const all = ['oA', 'oB', 'oC', 'oD'];
  const first = store.resolve(all);
  store.setLabel(first.id, 'Squeezebox');

  // one room asleep
  const fewer = store.resolve(['oA', 'oB', 'oC']);
  assert.equal(fewer.id, first.id, 'same island');
  assert.equal(fewer.label, 'Squeezebox');

  // most of the house asleep — a single output in common is still proof
  const barely = store.resolve(['oD']);
  assert.equal(barely.id, first.id);
  assert.equal(barely.label, 'Squeezebox');

  // and back, with a new device added while it was away
  const more = store.resolve([...all, 'oE']);
  assert.equal(more.id, first.id);
  assert.equal(more.label, 'Squeezebox');
});

test('islands that share no member are different islands', () => {
  const store = new IslandRegistry(null);
  const squeeze = store.resolve(['oA', 'oB']);
  const raat = store.resolve(['oX', 'oY']);
  assert.notEqual(squeeze.id, raat.id);
  store.setLabel(squeeze.id, 'Squeezebox');
  assert.equal(store.resolve(['oX', 'oY']).label, null, 'naming one must not name the other');
});

test('a name survives a restart, and an empty one clears it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-islands-'));
  const first = new IslandRegistry(dir);
  const island = first.resolve(['oA', 'oB', 'oC']);
  first.setLabel(island.id, 'Roon Ready');

  const second = new IslandRegistry(dir);          // a second process
  const seen = second.resolve(['oA', 'oB']);       // and one room asleep, for good measure
  assert.equal(seen.id, island.id);
  assert.equal(seen.label, 'Roon Ready');

  second.setLabel(island.id, '   ');
  assert.equal(new IslandRegistry(dir).resolve(['oA']).label, null);
});

test('a name is tidied and bounded', () => {
  const store = new IslandRegistry(null);
  const id = store.resolve(['oA', 'oB']).id;
  store.setLabel(id, '  Roon   Ready  ');
  assert.equal(store.label(id), 'Roon Ready', 'runs of whitespace collapse');
  store.setLabel(id, 'x'.repeat(80));
  assert.equal(store.label(id)?.length, 24, 'a label cannot be a paragraph');
  assert.equal(store.setLabel('nope', 'x'), false, 'an island that does not exist cannot be named');
});

/** Names written by the first format are claimed once, then gain real members. */
test('a name written by the old membership-hash format is carried over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-legacy-'));
  writeFileSync(join(dir, 'island-labels.json'), JSON.stringify({ eb3a8871: 'Squeezebox' }));
  const store = new IslandRegistry(dir);
  const seen = store.resolve(['oA', 'oB'], 'eb3a8871');
  assert.equal(seen.label, 'Squeezebox', 'the name is not lost by the upgrade');
  // and now it is held by membership, so the hash never matters again
  assert.equal(store.resolve(['oA'], 'a-different-hash').label, 'Squeezebox');
  assert.match(readFileSync(join(dir, 'island-labels.json'), 'utf8'), /"members"/);
});

test('islands come out largest first, carrying whatever names they have', () => {
  const one = ['a-o', 'b-o', 'c-o'];
  const two = ['d-o'];
  const zones = [
    zone('a', 'i1', one), zone('b', 'i1', one), zone('c', 'i1', one),
    zone('d', 'i2', two), zone('e', '', []),
  ];
  const store = new IslandRegistry(null);
  const resolve = (members: readonly string[], hash: string) => store.resolve(members, hash);
  const islands = collectIslands(zones, resolve);
  assert.equal(islands.length, 2);
  assert.equal(islands[0].count, 3);
  assert.equal(islands[1].count, 1);
  store.setLabel(islands[0].id, 'Squeezebox');
  assert.equal(collectIslands(zones, resolve)[0].label, 'Squeezebox');
});

test('an output that can group with nothing is in no island at all', () => {
  assert.deepEqual(collectIslands([zone('lonely', '', [])], (m, h) => ({ id: h, label: null })), []);
});
