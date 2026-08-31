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

test('a grouped Wall 2 card replaces Group with a bottom-left Ungroup action', () => {
  const buildStart = WALL.indexOf('function buildTile(zone)');
  const buildEnd = WALL.indexOf('function beginGroupFrom(', buildStart);
  const build = WALL.slice(buildStart, buildEnd);
  assert.match(build, /post\(\{ action: ['"]ungroup['"], zone: zoneId \}\)/,
    'the existing whole-zone Ungroup contract is used directly');
  assert.match(build, /left\.appendChild\(groupB\);\s*left\.appendChild\(ungroupB\);\s*left\.appendChild\(sendB\)/,
    'Ungroup occupies the first bottom-left action slot');
  assert.match(WALL, /var grouped = zone\.outputs\.length > 1;\s*tile\.groupB\.hidden = grouped;\s*tile\.ungroupB\.hidden = !grouped/,
    'only a real multi-output zone offers Ungroup');
  assert.match(CSS, /\.tile-actions \.ta\[hidden\] \{ display: none; \}/);
  assert.match(build, /ungroupB\.appendChild\(glyph\(['"]ungroup['"]\)\)/);
  assert.doesNotMatch(build, /ungroupB\.appendChild\(el\(/,
    'Ungroup remains the same compact glyph button as Group and Send');
  assert.match(CSS, /\.tt-glyph, \.ta \.tt-glyph \{ width: \.8vw; height: \.8vw; \}/,
    'transport and card-action glyphs share the same legible base size');
});

test('Wall 2 preserves a topology successor by stable leader output', () => {
  assert.match(WALL, /joinedPreviousZones\(zones, previousOutputOwners\)/);
  assert.match(WALL, /if \(resort && !joined\) return zones/,
    'ordinary starts and stops still take the server recency order');
  assert.match(WALL, /return inheritWallOrder\(zones, order, orderSlots\)/,
    'a group transition uses visual slot inheritance instead of new-zone recency');
  assert.match(WALL, /previousOutputOwners = wallOutputOwners\(inTab\)/,
    'the comparison is fenced to the immediately preceding family view');
});

test('Wall 2 owns the conditional top-centre Pause All action', () => {
  assert.match(WALL, /var pauseAllBtn = el\(['"]span['"], ['"]wall-pause-all['"], ['"]pause all['"]\)/);
  assert.match(WALL, /pauseAllBtn\.hidden = playing === 0/);
  const pauseStart = WALL.indexOf('function pauseAllOnWall()');
  const pauseEnd = WALL.indexOf('\ntap(pauseAllBtn', pauseStart);
  const pause = WALL.slice(pauseStart, pauseEnd);
  assert.match(pause, /snapshot\.zones\[i\]\.state === ['"]playing['"]/);
  assert.match(pause, /post\(\{ action: ['"]pause['"], zone: snapshot\.zones\[i\]\.id \}\)/);
  assert.doesNotMatch(pause, /playpause|loading/,
    'a global press cannot accidentally start a room or pause a non-playing transition');
  assert.match(pause, /Promise\.all\(requests\)/);
  assert.match(CSS, /\.wall-pause-all \{[\s\S]{0,100}left: 50%/);
  assert.match(CSS, /\.wall-pause-all \{[\s\S]{0,180}translateX\(-50%\)/);
  assert.match(CSS, /\.wall-pause-all\[hidden\] \{ display: none; \}/);
});

test('Wall 2 spends card slack on larger, easier control targets', () => {
  assert.match(CSS, /\.tile-actions \{ margin-top: \.65vh; padding-top: \.45vh; \}/,
    'the action row follows the volume rail instead of being pushed to the card floor');
  assert.doesNotMatch(CSS, /\.tile-actions \{ margin-top: auto; \}/);
  assert.match(CSS, /\.tt, \.ta \{ width: 1\.75vw; height: 1\.75vw; \}/);
  assert.match(CSS, /\.tt\.play \{ width: 2\.05vw; height: 2\.05vw; \}/);
  assert.match(CSS, /\.tile-rule\.vol \{[\s\S]{0,80}height: 1\.6vh/,
    'volume receives a forgiving hit rail while retaining a thin visual line');
});
