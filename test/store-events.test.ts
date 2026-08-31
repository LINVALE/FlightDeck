import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The shipped browser module is intentionally plain ES2018 JavaScript.
import { createStore } from '../assets/store.js';

test('store distinguishes authoritative baselines from consecutive live updates', () => {
  const kinds: string[] = [];
  const store = createStore((_snapshot: unknown, kind: string) => { kinds.push(kind); });
  const base = { generation: 'g', revision: 1, zones: [] };
  store.accept(base, true);
  store.accept({ ...base, revision: 2 });
  store.acceptSeek({ generation: 'g', revision: 2, zones: [] });
  assert.deepEqual(kinds, ['snapshot', 'update', 'seek']);
});
