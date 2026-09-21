import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const asset = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '..', 'assets', name), 'utf8');

test('every interactive client loads the Chromium 63 DOM compatibility rail', () => {
  for (const name of ['face.js', 'wall.js', 'phone.js', 'puck.js']) {
    assert.match(asset(name), /^import ['"]\.\/compat\.js['"];\n/, name);
  }
  const compat = asset('compat.js');
  assert.match(compat, /Element\.prototype\.replaceChildren === undefined/);
  assert.match(compat, /while \(this\.firstChild !== null\) this\.removeChild\(this\.firstChild\)/);
});

// 2026-09-21, the first real Fire TV run: the TV app's WebView gave every page 960x540 (1080p at 2x),
// so The Deck showed half its cards and soft art. The app names the screen's real size in its user
// agent, and the rail widens the viewport to it before any page measures itself.
test('inside the FlightDeck TV app, pages lay out at the television\'s real resolution', () => {
  const compat = asset('compat.js');
  assert.match(compat, /\/FlightDeckTV\\\/\[\\d\.\]\+ \\\(\(\\d\+\)x\(\\d\+\)\\\)\//, 'reads FlightDeckTV/<version> (<width>x<height>)');
  assert.match(compat, /meta\[name="viewport"\]/);
  assert.match(compat, /setAttribute\('content', 'width=' \+ match\[1\]/);
  assert.match(asset('check.js'), /FlightDeckTV/, 'the screen check reports the size the pages really get');
});
