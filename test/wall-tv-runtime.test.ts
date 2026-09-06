import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const WALL = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'wall.js'), 'utf8');
const FACE = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'face.js'), 'utf8');
const CSS = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'wall.css'), 'utf8');
const PAGES = readFileSync(resolve(import.meta.dirname, '..', 'src', 'http', 'pages.ts'), 'utf8');

test('Wall card header is one state-coloured strip containing room, last seen, and hide', () => {
  assert.match(WALL, /head\.appendChild\(zoneLine\); head\.appendChild\(stamp\); head\.appendChild\(hideB\)/);
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
  assert.match(WALL, /if \(snapshot\.zones\.length === 0\)[\s\S]{0,360}drawTabs\(\[\], 0, 0\)[\s\S]{0,180}groupBtn\.hidden = true/,
    'the final device disappearing also clears the old selector and group action');
});

test('a grouped Wall 2 card keeps Group and adds a bottom-left Ungroup action', () => {
  const buildStart = WALL.indexOf('function buildTile(zone)');
  const buildEnd = WALL.indexOf('function beginGroupFrom(', buildStart);
  const build = WALL.slice(buildStart, buildEnd);
  assert.match(build, /post\(\{ action: ['"]ungroup['"], zone: zoneId \}\)/,
    'the existing whole-zone Ungroup contract is used directly');
  assert.match(build, /left\.appendChild\(groupB\);\s*left\.appendChild\(ungroupB\);\s*left\.appendChild\(sendB\);\s*left\.appendChild\(pullB\)/,
    'Group and Ungroup remain adjacent at the start of the action row');
  assert.match(WALL, /var grouped = zone\.outputs\.length > 1;[\s\S]{0,260}tile\.groupB\.hidden = false;\s*tile\.ungroupB\.hidden = !grouped/,
    'a group can add more rooms, while only a real multi-output zone offers Ungroup');
  assert.match(CSS, /\.tile-actions \.ta\[hidden\] \{ display: none; \}/);
  assert.match(build, /ungroupB\.appendChild\(glyph\(['"]ungroup['"]\)\)/);
  assert.doesNotMatch(build, /ungroupB\.appendChild\(el\(/,
    'Ungroup remains the same compact glyph button as Group and Send');
  assert.match(CSS, /\.tt-glyph, \.ta \.tt-glyph \{ width: \.8vw; height: \.8vw; \}/,
    'transport and card-action glyphs share the same legible base size');
});

test('Wall 2 is alphabetical or explicitly ordered and preserves a topology successor slot', () => {
  assert.match(WALL, /var alphabetical = alphabeticalWallZones\(zones\)/);
  assert.match(WALL, /if \(Array\.isArray\(saved\)\) return applyWallSlotOrder\(alphabetical, saved\)/,
    'a saved screen-local order wins without consulting playback state');
  assert.match(WALL, /joinedPreviousZones\(zones, previousOutputOwners\)/);
  assert.match(WALL, /var inherited = inheritWallOrder\(alphabetical, order, orderSlots\)/,
    'a group transition uses visual slot inheritance instead of new-zone recency');
  assert.match(WALL, /previousOutputOwners = wallOutputOwners\(inTab\)/,
    'the comparison is fenced to the immediately preceding family view');
});

test('Wall 2 owns the conditional Pause All action inside the common command deck', () => {
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
  assert.match(WALL, /cluster\.appendChild\(reorderBtn\);\s*cluster\.appendChild\(pauseAllBtn\);\s*cluster\.appendChild\(groupBtn\)/);
  assert.doesNotMatch(CSS, /\.wall-pause-all \{[^}]*position:\s*absolute/,
    'Pause All can no longer float over the other controls');
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
  assert.match(WALL, /cluster\.appendChild\(reorderBtn\);\s*cluster\.appendChild\(pauseAllBtn\);\s*cluster\.appendChild\(groupBtn\);\s*cluster\.appendChild\(groupAllBtn\);\s*cluster\.appendChild\(ungroupAllBtn\)/);
  assert.match(CSS, /\.wall-command-cluster[\s\S]{0,180}display: -webkit-inline-flex; display: inline-flex/,
    'the related grouping commands form one deliberate deck');
});

test('grouping commands render a high-contrast glyph on the legacy TV floor', () => {
  assert.match(WALL, /var groupingMark = name === ['"]group['"] \|\| name === ['"]groupall['"][\s\S]{0,90}name === ['"]ungroup['"] \|\| name === ['"]ungroupall['"]/);
  assert.match(WALL, /line\.setAttribute\(['"]stroke['"], groupingMark \? ['"]#f2eee6['"] : ['"]currentColor['"]\)/,
    'group glyphs do not depend on inherited SVG currentColor in Chromium 63');
  assert.match(WALL, /line\.setAttribute\(['"]stroke-width['"], groupingMark \? ['"]2\.15['"] : ['"]1\.7['"]\)/,
    'the chain and split marks remain readable at card-button scale');
});

test('Group All and Ungroup All stay inside one compatible family', () => {
  assert.match(WALL, /groupAllBtn\.appendChild\(glyph\(['"]groupall['"]\)\)/);
  assert.match(WALL, /ungroupAllBtn\.appendChild\(glyph\(['"]ungroupall['"]\)\)/);
  // Peter 09-06: the hidden-cards page offers every hidden room back in one press
  assert.match(WALL, /unhideAllBtn\.appendChild\(glyph\('restore'\)\);\s*unhideAllBtn\.appendChild\(el\('span', 'wall-act-label', 'unhide all'\)\);/);
  assert.match(WALL, /cluster\.appendChild\(ungroupAllBtn\);\s*cluster\.appendChild\(unhideAllBtn\);/);
  assert.match(WALL, /unhideAllBtn\.hidden = !showHiddenMode;/, 'unhide all shows only on the hidden page');
  assert.match(WALL, /function unhideAll\(\) \{\s*if \(hiddenSlots\.length === 0\) return;\s*hiddenSlots = \[\];\s*persistHidden\(\);\s*showHiddenMode = false;/, 'one press empties the hidden list, saves it, and leaves the hidden page');
  assert.match(WALL, /groupAllBtn\.appendChild\(el\(['"]span['"], ['"]wall-act-label['"], ['"]group all['"]\)\)/);
  assert.match(WALL, /ungroupAllBtn\.appendChild\(el\(['"]span['"], ['"]wall-act-label['"], ['"]ungroup all['"]\)\)/);
  const familyStart = WALL.indexOf('function currentFamilyZones(snapshot)');
  const familyEnd = WALL.indexOf('\nfunction post(', familyStart);
  const family = WALL.slice(familyStart, familyEnd);
  assert.match(family, /if \(family !== ['"]['"] && family !== found\) return \[\]/,
    'the aggregate tab cannot manufacture a cross-protocol All');
  assert.match(family, /zoneIsland\(snapshot\.zones\[z\]\) === family/);
  assert.match(WALL, /groupAllBtn\.hidden = selectMode \|\| reorderMode \|\| showHiddenMode \|\| familyZones\.length < 2/);
  assert.match(WALL, /ungroupAllBtn\.hidden = selectMode \|\| reorderMode \|\| showHiddenMode \|\| familyGroups === 0/);

  const groupStart = WALL.indexOf('function beginGroupAll()');
  const groupEnd = WALL.indexOf('\nfunction beginUngroupAll()', groupStart);
  const groupAll = WALL.slice(groupStart, groupEnd);
  assert.match(groupAll, /ids\.push\(zones\[i\]\.id\)/);
  assert.match(groupAll, /enterSelect\(ids\)/,
    'Group All preselects the visible leader but still enters confirmation mode');

  const ungroupStart = WALL.indexOf('function beginUngroupAll()');
  const ungroupEnd = WALL.indexOf('\nfunction exitSelect()', ungroupStart);
  const ungroupAll = WALL.slice(ungroupStart, ungroupEnd);
  assert.match(ungroupAll, /zones\[i\]\.outputs\.length > 1/,
    'only actual groups enter the bulk ungroup transaction');
  assert.match(ungroupAll, /pendingUngroupAll = ids/);
  assert.match(ungroupAll, /post\(\{ action: ['"]ungroup['"], zone: zone\.id \}\)/);
  assert.match(WALL, /Ungroup all ['"] \+ String\(pendingUngroupAll\.length\) \+ ['"] groups in this device family\?/,
    'Ungroup All requires a visible top-line confirmation');
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
  assert.match(CSS,
    /\.tile-body \{[\s\S]{0,180}flex: 1 1 auto[\s\S]{0,180}\.wall\[data-rows="2"\] \.tile-body,[\s\S]{0,120}\.wall\[data-rows="3"\] \.tile-body \{[\s\S]{0,100}justify-content: center/,
    'taller cards keep the room strip at the top and centre only the body below it');
  assert.match(WALL,
    /var body = el\(['"]div['"], ['"]tile-body['"]\);[\s\S]{0,1600}tile\.appendChild\(head\); tile\.appendChild\(body\)/,
    'the fixed room strip is outside the vertically centred card body');
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
  assert.match(WALL, /paintVolumeSegments\(tile\.volSegments, vl === null \? null : vl\.level, vl !== null && vl\.muted, vl === null \? null : vl\.bands\)/);
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

test('Wall progress is a seek control and consumes card navigation', () => {
  const buildStart = WALL.indexOf('function buildTile(zone)');
  const buildEnd = WALL.indexOf('function beginGroupFrom(', buildStart);
  const build = WALL.slice(buildStart, buildEnd);
  assert.match(build, /quiet\(rule, function \(event\) \{/,
    'the progress press uses the same navigation-suppressing control wrapper as buttons');
  assert.match(build, /var fraction = \(event\.clientX - box\.left\) \/ box\.width/);
  assert.match(build, /var seconds = seekTargetSecond\(fraction, length\)/);
  assert.match(build, /post\(\{ action: ['"]seek['"], zone: current\.id, seconds: seconds \}\)/);
  assert.match(CSS, /\.grid > \.tile \.tile-rule:not\(\.vol\) \{ cursor: pointer; \}/);
});

test('Wall card navigation follows a durable room after cards or topology move', () => {
  assert.match(WALL, /var faceId = zone\.outputs\.length > 0 \? zone\.outputs\[0\]\.id : zoneId/);
  assert.match(WALL, /tile\.href = ['"]\/face\/['"] \+ encodeURIComponent\(faceId\)/);
  assert.match(WALL,
    /var faceId = zone\.outputs\.length > 0 \? zone\.outputs\[0\]\.id : zone\.id;[\s\S]{0,140}tile\.node\.href = ['"]\/face\/['"] \+ encodeURIComponent\(faceId\)/,
    'every render refreshes the anchor from the room currently painted on that card');
  assert.match(FACE,
    /if \(zoneId === ['"]['"] && boundOutputId === null\) \{[\s\S]{0,180}localStorage\.getItem\(STORE_KEY_ZONE \+ zoneId\)/,
    'an explicit Wall link cannot be replaced by an old room remembered by that Face');
});

test('Wall cards hide into a durable Hidden page and restore on card press', () => {
  assert.match(WALL, /localStorage\.getItem\(['"]flightdeck\.wall-hidden['"]\)/);
  assert.match(WALL, /localStorage\.setItem\(['"]flightdeck\.wall-hidden['"], JSON\.stringify\(hiddenSlots\)\)/);
  assert.match(WALL, /hideB\.appendChild\(glyph\(['"]minimize['"]\)\)/);
  assert.match(WALL, /hiddenTab = el\(['"]span['"], showHiddenMode \? ['"]wall-tab now['"] : ['"]wall-tab['"], ['"]hidden  ['"] \+ String\(hiddenCount\)\)/);
  assert.match(WALL, /hiddenTab\.insertBefore\(glyph\(['"]minimize['"]\), hiddenTab\.firstChild\)/);
  assert.match(CSS, /\.wall-tab > \.tt-glyph \{[\s\S]{0,160}width: \.78vw; height: \.78vw[\s\S]{0,120}color: var\(--accent\)/,
    'Hidden carries a leading visual mark in the same slot as a family swatch');
  assert.match(WALL, /if \(showHiddenMode\) \{ toggleHidden\(zoneId\); return true; \}/,
    'a Hidden-page card press restores instead of opening its Face');
  assert.match(WALL, /tile\.hideB\.replaceChildren\(glyph\(showHiddenMode \? ['"]restore['"] : ['"]minimize['"]\)\)/);
  assert.match(CSS, /\.wall\.is-hidden-page \.grid > \.tile > \* \{ pointer-events: none; \}/,
    'the whole hidden card is one large restore target');
});

test('Wall Reorder is an explicit saved drag mode, separate from grouping', () => {
  assert.match(WALL, /localStorage\.setItem\(['"]flightdeck\.wall-orders['"], JSON\.stringify\(manualOrders\)\)/);
  assert.match(WALL, /barHint\.textContent = ['"]Reorder cards · drag into place, then Save['"]/);
  assert.match(WALL, /doBtn\(['"]save['"], saveReorder\)[\s\S]{0,100}doBtn\(['"]a–z['"], resetReorder\)[\s\S]{0,100}doBtn\(['"]cancel['"], cancelReorder\)/);
  assert.match(WALL, /reorder: reorderMode, moved: false, armed: false/);
  assert.match(WALL, /if \(drag\.reorder\) \{[\s\S]{0,180}drag\.valid\[keys\[i\]\] = true[\s\S]{0,120}continue/);
  const finishStart = WALL.indexOf('function finishDrag(d, overId)');
  const actionStart = WALL.indexOf('var action = null;', finishStart);
  const reorder = WALL.slice(finishStart, actionStart);
  assert.match(reorder, /draftSlots\.splice\(to, 0, sourceSlot\)/);
  assert.doesNotMatch(reorder, /post\(/, 'reordering cards never sends a grouping command');
  assert.match(CSS, /\.wall\.is-reordering \.grid > \.tile \{ cursor: move; \}/);
});

test('the card grid is the only scrolling window between held top and bottom lines', () => {
  assert.match(CSS, /\.wall \{[\s\S]{0,160}height: 100vh; min-height: 0; overflow: hidden/);
  assert.match(CSS, /\.grid \{[\s\S]{0,720}overflow-y: auto/);
  assert.match(CSS, /\.wall-head \{[\s\S]{0,180}flex: 0 0 auto/);
  assert.match(CSS, /\.wall-foot \{ -webkit-flex: 0 0 auto; flex: 0 0 auto; \}/);
});

test('the top belongs to the type picker and commands while identity moves to the held footer', () => {
  const header = PAGES.slice(PAGES.indexOf('+ \'<header class="wall-head">\''), PAGES.indexOf('+ \'<div class="grid"', PAGES.indexOf('+ \'<header class="wall-head">\'')));
  const footer = PAGES.slice(PAGES.indexOf('+ \'<footer class="wall-foot">\''), PAGES.indexOf('+ \'</footer>', PAGES.indexOf('+ \'<footer class="wall-foot">\'')));
  assert.match(header, /<nav class="wall-tabs" id="tabs" hidden><\/nav>/);
  assert.doesNotMatch(header, /FLIGHT<span>DECK|id="summary"|id="core"/);
  assert.match(footer, /wall-status[\s\S]{0,300}FLIGHT<span>DECK[\s\S]{0,200}id="summary"[\s\S]{0,160}id="core"/);
  assert.match(CSS, /\.wall > \.wall-tabs \{ -webkit-flex: 0 0 auto; flex: 0 0 auto; \}/,
    'the still-running old page cannot let its sibling picker consume card height');
  assert.match(CSS, /\.wall-head > \.wall-tabs \{ -webkit-flex: 1 1 auto; flex: 1 1 auto; min-width: 0; \}/,
    'after the server refresh, only the picker nested in the top line may flex horizontally');
  assert.match(CSS, /\.wall-foot \{[\s\S]{0,300}justify-content: space-between/);
});

test('startup builds the first Wall behind a centred progress veil and reveals it once', () => {
  const startupAt = PAGES.indexOf('<div class="wall-startup" id="wall-startup"');
  const headerAt = PAGES.indexOf('<header class="wall-head">');
  assert.ok(startupAt !== -1 && startupAt < headerAt, 'the preparation state is present before any Wall chrome');
  assert.match(PAGES, /wall-startup-spinner[\s\S]{0,180}Preparing rooms[\s\S]{0,180}Finding devices and arranging the Wall…/);
  assert.match(CSS, /\.wall > \.wall-head, \.wall > \.grid, \.wall > \.wall-foot \{ visibility: hidden; \}/);
  assert.match(CSS, /\.wall\.is-ready > \.wall-head, \.wall\.is-ready > \.grid, \.wall\.is-ready > \.wall-foot \{ visibility: visible; \}/);
  assert.match(CSS, /\.wall-startup \{[\s\S]{0,420}justify-content: center[\s\S]{0,220}background: var\(--ink\)/);
  assert.match(CSS, /\.wall-startup-spinner \{[\s\S]{0,260}border-top-color: var\(--accent\)[\s\S]{0,180}wall-startup-turn \.9s linear infinite/);
  assert.match(WALL, /startupDeadlineTimer = setTimeout\(finishStartup, 2600\)/,
    'one failed image cannot hold the Wall behind the curtain');
  assert.match(WALL, /tile\.artReady = true;\s*settleStartup\(\)/,
    'successful or exhausted artwork releases its startup obligation');
  assert.match(WALL, /paintPending\(\);\s*prepareStartup\(shown\)/,
    'the visible card set is fully constructed before it may reveal');
  assert.match(WALL, /root\.classList\.add\(['"]is-ready['"]\)/);
});

test('Wall action instructions occupy the top control line', () => {
  assert.match(WALL, /var controlHead = document\.querySelector\(['"]\.wall-head['"]\);\s*if \(controlHead !== null\) controlHead\.appendChild\(bar\)/);
  assert.match(WALL, /Pull into ['"] \+ pullZone\.name \+ ['"] · choose a player with content/);
  assert.match(WALL, /Send from ['"] \+ sendZone\.name \+ ['"] · choose a destination/);
  assert.match(CSS, /\.wall-bar \{\s*position: absolute; left: 0; right: 0; top: -\.55vh; bottom: auto/);
  assert.doesNotMatch(CSS, /\.wall-bar \{[\s\S]{0,100}position: fixed/);
});

/**
 * ⚖️ NO CARD IS EVER BIGGER THAN A QUARTER OF THE SCREEN (Peter, 09-03: "when we
 * are down to less than 4 cards the layout for each gets too big and controls
 * spread out").
 *
 * One room filled a whole television and two took half the width and all of the
 * height — and because every reading inside a card scales with `data-rows`, a
 * single room also got a 30vh sleeve and a transport row a metre wide. The cap
 * is the footprint a card has in a full 2x2, the leftover becomes margin, and
 * `data-rows` carries the SIZE class so the readings stay the size they are on a
 * full wall.
 */
test('a wall of fewer than four rooms is capped at a quarter each and centred', () => {
  assert.match(WALL, /var capped = count < 4;/);
  assert.match(WALL, /colPct = capped \? Math\.min\(100 \/ cols, 100 \/ 3\) : 100 \/ cols/,
    'a third of the width, so two rooms leave margin instead of spreading the transport row');
  assert.match(WALL, /gridAutoRows = \(half \? 50 : 100 \/ rows\)/);
  assert.match(WALL, /justifyContent = capped \? 'center' : ''/);
  assert.match(WALL, /alignContent = half \? 'center' : ''/,
    'centring a grid that SCROLLS can put its first row out of reach, so only a wall short of its height (capped, or one row) is centred');
  assert.match(WALL, /root\.setAttribute\('data-rows', String\(rowsClass\)\)/,
    'a capped card is a half-height card and takes the two-row type scale');
  // Removed rather than out-specified, exactly as the density tiers were.
  assert.doesNotMatch(WALL, /' solo'/);
  assert.doesNotMatch(CSS, /\.tile\.solo \{/);
});

/**
 * ⚖️ THE RESTING SCREEN (Peter, 09-05: "centre the information and design a
 * nice logo for the centre"). FlightDeck's own dial mark, drawn as line-work,
 * then the wordmark, the fact, and what to do about it — centred in the grid.
 */
test('the empty Wall centres its mark, wordmark and the one fact it has to say', () => {
  assert.match(WALL, /grid\.replaceChildren\(emptyState\(\)\);/);
  assert.match(WALL, /function flightDeckMark\(\) \{[\s\S]{0,900}arc\.setAttribute\('d', 'M 24\.5 24\.5 A 36 36 0 1 1 68 81\.2'\);/, 'the app icon\'s arc: half past ten round to five');
  assert.match(WALL, /hub\.setAttribute\('r', '17'\); hub\.setAttribute\('fill', '#e8c77a'\);/);
  assert.match(WALL, /el\('div', 'empty-title', 'No Roon zones yet'\)/);
  assert.match(WALL, /el\('div', 'empty-copy', 'Enable a zone in Roon and it will appear here\.'\)/);
  assert.match(CSS, /\.empty \{\s*grid-column: 1 \/ -1; grid-row: 1 \/ 5;[\s\S]{0,300}justify-content: center;/, 'centred in the whole grid');
  assert.match(CSS, /\.empty-mark \{ width: 16vh; height: 16vh;/);
});

/**
 * ⚖️ A CARD AT REST READS; A CARD REACHED FOR OPENS (Peter, 09-06). Four rows
 * compressed the words into nothing, and the words matter more than the bottom
 * line. So the controls leave the card for a drawer that opens under the
 * pointer, a finger's first tap or focus, laid over the row below (or above at
 * the wall's foot), at a size a finger can take; the card keeps the room, the
 * music, its state and its position. The cover is sacred: nothing is scaled.
 */
test('the controls live in a drawer that opens under the pointer, a tap or focus; the card at rest keeps the words', () => {
  assert.match(WALL, /copy\.appendChild\(title\); copy\.appendChild\(line2\);\n/, 'the transport no longer sits beside the words');
  assert.match(WALL, /var drawer = el\('div', 'tile-drawer'\);\s*drawer\.appendChild\(transport\); drawer\.appendChild\(volLine\);\s*drawer\.appendChild\(actions\); drawer\.appendChild\(openAs\); drawer\.appendChild\(detail\);/);
  assert.match(WALL, /body\.appendChild\(now\); body\.appendChild\(progress\);\s*tile\.appendChild\(head\); tile\.appendChild\(body\); tile\.appendChild\(drawer\);/, 'the card keeps the music and its position');
  assert.match(WALL, /if \(below\.bottom > wall\.bottom - 2\) \{\s*tile\.style\.setProperty\('--rise', '-' \+ Math\.ceil\(below\.bottom - wall\.bottom \+ 2\) \+ 'px'\);\s*tile\.classList\.add\('open-up'\);/, 'a drawer that would run off the wall lifts the card by the overrun instead');
  assert.match(WALL, /if \(fromFinger && root\.hasAttribute\('data-drawer'\) && !tile\.classList\.contains\('is-open'\)\) \{\s*event\.preventDefault\(\); event\.stopPropagation\(\);\s*openCard\(tile, drawer\);/, 'a finger\'s first tap opens, never leaves');
  assert.match(CSS, /\.tile-drawer \{\s*display: none;\s*position: absolute; left: -1px; right: -1px; top: 100%; z-index: 7;/);
  assert.match(CSS, /\.wall\[data-drawer\] \.grid > \.tile:hover \.tile-drawer,\s*\.wall\[data-drawer\] \.grid > \.tile:focus-within \.tile-drawer,\s*\.wall\[data-drawer\] \.grid > \.tile\.is-open \.tile-drawer \{ display: block; \}/);
  assert.match(CSS, /\.wall\[data-drawer\] \.grid > \.tile\.open-up:hover, \.wall\[data-drawer\] \.grid > \.tile\.open-up:focus-within, \.wall\[data-drawer\] \.grid > \.tile\.open-up\.is-open \{\s*top: var\(--rise, 0\);/, 'the risen card keeps words above controls, like every other row');
  assert.doesNotMatch(CSS, /bottom: 100%/, 'no drawer opens upward any more');
  assert.match(CSS, /\.tile-drawer \.tt \{ width: 3vw; height: 3vw; \}/, 'a size a finger can take');
  assert.match(CSS, /\.wall\[data-drawer\] \.grid > \.tile \.tile-title \{ -webkit-line-clamp: 2; font-size: 1\.15vw; \}/, 'the words get the room the transport took');
  assert.doesNotMatch(CSS, /\.tile-drawer[^\n]*transform/, 'the cover is sacred: the drawer is laid over, never scaled');
  assert.match(WALL, /tile\.node\.className = classFor\(zone, isHero\) \+ kept;/, 'a paint keeps the classes a hand put there: an opened card, an upward drawer');
  assert.match(WALL, /var fromFinger = event\.sourceCapabilities \? event\.sourceCapabilities\.firesTouchEvents === true : Date\.now\(\) - lastTouchAt < 700;/, 'the browser says whether a click came from a finger');
  // Peter 09-06: two rows or fewer keep the old card; one row keeps the half-height card
  assert.match(WALL, /var half = capped \|\| rows === 1;/, 'a one-row wall keeps the half-height card, centred');
  assert.match(WALL, /var rowsClass = half \? 2 : rows;\s*root\.setAttribute\('data-rows', String\(rowsClass\)\);/, 'the size class never reads 1 any more');
  assert.match(WALL, /var drawerMode = rowsClass >= 3;\s*if \(drawerMode\) root\.setAttribute\('data-drawer', '1'\); else root\.removeAttribute\('data-drawer'\);/, 'the drawer is for three rows or more');
  assert.match(WALL, /function houseControls\(t, drawerMode\) \{\s*if \(t\.housed === drawerMode\) return;/, 'the controls have two homes and move only when the wall changes size');
  assert.match(WALL, /t\.copy\.appendChild\(t\.transport\);\s*t\.body\.appendChild\(t\.volLine\); t\.body\.appendChild\(t\.actions\);/, 'the old card: transport under the credit, the rest below the progress');
  assert.match(WALL, /houseControls\(tile, drawerMode\);/, 'every painted tile is housed for the wall it is on');
  assert.match(CSS, /\.wall\[data-drawer\] \.grid > \.tile:hover \.tile-drawer,/, 'nothing opens on a wall without a drawer');
  assert.doesNotMatch(CSS, /data-rows="1"/, 'size class 1 is gone with its rules, not out-specified');
});


// Peter 09-06: a Fire TV had fallen into the phone-shaped card rules
test('a phone is sent to the phone wall by shape, never by user agent; the Wall keeps no phone-shaped card rules', () => {
  assert.match(WALL, /import \{ decideUi \} from '\.\/screen-shape\.js';/);
  assert.match(WALL, /if \(decideUi\(window, location\.search, storageOrNull\) === 'phone'\) location\.replace\('\/phone'\);/);
  assert.doesNotMatch(WALL, /userAgent/, 'the Wall never reads the user agent');
  assert.doesNotMatch(CSS, /\.tile\.is-live \.tile-art \{ width: 18vw/, 'the single-column box rules are gone');
  assert.doesNotMatch(CSS, /@media \(max-width: 900px\) \{\s*\.tile \{ width: 100%; \}/);
});

// Peter 09-06: volume limits, the same on every face
test('the Wall\'s scale is drawn to the top in Roon\'s bands; a press is held at comfort, a second press passes it, none passes safety', () => {
  assert.match(WALL, /import \{ limitsOf, bandsOf, bandAtFraction, askedLevel, createDoubleTap \} from '\.\/volume-limits\.js';/);
  assert.match(WALL, /var twice = volumeTaps\.press\(zoneId, Date\.now\(\)\);\s*var asked = volumeCommand\(zoneId, want, twice\);\s*if \(asked === null\) return;/, 'above safety the room does not respond');
  assert.match(WALL, /var asked = askedLevel\(limits\.min \+ level \* \(limits\.max - limits\.min\), limits, override === true\);/);
  assert.match(WALL, /nodes\[i\]\.className = \(on \? 'on' : ''\) \+ \(band === 'ok' \? '' : ' ' \+ band\);/, 'segments wear their band');
  assert.match(CSS, /\.tile-rule\.vol i\.comfort\.on \{ background: #c9902e; \}/);
  assert.match(CSS, /\.tile-rule\.vol i\.danger\.on \{ background: rgb\(232, 84, 70\); \}/);
});
