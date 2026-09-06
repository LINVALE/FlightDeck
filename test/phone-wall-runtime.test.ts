import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JS = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'phone-wall.js'), 'utf8');
const CSS = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'phone-wall.css'), 'utf8');
const PHONE = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'phone.js'), 'utf8');

// Peter 09-06: "a different wall that shows cards and individual elements optimised for a phone"
test('the phone wall is a fourth page on the same organs: one card per room, reused by zone id', () => {
  assert.match(JS, /import \{ createStore, formatTime \} from '\.\/store\.js';\s*import \{ createStream \} from '\.\/stream\.js';/);
  assert.match(JS, /var cards = \{\};/);
  assert.match(JS, /if \(card === undefined\) \{ card = buildCard\(zone\.id\); cards\[zone\.id\] = card; \}/, 'built once per room');
  assert.match(JS, /snapshot\.zones\.slice\(\)\.sort\(function \(a, b\) \{ return a\.name\.localeCompare\(b\.name\); \}\)/, 'alphabetical, never reordered by the music');
  assert.match(JS, /list\.replaceChildren\.apply\(list, nodes\)/);
  assert.doesNotMatch(JS, /userAgent/, 'the page never reads the user agent');
});

test('the words open the remote; play and the level act here, one tap one step', () => {
  assert.match(JS, /var open = function \(\) \{ location\.href = '\/phone\/' \+ encodeURIComponent\(zoneId\); \};/);
  assert.match(JS, /command\(\{ action: 'playpause', zone: z\.id \}\);/);
  assert.match(JS, /command\(\{ action: 'volume', output: out\.id, steps: delta \}\);/, 'the remote\'s own proven path: steps, never a raw value');
  assert.match(JS, /minus\.addEventListener\('click', step\(-1\)\);\s*plus\.addEventListener\('click', step\(1\)\);/, 'one tap, one step');
  assert.doesNotMatch(JS, /setInterval\([^)]*step/, 'no repeat while held');
  assert.match(JS, /event\.stopPropagation\(\);/, 'a button press never also opens the remote');
});

test('the card is a thumb\'s height with a 50px play and 38px level keys; the cover is sacred', () => {
  assert.match(CSS, /\.card-play \{\s*width: 50px; height: 50px; border-radius: 50%;/);
  assert.match(CSS, /\.card-level \.lv \{\s*width: 38px; height: 34px;/);
  assert.match(CSS, /\.card-art \{[^}]*width: 64px; height: 64px;/);
  assert.doesNotMatch(CSS, /\.card-art[^{]*\{[^}]*(opacity|filter|transform|mask)/, 'the cover is sacred');
  assert.doesNotMatch(CSS, /\d+vw/, 'a phone page is sized in px, never a television\'s vw');
  assert.doesNotMatch(CSS, /orientation: landscape/, 'lying down it is still one column (Peter 09-06)');
});

test('the remote\'s wordmark is the way back to the phone wall', () => {
  assert.match(PHONE, /head\.addEventListener\('click', function \(\) \{ location\.href = '\/phone'; \}\);/);
});

// Peter 09-06: "neither are connecting to browse or queue screens"
test('the remote has ways into the library and the queue, as sheets, on the same planes the Face and puck use', () => {
  const REMOTE_CSS = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'phone.css'), 'utf8');
  assert.match(PHONE, /ways\.appendChild\(roombar\); ways\.appendChild\(browseWay\); ways\.appendChild\(queueWay\);/);
  assert.match(PHONE, /return fetch\('\/api\/v1\/browse', \{/, 'the Browse plane');
  assert.match(PHONE, /ask\(\{ hierarchy: 'search', popAll: true, input: query\.trim\(\) \}\)/, 'search is its own hierarchy');
  assert.match(PHONE, /ask\(\{ hierarchy: browse\.hierarchy, popLevels: 1 \}\)/, 'back is popLevels');
  assert.match(PHONE, /body: JSON\.stringify\(\{ zone: zone\.id, itemId: item\.id, generation: queue\.data\.generation, queueRevision: queue\.data\.revision \}\)/, 'play from here is fenced by generation and revision');
  assert.match(PHONE, /if \(index === 0\) \{ flash\('already playing'\); return; \}/, 'the playing row is refused');
  assert.match(PHONE, /location\.href = '\/phone'; \}\);/, 'the rooms sheet leads to the phone wall');
  assert.match(REMOTE_CSS, /grid-template-areas: "head head" "art \." "art copy" "art runway" "art deck";/, 'lying down, the words keep company with the controls; the slack sits above');
  assert.match(REMOTE_CSS, /\.way \{[^}]*width: 44px; height: 44px;/, 'a way in is a finger\'s size');
});
