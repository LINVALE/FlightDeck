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
  assert.match(CSS, /--tile-head: rgba\(35,39,46,\.42\)/);
  assert.match(CSS, /\.tile-head[\s\S]{0,180}background: var\(--tile-head\)/);
  assert.match(CSS, /\.tile\.is-live[\s\S]{0,120}--tile-head: rgba\(111,191,143,\.42\)/,
    'live state lightly tints the header while the frame retains the solid state colour');
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
  assert.match(build, /left\.appendChild\(groupB\);\s*left\.appendChild\(ungroupB\);\s*left\.appendChild\(sendB\);\s*left\.appendChild\(pullB\)/,
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
  assert.match(WALL, /var pauseAllBtn = el\(['"]span['"], ['"]wall-act wall-pause-all['"]\)/);
  assert.match(WALL, /pauseAllBtn\.appendChild\(glyph\(['"]pause['"]\)\)/);
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

test('top-row commands share one restrained geometry and type treatment', () => {
  assert.match(WALL, /groupBtn\.appendChild\(glyph\(['"]group['"]\)\)/);
  assert.match(WALL, /groupBtn\.appendChild\(el\(['"]span['"], ['"]wall-act-label['"], ['"]group rooms['"]\)\)/);
  assert.match(WALL, /pauseAllBtn\.appendChild\(el\(['"]span['"], ['"]wall-act-label['"], ['"]pause all['"]\)\)/);
  assert.match(CSS, /\.wall-act \{[\s\S]{0,520}width: 10\.5vw; height: 2\.65vw/,
    'Pause All and Group Rooms inherit the exact same box');
  assert.match(CSS, /\.wall-act \{[\s\S]{0,900}font-size: \.94vw; font-weight: 500; letter-spacing: \.14em/,
    'neither command receives a louder typographic voice');
  assert.match(CSS, /box-shadow: inset 0 1px 0 rgba\(255,255,255,\.06\), 0 \.35vw 1vw rgba\(0,0,0,\.38\)/,
    'the shared surface uses a quiet inset edge and restrained depth');
  assert.doesNotMatch(CSS, /\.wall-pause-all \{[^}]*font-size/,
    'Pause All cannot silently override the common type treatment');
});

test('Wall omits the healthy paired plumbing state but keeps an outage visible', () => {
  assert.match(WALL,
    /coreEl\.textContent = core\.state === ['"]paired['"] \? ['"]['"] : ['"]Roon is away — showing the last known state['"]/);
  assert.match(WALL, /coreEl\.className = ['"]wall-core['"] \+ \(core\.state === ['"]paired['"] \? ['"]['"] : ['"] away['"]\)/);
});

test('Wall 2 spends card slack on larger, easier control targets', () => {
  assert.match(CSS, /\.tile-actions \{ margin-top: 1\.2vh; padding-top: \.65vh; \}/,
    'the action row follows the volume rail instead of being pushed to the card floor');
  assert.doesNotMatch(CSS, /\.tile-actions \{ margin-top: auto; \}/);
  assert.match(CSS, /\.tile-bar-line \{ margin-top: 1\.25vh; \}/);
  assert.match(CSS, /\.tile-bar-line \+ \.tile-bar-line \{ margin-top: 1\.15vh; \}/,
    'progress, volume, and actions use the card height instead of crowding one another');
  assert.match(CSS, /\.tt, \.ta \{ width: 1\.75vw; height: 1\.75vw; \}/);
  assert.match(CSS, /\.tt\.play \{ width: 2\.05vw; height: 2\.05vw; \}/);
  assert.match(CSS, /\.tile-rule\.vol \{[\s\S]{0,80}height: 1\.6vh/,
    'volume receives a forgiving hit rail while retaining a thin visual line');
});

test('Wall 2 Pull From chooses a durable destination then a source with content', () => {
  const buildStart = WALL.indexOf('function buildTile(zone)');
  const buildEnd = WALL.indexOf('function beginGroupFrom(', buildStart);
  const build = WALL.slice(buildStart, buildEnd);
  assert.match(build, /pullB\.appendChild\(glyph\(['"]pull['"]\)\)/);
  assert.match(build, /left\.appendChild\(sendB\);\s*left\.appendChild\(pullB\)/,
    'Pull sits beside Send in the card action row');
  assert.match(WALL, /pendingPull = \{ zoneId: zone\.id, outputId: outputId \}/,
    'the destination survives grouping changes by output identity');
  assert.match(WALL, /!pullHere\s*&& zone\.nowPlaying !== null && zone\.outputs\.length > 0/,
    'playing, paused, and stopped players with retained content are presented as sources');
  assert.match(WALL, /source === null \|\| source\.nowPlaying === null \|\| source\.outputs\.length === 0/,
    'content and source identity are revalidated at the second press');
  assert.doesNotMatch(WALL, /source\.state !== ['"]playing['"]/);
  assert.match(WALL, /action: ['"]pull['"][\s\S]{0,160}from: source\.id[\s\S]{0,160}output: destination\.outputId[\s\S]{0,160}generation: snapshot\.generation[\s\S]{0,160}revision: snapshot\.revision/,
    'the browser sends the exact coordinator fence and performs no imitation transfer');
  assert.match(CSS, /\.grid > \.tile\.pull-source \{ --tile-frame: var\(--accent\); --tile-head: rgba\(216,162,74,\.38\); \}/);
  assert.match(CSS, /\.grid > \.tile\.pull-destination[\s\S]{0,100}background: #191b20/);
  assert.match(CSS, /\.ta\.now[\s\S]{0,130}border-color: var\(--accent\)/);
});

test('Wall 2 volume is segmented, aligned, and the speaker owns mute', () => {
  assert.match(WALL, /for \(var vs = 0; vs < 44; vs \+= 1\)/,
    'the Wall uses the same fine-grained runway scale as Presence');
  assert.match(WALL, /paintVolumeSegments\(tile\.volSegments, vl === null \? null : vl\.level, vl !== null && vl\.muted\)/);
  assert.doesNotMatch(WALL, /volFill/,
    'render cannot abort by referring to the removed continuous volume fill');
  assert.match(WALL, /quiet\(volMark, function \(\) \{[\s\S]{0,120}muteCommand\(zoneId\)[\s\S]{0,80}post\(body\)/,
    'the speaker is a real touch/click control');
  assert.match(WALL, /action: ['"]group-mute['"], zone: zone\.id/);
  assert.match(WALL, /action: ['"]mute['"], output: zone\.outputs\[0\]\.id, muted: !zone\.outputs\[0\]\.volume\.muted/);
  assert.match(CSS, /\.grid > \.tile \.tile-t,\s*\.grid > \.tile \.tile-vol-mark \{\s*width: 2\.5vw; min-width: 2\.5vw/,
    'progress and volume reserve identical endpoint columns');
  assert.match(CSS, /\.tile-t\.total \{ text-align: center; \}/,
    'the level is centred under the total time');
  assert.match(CSS, /\.tile-rule\.vol i \{[\s\S]{0,180}position: static[\s\S]{0,180}flex: 0 0 \.12vw[\s\S]{0,180}height: \.72vw/,
    'volume marks are narrow vertical Presence-style ticks, unlike continuous progress');
  assert.match(CSS, /\.tile-rule\.vol i\.on \{ background: var\(--accent\); \}/);
  assert.match(CSS, /\.tile-vol-mark\.muted:after[\s\S]{0,220}rotate\(-45deg\)/,
    'muted is visible on the speaker itself');
});

test('Wall action instructions occupy the top control line', () => {
  assert.match(WALL, /var controlHead = document\.querySelector\(['"]\.wall-head['"]\);\s*if \(controlHead !== null\) controlHead\.appendChild\(bar\)/);
  assert.match(WALL, /Pull into ['"] \+ pullZone\.name \+ ['"] · choose a player with content/);
  assert.match(WALL, /Send from ['"] \+ sendZone\.name \+ ['"] · choose a destination/);
  assert.match(CSS, /\.wall-bar \{\s*position: absolute; left: 0; right: 0; top: -\.55vh; bottom: auto/);
  assert.doesNotMatch(CSS, /\.wall-bar \{[\s\S]{0,100}position: fixed/);
});
