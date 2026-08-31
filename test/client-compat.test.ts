import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const asset = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '..', 'assets', name), 'utf8');

test('every interactive client loads the Chromium 63 DOM compatibility rail', () => {
  for (const name of ['face.js', 'wall.js', 'phone.js']) {
    assert.match(asset(name), /^import ['"]\.\/compat\.js['"];\n/, name);
  }
  const compat = asset('compat.js');
  assert.match(compat, /Element\.prototype\.replaceChildren === undefined/);
  assert.match(compat, /while \(this\.firstChild !== null\) this\.removeChild\(this\.firstChild\)/);
});
