import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const WALL = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'wall.js'), 'utf8');
const CSS = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'wall.css'), 'utf8');

test('Wall card header is one state-coloured strip containing room and last seen', () => {
  assert.match(WALL, /head\.appendChild\(zoneLine\); head\.appendChild\(stamp\)/);
  assert.match(WALL, /tile\.stamp\.textContent = stampFor\(zone, now\)/);
  assert.match(CSS, /--tile-frame: var\(--line\)/);
  assert.match(CSS, /border: 1px solid var\(--tile-frame\)/);
  assert.match(CSS, /\.tile-head[\s\S]{0,180}background: var\(--tile-frame\)/);
  assert.match(CSS, /\.tile-zone[\s\S]{0,180}background: transparent/);
  assert.match(CSS, /\.tile-stamp[\s\S]{0,180}color: inherit/);
});

test('Wall omits device-family choices with no active zone members', () => {
  assert.match(WALL, /var names = \(members\[islands\[j\]\.id\] \|\| \[\]\)[\s\S]{0,500}if \(names\.length === 0\) continue/);
  assert.match(WALL, /if \(!activePresent\)[\s\S]{0,180}activeIsland = ['"][\s\S]{0,180}localStorage\.removeItem\(['"]flightdeck\.island['"]\)/);
  assert.doesNotMatch(WALL, /zone\.state === ['"]playing['"][\s\S]{0,100}members\[key\]/,
    'stopped but awake rooms remain valid family members');
  assert.match(WALL, /if \(snapshot\.zones\.length === 0\)[\s\S]{0,360}drawTabs\(\[\], 0\)[\s\S]{0,180}groupBtn\.hidden = true/,
    'the final device disappearing also clears the old selector and group action');
});
