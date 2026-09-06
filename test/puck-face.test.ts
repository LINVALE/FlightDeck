import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { tierFor, sampleOffsets, letterOf, keyOf, prefixCompare, isAlphabetical, selectionComplete, queueRows, ledgerRows, firstArtist, ago } from '../assets/puck-browse.js';
import { STOPS, nextStop } from '../assets/puck-axis.js';
import { levelForDrag } from '../assets/volume-gate.js';
import { iconNameFor, genreIconFor, hasGlyph } from '../assets/puck-icons.js';
import { ZONES } from './fixtures/zones.ts';

const asset = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '..', 'assets', name), 'utf8');

const JS = asset('puck.js');
const BROWSE = asset('puck-browse.js');
const CSS = asset('puck.css');

/**
 * ⚖️ THE LETTER RING BELONGS TO THE BIG LISTS (Peter, 09-03). It was designed
 * for 13–200, and that band never needed it: two hundred rows is a spin. Two
 * thousand three hundred albums is not, and those are the lists Roon does sort.
 *
 * The count still picks the SHAPE — Roon states it with the level, so the dial
 * never fetches two thousand albums to discover they will not ring a circle —
 * but over the whole-load band the ring is only a CANDIDATE until the order is
 * seen. Measured on Peter's library: Explore 7, Genres 56, Albums 2302.
 */
test('the count allows a tier; only the big band may reach for the ring', () => {
  assert.equal(tierFor(7), 'radial');
  assert.equal(tierFor(8), 'linear', 'eight or more are pages of seven, so every circle keeps its name (Peter, 09-04)');
  assert.equal(tierFor(12), 'linear');
  assert.equal(tierFor(13), 'linear', 'thirteen rows is a spin, not an index');
  assert.equal(tierFor(56), 'linear');
  assert.equal(tierFor(200), 'linear', 'Roon loads 200 at once, so 200 can be read whole');
  assert.equal(tierFor(201), 'alpha', 'past the load cap an index is the only way in');
  assert.equal(tierFor(2302), 'alpha');
  // An empty level is still a level, and a ring of nothing is not a crash.
  assert.equal(tierFor(0), 'radial');
});

/**
 * A level too big to read whole has its order SAMPLED. The last row is the one
 * that matters: a list ordered by size rather than by name betrays itself there.
 */
test('a big level is sampled at its quarters and its end', () => {
  assert.deepEqual(sampleOffsets(2302), [575, 1151, 1726, 2301]);
  assert.deepEqual(sampleOffsets(201), [50, 100, 150, 200]);
  // No duplicates, and never offset 0 — the first page already answered that.
  assert.deepEqual(sampleOffsets(4), [1, 2, 3]);
  assert.deepEqual(sampleOffsets(2), [1]);
});

/**
 * ⚠️ MEASURED 09-03 on the live Core: the middle tier's premise is NOT free.
 * Genres came back 56 long and ordered by SIZE — Pop/Rock, Jazz, Classical,
 * Rock — so an alphabet ring over it offered 26 letters that led nowhere, and a
 * bisection for "C" answered 0 because the first title already sorted past it.
 * The count says how MANY; only the titles say whether they are in order.
 */
test('the alphabet ring is earned from the titles, never assumed from the count', () => {
  assert.equal(isAlphabetical([{ title: 'ABBA' }, { title: 'Bowie' }, { title: 'Coltrane' }]), true);
  // The real Genres level, in the order the Core actually returned it.
  assert.equal(isAlphabetical([
    { title: 'Pop/Rock' }, { title: 'Jazz' }, { title: 'Classical' }, { title: 'Rock' },
  ]), false);
  // Roon files "The Beatles" under B, so the ring must bucket before it compares.
  assert.equal(isAlphabetical([{ title: 'ABBA' }, { title: 'The Beatles' }, { title: 'Cash' }]), true);
  // Numbers sort ahead of letters, exactly as the Core orders them.
  assert.equal(isAlphabetical([{ title: '1979' }, { title: 'Adele' }]), true);
  assert.equal(isAlphabetical([{ title: 'Adele' }, { title: '1979' }]), false);
  assert.equal(isAlphabetical([]), false, 'nothing to ring is not an ordered ring');
});

/**
 * ⚠️ MEASURED 09-03 against every row of three live hierarchies — albums 2302,
 * artists 1481, composers 6305, read whole and compared pairwise. Roon's
 * collation is not the obvious one, and guessing it cost two whole letters: the
 * shipping rule left ELEVEN inversions across those 10,088 titles, and seven of
 * them were enough to make the bisection refuse T, U and Z on a library that has
 * all three. Under the rule below there are ZERO.
 */
test('a title is bucketed the way the Core actually ordered it', () => {
  // "THE" is dropped — `The Real McCoy` sits among the R's...
  assert.equal(letterOf('The Beatles'), 'B');
  assert.equal(letterOf('The Real McCoy (2012 Remastered)'), 'R');
  // ...but "A" and "AN" are NOT: these two sort exactly where Roon put them,
  // immediately before `ABBA Gold` and `Ancient Heart`.
  assert.equal(letterOf('A Yuletide Offering: Carols'), 'A');
  assert.equal(letterOf('An Oscar Peterson Christmas'), 'A');
  assert.equal(letterOf('A Love Supreme'), 'A');
  // The separator after THE may be a UNICODE hyphen. `The‐Dream` (U+2010) is
  // filed under D, between `DRC Music` and `Drew Holcomb`.
  assert.equal(letterOf('The\u2010Dream'), 'D');
  // Leading quotes, apostrophes and dots are ignored...
  assert.equal(letterOf('...But Seriously'), 'B');
  assert.equal(letterOf("'Round About Midnight"), 'R');
  assert.equal(letterOf('The "V Discs" - The Columbia Years'), 'V');
  assert.equal(letterOf('"Four" & More'), 'F');
  // ...but brackets and question marks are NOT: both of these sort at the very
  // top of their own levels on the live Core.
  assert.equal(letterOf("(What's The Story) Morning Glory?"), '#');
  assert.equal(letterOf('?uestlove'), '#');
  assert.equal(letterOf('1979'), '#');
  assert.equal(letterOf('\u2026And Justice For All'), '#', 'an ellipsis is a mark, not another script');
  assert.equal(letterOf(''), '#');
  // Accents fold: Roon files her under E, not past Z with the CJK.
  assert.equal(letterOf('\u00c9dith Piaf'), 'E');
  // Other scripts sort AFTER Z — the two the live library actually ends on.
  assert.equal(letterOf('\u601d\u3044\u51fa\u306e\u30d1\u30ea'), '~');
  assert.equal(letterOf('\u9648\u745e\u796f'), '~');
  assert.ok('#' < 'A' && 'Z' < '~', "the stops compare as strings in the Core's own order");
});

/** The real samples from the live Core, in the order it returned them. */
test('the live big levels read as ordered, and Genres still does not', () => {
  const rows = (titles: string[]): { title: string }[] => titles.map((title) => ({ title }));
  // Albums 2302: three punctuation titles, then D · K · R, then a Japanese one.
  assert.equal(isAlphabetical(rows([
    "(What's The Story) Morning Glory?", '#1 Record/Radio City', '1,039/Smoothed Out Slappy Hours',
    'Dark And Dreary', 'King Of The Delta Blues Singers', 'The River', '思い出のパリ',
  ])), true);
  // Artists 1481, which ends inside the alphabet rather than past it.
  assert.equal(isAlphabetical(rows([
    '10,000 Maniacs', 'Diego Torres', 'Juanes', 'Phil Collins', 'ZZ Ward',
  ])), true);
  // The run that broke the old rule, in the order the Core returned it.
  assert.equal(isAlphabetical(rows([
    'Dr. John', 'Drake', 'DRC Music', 'The\u2010Dream', 'Drew Holcomb',
  ])), true);
  assert.equal(isAlphabetical(rows(['Utopia', 'The "V Discs" - The Columbia Years'])), true);
  assert.equal(isAlphabetical(rows(['Pop/Rock', 'Jazz', 'Classical', 'Rock'])), false);
});

/**
 * A leaf is the choice a listener deliberately made — Play Now, Queue, a station.
 * Some Core builds answer with a message and some answer only `none`; the item's
 * own hint is the stable half of the contract, so both are honoured.
 */
test('a completed selection closes the dial, and an error never does', () => {
  assert.equal(selectionComplete({ hint: 'action' }, { action: 'list', isError: false }), true);
  assert.equal(selectionComplete({ hint: 'list' }, { action: 'none', isError: false }), true);
  assert.equal(selectionComplete({ hint: 'list' }, { action: 'message', isError: false }), true);
  assert.equal(selectionComplete({ hint: 'list' }, { action: 'list', isError: false }), false);
  assert.equal(selectionComplete({ hint: 'action' }, { action: 'none', isError: true }), false);
});

/**
 * ⚖️ A CHOICE IS A TOKEN IN A CIRCLE, AND AN ICON WHERE ONE IS OBVIOUS (Peter,
 * 09-03). `My Live Radio` will never fit inside a thumb-wide disc, so the circle
 * carries the icon and the centre reads the name.
 *
 * Roon's own hint is consulted BEFORE the noun in the title: `Play Album` is an
 * action and must read as play, not as a disc.
 */
test('a browse row earns an icon from the Core\'s own words, or none at all', () => {
  const named = (title: string, hint: string | null): string | null => iconNameFor(title, hint);
  assert.equal(named('Library', 'list'), 'library');
  assert.equal(named('My Live Radio', 'list'), 'radio');
  assert.equal(named('Playlists', 'list'), 'playlist');
  assert.equal(named('Genres', 'list'), 'genre');
  assert.equal(named('Settings', 'list'), 'settings');
  assert.equal(named('TIDAL', 'list'), 'cloud');
  assert.equal(named('Qobuz', 'list'), 'cloud');
  assert.equal(named('Search', 'list'), 'search');
  assert.equal(named('Artists', 'list'), 'artist');
  assert.equal(named('Albums', 'list'), 'album');
  assert.equal(named('Composers', 'list'), 'composer');
  assert.equal(named('Tracks', 'list'), 'track');
  // The hint wins: these are leaves, and they must read as what they DO.
  assert.equal(named('Play Album', 'action'), 'play');
  assert.equal(named('Play Artist', 'action'), 'play');
  // Roon hints a row that OPENS its actions `action_list`; it still does a thing.
  assert.equal(named('Play Genre', 'action_list'), 'play', 'seen live under Folk: it wore the genre tag');
  assert.equal(named('Play Genre', 'list'), 'play', '"Play …" is a verb whatever the hint');
  assert.equal(named('Start Radio', 'action'), 'radio');
  assert.equal(named('Add Next', 'action'), 'queue');
  assert.equal(named('Shuffle', 'action'), 'shuffle');
  // The services' own shelves (Peter, 09-04): Favorites, What's New, TIDAL Rising and kin.
  assert.equal(named('Favorites', 'list'), 'heart');
  assert.equal(named("What's New", 'list'), 'sparkle');
  assert.equal(named('New Releases', 'list'), 'sparkle');
  assert.equal(named('TIDAL Rising', 'list'), 'rising', 'rising, not TIDAL');
  assert.equal(named('Press Awards', 'list'), 'award');
  assert.equal(named('Top Charts', 'list'), 'chart');
  assert.equal(named('Recently Played', 'list'), 'clock');
  assert.equal(named('Moods', 'list'), 'leaf');
  assert.equal(named('Works', 'list'), 'clef');
  assert.equal(named('Qobuz Playlists', 'list'), 'playlist');
  assert.equal(named('Taste of Qobuz', 'list'), 'award', 'the editorial shelf, not the service cloud');
  assert.equal(named('My Qobuz', 'list'), 'heart');
  assert.equal(named('My Live Radio', 'list'), 'radio', '"my" must not steal a row that names a radio');
  assert.equal(named('Your Favorites', 'list'), 'heart');
  for (const name of ['sparkle', 'rising', 'award', 'chart', 'clock', 'bookmark']) assert.ok(hasGlyph(name), name + ' has line-work');
  // A row the Core names for itself gets no icon rather than a wrong one, and
  // falls back to its own sleeve and then to its initial.
  assert.equal(named('Kind of Blue', 'list'), null);
  assert.equal(named('Miles Davis', null), null);
  assert.equal(named('', null), null);
  // Every name the mapping can return must actually be drawable.
  for (const name of ['library', 'radio', 'playlist', 'genre', 'settings', 'cloud', 'search',
    'artist', 'album', 'composer', 'track', 'play', 'queue', 'shuffle', 'tag', 'explore']) {
    assert.ok(hasGlyph(name), name + ' has line-work');
  }
});

/**
 * ⚖️ THE DOTS ARE THE VOLUME; THE RING IS THE POSITION (Peter, 09-03). The
 * bezel's detent dots light to the level, from twelve o'clock; the glass keeps
 * one ring, progress, in the accent at its rim. Both start at twelve.
 */
test('the bezel dots read the volume; the glass ring is progress alone', () => {
  // ⚖️ A SCALE, 0 TO 100 ROUND THE DIAL: a hundred radial ticks from twelve
  // o'clock, every tenth longer; a tap lands to one percent.
  assert.match(JS, /var SCALE = 100;/);
  assert.match(JS, /var tickAngle = \(\(tick \/ SCALE\) \* 360 - 90\) \* Math\.PI \/ 180;/, 'ticks from twelve o\'clock');
  assert.match(JS, /createElementNS\(SVG_NS, 'line'\)/, 'radials, not dots');
  assert.match(JS, /function lightDetents\(fraction, label, ceiling\)[\s\S]{0,700}\(i < lit \? ' is-lit' : ''\)/);
  assert.match(JS, /var DETENT_DEG = 12;/, 'the DRAG keeps the board\'s own detent, which the gate was budgeted for');
  assert.match(JS, /lightDetents\(\(shown - bounds\.min\) \/ span, String\(Math\.round\(shown\)\), \(bounds\.ceiling - bounds\.min\) \/ span\)/);
  assert.match(JS, /var progHalo = arcOf\('prog-halo', PROG_R, PROG_C\);\s*var progArc = arcOf\('prog-arc', PROG_R, PROG_C\)/,
    'a hairline halo under the arc: legibility from the halo, colour from the sleeve');
  assert.match(CSS, /\.prog-halo \{ fill: none; stroke: rgba\(0, 0, 0, \.40\); stroke-width: 4\.2;/);
  assert.doesNotMatch(JS, /vol-arc|VOL_R|ring-gutter|vol-track/, 'nothing but progress is drawn on the glass');
  // ⚖️ THE LEVEL IS ON THE WHEEL, ALWAYS (Peter, 09-03: "bold the ticks up to
  // the level") — lit in the accent and thicker, in every state.
  assert.match(CSS, /^\.tick\.is-lit \{ stroke: var\(--accent\); stroke-opacity: 1; stroke-width: 1\.25; \}/m,
    'lit and bold, at rest as much as in control');
  assert.doesNotMatch(CSS, /\[data-chrome="1"\] \.tick\.is-lit/, 'no state gate on the level');
  assert.match(CSS, /\.rig\[data-muted="1"\] \.tick\.is-lit \{ stroke-opacity: \.38; \}/, 'muted dims the lit run rather than emptying it');
  // In browse the circles are the menu and the seek wheel goes; the cascade stays.
  assert.match(CSS, /\.puck\[data-browse\] \.ring \{ display: none; \}/);
  assert.doesNotMatch(BROWSE, /crumbs/, 'no circle of any kind in browse: the breadcrumb arcs read as a progress circle (Peter, 09-03)');
  assert.doesNotMatch(CSS, /\.crumb/);
  assert.match(CSS, /\.prog-arc \{[\s\S]{0,160}stroke: var\(--accent\)/);
});

/**
 * ⚖️ Progress is Roon's own reported second, VERBATIM (Peter, 08-28). The store
 * holds that rule; a browser clock on top of it made the dial wobble whenever the
 * two clocks slipped phase.
 */
test('progress comes from the store and never from a browser clock', () => {
  assert.match(JS, /var position = store\.positionSec\(zone\)/);
  assert.doesNotMatch(JS, /setInterval/, 'no local ticker may run the ring');
  // ⚖️ THE RING IS THE CLOCK (Peter, 09-03): no remaining time, no ends-at.
  assert.doesNotMatch(JS, /endsAt|'times'|ENDS /);
  assert.doesNotMatch(CSS, /\.times/);
});

/**
 * ⚖️ VOLUME ACTS ON ONE OUTPUT, transport on the zone. A hand device in the
 * study must never turn up a whole grouped house.
 */
test('volume acts on the bound output and transport on the zone', () => {
  assert.match(JS, /command\(\{ action: 'volume', output: output\.id, steps:/);
  assert.match(JS, /command\(\{ action: action, zone: zone\.id \}\)/);
  assert.match(JS, /var boundOutputId = root\.getAttribute\('data-output'\)/);
  assert.match(JS, /function currentOutput\(\)[\s\S]{0,400}return zone\.outputs\[0\]/,
    'with no binding the group head is the room whose queue is playing');
});

/**
 * ⚠️⚠️ 09-03, 22:14 — A RUNAWAY: 119 volume commands reached Study ROON in three
 * bursts, +104 steps net, at up to six a second. Everything between the hand
 * and the wire now lives in volume-gate.js, where test/volume-gate.test.ts
 * replays the flood and gets twelve. This holds the face to USING it.
 */
test('every path to a volume request goes through the gate', () => {
  assert.match(JS, /import \{ createVolumeGate, levelAtAngle, levelForDrag \} from '\.\/volume-gate\.js';/);
  assert.match(JS, /var volumeGate = createVolumeGate\(function \(steps\) \{[\s\S]{0,900}command\(\{ action: 'volume', output: output\.id, steps: steps \}\)/,
    'the gate is the only thing that ever sends a volume step');
  // Exactly two places send a volume request: the gate's stepped batches, and a
  // TAP on a bezel dot — one press, one absolute level, which cannot repeat
  // itself and is throttled and wake-gated like every other touch.
  assert.equal((JS.match(/action: 'volume'/g) ?? []).length, 3, 'the gate, the dot tap, and the dial\'s drag (absolute, throttled) — nothing else');
  assert.match(JS, /function tapBezel\(degrees\)[\s\S]{0,400}wake\(\);   \/\/ raise the readout; a dot has a place/,
    'a tap on a dot acts on the first touch');
  assert.match(JS, /if \(now - lastBezelTap < 300\) return;/, 'and never faster than one every 300 ms');
  assert.match(JS, /var value = levelAtAngle\(degrees, bounds\.min, bounds\.max, ticks\.length\);[\s\S]{0,200}command\(\{ action: 'volume', output: output\.id, value: value \}\)/,
    'the dot under the finger, on the device\'s own range, as one absolute value');
  assert.match(JS, /var verdict = volumeGate\.step\(step\);/);
  // A wheel event is DISTANCE: the gate turns it into detents, and a page that
  // is asleep is only woken by the first of them.
  assert.match(JS, /volumeGate\.scroll\(delta, function \(dir\)/);
  assert.match(JS, /if \(event\.deltaMode === 1\) delta \*= 33;/);
  assert.match(JS, /volumeGate\.scroll\(delta, function \(dir\) \{[\s\S]{0,700}if \(wake\(\)\) \{ showTurning\(\); return; \}/,
    'a SCROLL that lands on an idle page only wakes it — the one input with no place');
  assert.match(JS, /function turn\(step\)[\s\S]{0,300}wake\(\);   \/\/ the bezel has a place/,
    'the bezel itself never waits');
  // The reading under the hand is Roon's number plus a BOUNDED remainder.
  assert.match(JS, /volume\.value \+ volumeGate\.ahead\(\) \* bounds\.step/);
  assert.match(JS, /confirmedVolume\.value !== volume\.value[\s\S]{0,60}volumeGate\.confirm\(\)/);
  assert.doesNotMatch(JS, /volPending|flushVolume|volLocal/, 'the old accumulator is gone, not bypassed');
  assert.match(JS, /var DETENT_DEG = 12;/, 'the drawn bezel still turns in detents');
});

/**
 * ⚖️ ONE RING AT REST (Peter, 09-03: "too many rings"). Progress holds the rim;
 * the volume arc appears inside it only while the controls are up, beside a
 * number and a control you can see.
 */
test('one ring on the glass, and no volume control drawn on it at all', () => {
  assert.match(JS, /var PROG_R = 42;/, 'the position ring sits inside the wheel band, clear of the dots');
  // A circle cut from WITHIN the sleeve: drawn past the glass so no edge of the
  // square can reach the rim, and cropped rather than stretched or boxed.
  assert.match(CSS, /\.cover img \{[\s\S]{0,200}width: 118%; height: 118%;\s*margin-left: -9%; margin-top: -9%;/);
  assert.match(CSS, /\.cover img \{[\s\S]{0,200}object-fit: cover/);
  // The wheel and its dots ARE the volume (Peter, 09-03): nothing on the glass.
  assert.doesNotMatch(JS, /vol-pill|volMinus|volPlus|volMute|vol-num/);
  assert.doesNotMatch(CSS, /vol-pill|vol-num|vol-step/);
});

/**
 * ⚖️ THE FIRST TOUCH SUMMONS; THE SECOND ACTS. A puck lives where a hand brushes
 * past it, so a brush may raise the controls and must never pause the room.
 */
test('only the centre summons first; the ring seeks on the first touch', () => {
  assert.match(JS, /if \(band\) \{ wake\(\); seekTo\(clientX, clientY\); return; \}\s*if \(wake\(\)\) return;/,
    'the ring has a place and acts at once; the centre, which pauses the room, summons first');
  assert.match(JS, /function wake\(\)[\s\S]{0,260}var first = !chromeUp;[\s\S]{0,240}return first;/);
  assert.match(CSS, /\.puck:not\(\[data-chrome="1"\]\) \.pad \{ display: none; \}/);
  assert.match(JS, /setTimeout\(sleep, CHROME_MS\)/, 'the cluster puts itself away again');
});

/**
 * The five controls Peter named, and no sixth. Shuffle and repeat are ZONE
 * settings read from the live snapshot, never from what this screen last drew.
 */
test('the menu and the cluster share one circle and one set of line-work', () => {
  assert.match(BROWSE, /import \{ glyph, iconNameFor \} from '\.\/puck-icons\.js';/);
  assert.match(JS, /import \{ glyph \} from '\.\/puck-icons\.js';/,
    'the transport cluster and the menu draw from the same set, not two copies of it');
  assert.match(BROWSE, /function token\(item, text\)[\s\S]{0,2200}node\.appendChild\(el\('span', 'tok-text', text\)\)/,
    'icon, then the row\'s own sleeve, then its initial');
  assert.match(CSS, /\.tok \{[\s\S]{0,300}border-radius: 50%/);
  assert.match(CSS, /\.opt-on \.tok \{[\s\S]{0,160}border-color: var\(--accent\)/,
    'the chosen circle is marked the way an engaged transport button is');
  assert.match(BROWSE, /var below = Math\.sin\(angle\) <= 1e-9;/,
    'a label hangs below on the top half and above on the bottom — with a tolerance, because sin(π) is +1e-16 and nine o\'clock must side with three');
});

/**
 * MUTE, on the cluster (Peter, 09-03: "volume change always shows muted"). Roon
 * was reporting the room muted; the readout now keeps the number and says
 * "muted" beneath it, and the speaker between repeat and shuffle flips it.
 */
test('mute is on the cluster, and the readout keeps the number when muted', () => {
  assert.match(JS, /var btnMute = button\('mute', 'btn-mute'\);/, 'a mute, not a volume: the crossed speaker in both states (Peter, 09-05)');
  assert.doesNotMatch(JS, /muteShows|replaceChildren\(glyph\(muteShows\)\)/, 'the glyph never changes; the disc\'s fill is the state');
  assert.match(JS, /if \(volume\.muted\) \{ btnMute\.setAttribute\('data-on', '1'\);/);
  assert.match(CSS, /\.btn-mute\[data-on="1"\] \{\s*background: rgba\(216, 162, 74, \.5\); border-color: rgba\(216, 162, 74, \.75\); color: #f2eee6;/, 'muted = a subtler wash of FlightDeck\'s gold, never the sleeve\'s accent (grey on a monochrome sleeve)');
  assert.ok(hasGlyph('mute'));
  assert.match(JS, /press\(btnMute,[\s\S]{0,200}action: 'mute', output: output\.id, muted: !output\.volume\.muted/);
  assert.match(JS, /volReadValue\.textContent = String\(Math\.round\(shown\)\);\s*volReadLabel\.textContent = \(volume\.muted \? 'muted \\u00b7 ' : \(over \? "above the limit set in Roon \\u00b7 " : \(atLimit \? "at Roon's limit \\u00b7 " : 'volume \\u00b7 '\)\)\) \+ output\.name;/);
  assert.match(CSS, /\.puck\[data-vol="none"\] \.btn-mute \{ display: none; \}/);
});

test('the cluster is repeat · previous · play/pause · next · shuffle', () => {
  for (const name of ['btn-repeat', 'btn-prev', 'btn-play', 'btn-next', 'btn-shuffle']) {
    assert.match(JS, new RegExp("'" + name + "'"), name + ' is part of the cluster');
    assert.match(CSS, new RegExp('\\.' + name + '\\b'), name + ' is placed');
  }
  assert.match(JS, /command\(\{ action: 'shuffle', zone: zone\.id \}\)/);
  assert.match(JS, /command\(\{ action: 'repeat', zone: zone\.id \}\)/);
  assert.match(JS, /var settings = zone === null \? null : zone\.settings/);
});

/**
 * ⚖️ THE OVERLAY CONDENSES THE WORDS RATHER THAN SITTING ON THEM. A circle has
 * one middle, and the cluster and three lines of credit cannot both have it.
 */
test('the words are title, artist and album, and the overlay keeps all three', () => {
  assert.match(JS, /title\.textContent = np\.title;\s*artist\.textContent = np\.line2;\s*album\.textContent = np\.line3;/);
  assert.doesNotMatch(CSS, /\.puck\[data-chrome="1"\] \.artist,\s*\.puck\[data-chrome="1"\] \.album \{ display: none; \}/,
    'the overlay makes room for the credit; it no longer takes two lines of it away');
  assert.match(CSS, /\.puck\[data-chrome="1"\] \.title \{[\s\S]{0,160}white-space: nowrap;/, 'the title folds to one line instead');
});

/**
 * ⚖️ THE WORDS ARE THE WAY IN (Peter, 09-03) — what is playing and what could be
 * playing are the same question asked twice.
 */
test('the credit at the foot opens browse on ONE tap, as does a downward swipe', () => {
  // Not through press(): that gate makes the first touch summon, and a tap on the
  // title is the most deliberate thing on the face.
  assert.match(JS, /words\.addEventListener\('click', function \(event\) \{\s*event\.stopPropagation\(\);\s*haptic\(10\);\s*browse\.open\('browse'\);/);
  assert.doesNotMatch(JS, /press\(words/);
  assert.match(JS, /words\.addEventListener\('pointerup', function \(event\) \{ event\.stopPropagation\(\); \}\);/,
    'and the tap must not ALSO reach the glass as a centre tap');
  assert.match(JS, /axis\(dy > 0 \? 1 : -1\);/);
  assert.equal(nextStop('play', 1), 'browse', 'a downward swipe from the music is still the library (Peter, 09-04: the axis)');
});

/**
 * ⚖️ ONE AXIS WITH THREE STOPS (09-02): ↑ always climbs and ↓ always descends,
 * at every depth, so a repeated ↑ walks home from anywhere. This retired the
 * earlier conflict where ↓ meant both "back a level" and "leave browse".
 */
/**
 * ⚖️ THE RING IS EARNED. It is drawn only after the order is seen, and the
 * bisection behind it is sound only for that reason — on an unordered level it
 * returns nonsense confidently, which is exactly what it did to Genres.
 */
test('the ring is drawn on evidence, and a stop that leads nowhere says so', () => {
  assert.match(BROWSE, /if \(wanted !== 'alpha'\) return null;[\s\S]{0,200}return ringFor\(/,
    'only a level past the load cap is sampled at all');
  assert.match(BROWSE, /if \(!isAlphabetical\(seen\)\) return null;/,
    'not in order means no ring — the column needs no order');
  assert.match(BROWSE, /return \(letterOf\(seen\[0\]\.title\) === '#' \? \['#'\] : \[\]\)\.concat\(ALPHABET\)/,
    'the # stop appears only when the library has titles that sort ahead of A');
  assert.match(BROWSE, /var seen = \[\{ title: first\[0\]\.title \}\];/,
    'the sampled TITLES are kept: bucketing them first and bucketing again folds ~ back to #');
  assert.match(BROWSE, /if \(view\.tier === 'alpha'\) \{ jump\(view\.letters\[view\.sel\]\); return; \}/,
    'the ring commits its OWN stop — a bare ALPHABET index is off by one once # is prepended');
  assert.match(BROWSE, /letterOf\(landed\) !== letter[\s\S]{0,220}flash\('nothing under ' \+ letter\)/,
    'the bisection lands at or AFTER the letter, so the row found must be under it');
  assert.match(BROWSE, /view\.tier = 'alpha';\s*view\.letters = letters;/);
  // The middle band is a spin, and needs neither an index nor a second request.
  assert.match(BROWSE, /var take = wanted === 'radial' \? RADIAL_MAX : \(wanted === 'linear' \? WHOLE_MAX : PAGE\)/);
});

test('the axis is the same at every depth, and its own session key', () => {
  assert.match(BROWSE, /function back\(\)[\s\S]{0,1800}if \(view\.parent !== undefined && view\.parent !== null\) \{[\s\S]{0,900}\n    if \(view\.queue \|\| view\.rooms\) park\(\); else close\(\);\n  \}/,
    'up restores the parent view; with no parent it walks out (the queue, without forgetting a parked library)');
  assert.match(BROWSE, /popLevels: 1/);
  assert.match(BROWSE, /var session = 'puck-'/,
    'Roon keeps one stack per multi_session_key; a shared key drags every other screen');
  // ⚖️ UP CLIMBS ONE LEVEL, TO THE VIEW AS IT WAS: each view keeps the one it
  // came from, and Roon's stack is popped only for a Roon level — a letter's
  // page is not one.
  assert.match(BROWSE, /if \(current\(mine\)\) \{ view\.parent = from; view\.roonLevel = true; \}/);
  assert.match(BROWSE, /if \(view\.roonLevel !== true\) \{ view = parent; tick\(\); draw\(\); return; \}/);
  assert.match(BROWSE, /letters: alpha\.letters, parent: alpha, roonLevel: false,/, 'a letter\'s page: parent is the alphabet, no pop');
  assert.doesNotMatch(BROWSE, /view\.alpha\b/);
});

/** The ring band is the seek control, and it never names the terminal second. */
test('a tap on the ring seeks, through the one-intent gate', () => {
  assert.match(JS, /var seconds = seekTargetSecond\(fraction, length\)/);
  assert.match(JS, /seekIntent\.seek\(\{ zone: zone\.id, seconds: seconds \}\)/);
  assert.match(JS, /if \(!zone\.allowed\.seek\) \{ flash\('seeking is not available here'\); return; \}/);
  assert.match(JS, /radiusOf\(metrics, clientX, clientY\) >= SEEK_BAND/);
  // ⚖️ OUTER = VOLUME, INNER = POSITION, in the hand: the glass's outer edge is
  // handed to the wheel before the face ever sees it, so a finger on the dots
  // can never be read as a seek.
  assert.match(JS, /var SEEK_BAND = 29;\s*var WHEEL_BAND = 45;/);
  assert.match(JS, /glass\.addEventListener\('pointerdown',[\s\S]{0,420}if \(radiusOf\(glassMetrics\(\), event\.clientX, event\.clientY\) >= WHEEL_BAND\) \{\s*beginTurn\(event\);\s*return;/,
    'the edge is the wheel in every state — in browse a turn carries the highlight');
  assert.doesNotMatch(JS, /!browse\.isOpen\(\) && radiusOf/);
});

/**
 * ⚠️ THE BINDING. A puck belongs to the SPEAKER in the room: an output id
 * survives the grouping that disposes of a zone id, and the name is the last
 * resort because a zone id does not survive every Core change either.
 */
test('the puck binds to a durable output, and the page carries it', async (t) => {
  const hub = new EventHub();
  const relay = new ArtRelay({ artworkUrl: () => '' });
  const ledger = new RecentLedger(null);
  const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: '', docDir: '', commands: null, browseAccess: null,
    mdns: () => null, urls: () => [], port: () => 0,
  });
  await listenWithLadder(server, [0], () => {});
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  t.after(() => server.close());
  hub.publish(buildSnapshot(
    {
      generation: 'test', zones: ZONES, coreName: 'ROCK', corePaired: true,
      coreSinceAt: new Date().toISOString(), revision: 1, at: new Date().toISOString(),
    },
    relay, ledger));

  const html = await (await fetch('http://127.0.0.1:' + String(port) + '/puck/garden')).text();
  assert.match(html, /data-output="1703a"/, 'the speaker, not the zone, is what the puck holds');
  assert.match(html, /data-zone="1603ghi"/, 'the zone is still resolved for transport');
  assert.match(html, /data-zone-slug="garden"/, 'and the name survives a Core that renumbers');
  assert.match(JS, /if \(wantedSlug !== ''\)/, 'the client re-finds its room by name');
});

/**
 * ⚖️ THE ALPHABET IS THE KEYBOARD (Peter, 09-03: "use an alphabet selector from
 * the puck"). A Search row opens the same ring of letters that jumps into a big
 * list, plus space, delete and search; the middle reads the query; ⏎ asks
 * Roon's Search hierarchy exactly as the Face does; ↑ walks back to the query
 * and then to the row it came from.
 */
test('Search is spelt on the ring, and asks Roon the way the Face does', () => {
  // ⚖️ A CLEAR SET OF KEYS: enter, space, delete and clear are BUTTONS under
  // the query; the ring keeps only the letters.
  assert.match(BROWSE, /var keys = el\('div', 'spell-keys'\);/);
  assert.match(BROWSE, /keys\.appendChild\(key\('\\u21b5', 'search'/);
  assert.match(BROWSE, /keys\.appendChild\(key\('\\u232b', 'delete the last letter'/);
  assert.match(BROWSE, /keys\.appendChild\(key\('\\u2715', 'clear'/);
  assert.match(BROWSE, /letters: ALPHABET, probes: \{\},[\s\S]{0,320}spell: \{/, 'the ring is letters only');
  assert.match(CSS, /\.spell-keys \{ pointer-events: none; \}\s*\.spell-keys \.key \{ pointer-events: auto; \}/, 'the keys row must not take the touch meant for the letters beside it (measured: R at half past seven)');
  assert.doesNotMatch(BROWSE, /var SPELL = /);
  assert.match(CSS, /\.puck:not\(\[data-spell="1"\]\) \.spell-keys \{ display: none; \}/);
  assert.match(BROWSE, /if \(item\.input !== null && item\.input !== undefined\) \{ spell\(item\); return; \}/,
    'an input row opens the speller rather than refusing');
  assert.doesNotMatch(BROWSE, /needs a keyboard/);
  assert.match(BROWSE, /ask\(\{ hierarchy: 'search', popAll: true, input: query \}\)/, 'the same call face.js makes');
  assert.match(BROWSE, /if \(view\.spell\) \{ view = view\.spell\.parent; tick\(\); draw\(\); return; \}/, '↑ from the speller is the row it came from');
  assert.match(BROWSE, /view\.depth === spellReturn\.depth[\s\S]{0,120}view = spellReturn\.speller;/, '↑ from the first results is the query again');
});

/**
 * ⚖️ THE PUCK IS A NORMAL FACE OPTION (Peter, 09-03, twice) — offered in the
 * faces list, remembered per screen, and with a way back — but NOT drawn inside
 * face.css, whose `vw` rules are a television's. Choosing it goes to its page.
 */
test('the puck is offered beside the faces, remembered, and has a way back', () => {
  const FACE = asset('face.js');
  const PAGES = readFileSync(resolve(import.meta.dirname, '..', 'src', 'http', 'pages.ts'), 'utf8');
  assert.match(FACE, /faceRow\.appendChild\(puckOption\(\)\);/, 'offered in the faces list');
  assert.match(FACE, /if \(current === 'puck'\) \{ window\.location\.replace\(puckHref\(\)\); \}/,
    'a screen that remembers puck goes there on load — and touches nothing else');
  assert.match(FACE, /function leaveForPuck\(\) \{\s*try \{ localStorage\.setItem\(STORE_KEY_FACE_BEFORE \+ zoneId,/,
    'the face being left is kept ONLY when the puck is chosen from the list, never on the remembered redirect');
  assert.doesNotMatch(FACE, /var FACES = \[[^\]]*'puck'/, 'never a face LAYOUT: face.css is a television\'s');
  assert.match(PAGES, /'aurora', 'puck'\] as const/, '?face=puck pins it like any face');
  assert.match(JS, /room\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); haptic\(10\); browse\.open\('rooms'\); \}\);/,
    'the room name goes home to the Wall, where every way of opening a room lives');
  assert.match(JS, /=== 'puck'\) \{\s*localStorage\.setItem\('flightdeck\.face\.' \+ wantedZoneId, before\);/,
    'and forgets puck as this screen\'s face on the way, restoring the one kept beside it');
});

/**
 * ⚖️ SUBTLE COLOUR AND CONTRAST FROM THE SLEEVE (Peter, 09-03). The ring takes
 * the sleeve's tone lifted against the band it is drawn over, the bezel is
 * tinted toward the sleeve's deep tone, and the scrim under the credit is as
 * strong as the sleeve's foot needs — read from the sleeve, never assumed, and
 * keyed to it so a late answer cannot paint the wrong track.
 */
test('the face takes its colour from the sleeve, measured, and keyed to it', () => {
  assert.match(JS, /import \{ readPalette, luminance \} from '\.\/sleeve-palette\.js';/);
  assert.match(JS, /readPalette\(art\.path, function \(tones\) \{\s*if \(coverKey !== art\.key\) return;/, 'keyed to the sleeve it was read from');
  assert.match(JS, /style\.setProperty\('--accent', tones === null \? DEFAULT_PAINT\.accent : tones\.ring\)/, 'the ring tone, chosen against the band it sits on');
  assert.match(JS, /root\.setAttribute\('data-foot', tones !== null && tones\.foot > 0\.35 \? 'bright' : 'dark'\)/);
  assert.match(CSS, /\.puck\[data-foot="bright"\] \.scrim-foot \{/, 'a bright foot gets a stronger floor');
  assert.match(JS, /paintFromSleeve\(null\)/, 'no sleeve, no borrowed colour: the defaults stand');
});

/**
 * ⚠️ THE OVERLAY IS NOT A LID (Peter, 09-03: "browse is never called"). The pad
 * and its veil spanned the glass above the words, so after any touch a tap on
 * the title landed on the veil — play/pause — and browse never opened. The
 * live check had clicked a sleeping face. Only the buttons take pointer events.
 */
test('the overlay lets a tap through to the title, the ring and the field', () => {
  assert.match(CSS, /\.pad \{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; \}/);
  assert.match(CSS, /\.pad-veil \{[\s\S]{0,200}pointer-events: none;/);
  assert.match(CSS, /\.btn \{\s*position: absolute;\s*pointer-events: auto;/);
  // The wheel follows the sleeve: the lit run wears the accent the ring wears.
  assert.match(CSS, /^\.tick\.is-lit \{ stroke: var\(--accent\);/m);
  assert.match(CSS, /\.tick\.major \{ stroke: var\(--accent\); stroke-opacity: \.34; \}/);
});

/**
 * ⚖️ ONE TAP ON A CIRCLE GOES (Peter, 09-03). Turn to highlight; the centre or
 * the highlighted circle commits; a finger on any circle means that circle.
 */
test('one tap on a circle selects it and goes; the centre commits the highlight', () => {
  assert.match(BROWSE, /if \(view\.sel !== index\) \{ view\.sel = index; draw\(\); \}\s*commit\(\);/);
  // and the tap must not ALSO reach the glass as a centre tap on the highlight
  assert.match(BROWSE, /function bindPick\(node, index\)[\s\S]{0,1200}node\.addEventListener\('pointerup', function \(event\) \{ event\.stopPropagation\(\); \}\);/);
  assert.match(JS, /if \(browse\.isOpen\(\)\) \{ if \(!band && browse\.at\(\) !== 'queue'\) browse\.commit\(\); return; \}/, 'a tap inside the ring band commits the highlight — in the library; in the queue only the hub plays');
});

/**
 * ⚖️ THE HIGHLIGHT WALKS THE RING; A FULL CIRCLE TURNS THE PAGE (Peter, 09-03:
 * "the menus become vertical, which will be hard on the puck … a turn of the
 * wheel advances around the selection, 360 brings up the next, or a click on a
 * next arrow in the centre — next/prev, select, up/back"). The middle tier is
 * pages of twelve circles that stay put; ‹ › flank the name, select sits
 * beneath it, and back is the level's own title.
 */
test('the middle tier is pages on the ring, with next, prev, select and back to hand', () => {
  assert.match(BROWSE, /function drawPaged\(\)[\s\S]{0,300}var first = Math\.floor\(view\.sel \/ SLOTS\) \* SLOTS;/);
  assert.doesNotMatch(BROWSE, /drawColumn|drawCarousel/);
  assert.doesNotMatch(CSS, /\[data-tier="linear"\] \.tok \{/, 'no column layout survives');
  assert.match(BROWSE, /if \(view\.sel \+ SLOTS < have \|\| have >= view\.total\) return;/, 'a whole page is kept in hand past the highlight');
  assert.match(BROWSE, /levelBack\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); back\(\); \}\);/);
  assert.match(BROWSE, /level\.addEventListener\('pointerup', function \(event\) \{ event\.stopPropagation\(\); \}\);/, 'and its tap stays on it');
  assert.match(CSS, /\.level-back \{[^\n]*color: var\(--accent\);/, 'the title reads "‹ GENRES" — the ‹ its own element since 09-05, the name beside it');
  assert.match(BROWSE, /var prevKey = key\('\\u2039', 'previous', function \(\) \{ move\(-1\); \}\);/);
  // ⚖️ THE NAME AND THE SELECT ARE ONE THING (Peter, 09-04): the centre circle is the select.
  assert.doesNotMatch(BROWSE, /selectKey|key-select/);
  assert.match(BROWSE, /chosen\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); commit\(\); \}\);/);
  assert.match(BROWSE, /chosen\.addEventListener\('pointerup', function \(event\) \{ event\.stopPropagation\(\); \}\);/, 'and its tap stays on it');
  assert.match(CSS, /\.puck\[data-browse\] \.chosen \{[\s\S]{0,400}border-radius: 50%;[\s\S]{0,120}border: 2px solid var\(--accent\);/, 'a larger, bolder circle');
  assert.doesNotMatch(BROWSE, /upKey\.appendChild\(glyph\('return'\)\)/, 'the return arrow left the disc (Peter, 09-04: ↑ ↓ are the axis now)');
  // the same arrow on the control screen goes home to the Wall
  // ⚖️ NOTHING ON THE PUCK GOES BACK TO THE WALL (Peter, 09-05): the return and the face options live OUTSIDE it
  assert.doesNotMatch(JS, /btnHome|glyph\('return'\)|btn-home/, 'no way back on the puck itself');
  assert.match(JS, /var outside = el\('div', 'outside'\);\s*var homeMark = el\('span', 'homemark'\);\s*homeMark\.appendChild\(glyph\('back'\)\);/, 'the Face\'s own mark, in the page\'s chrome');
  assert.match(JS, /var faceDoor = el\('span', 'cog', ON_PHONE \? 'remote' : 'faces'\);/, 'and its faces door');
  assert.match(JS, /root\.appendChild\(rig\);\s*root\.appendChild\(outside\);/, 'outside the rig, not on the glass');
  assert.match(JS, /root\.setAttribute\('data-outside', outsidePx >= 72 \? '1' : \(ON_PHONE && belowPx >= 48 \? '2' : '0'\)\);/,
    'only where the viewport is wider than the puck — or, on a phone held upright, taller than it');
  assert.match(JS, /faceDoor\.addEventListener\('click', function \(event\) \{\s*event\.stopPropagation\(\);\s*forgetPuckAsFace\(\);/, 'the Face must not turn straight round');
  assert.match(CSS, /\.puck\[data-outside="1"\] \.outside \{ display: -webkit-flex; display: flex; \}/);
  assert.doesNotMatch(CSS, /\.btn-home/);
  assert.ok(hasGlyph('back'));
  assert.match(JS, /roomName\.textContent = zone\.name;/);
  assert.match(JS, /function goHome\(\)[\s\S]{0,400}window\.location\.href = ON_PHONE \? '\/phone' : '\/';/);
  assert.match(JS, /flash\('wheel paused \\u2014 lift, then turn again'\)/, 'the guard says what it means');
  assert.ok(hasGlyph('return'));
  assert.match(CSS, /\.nav-keys \.key-up,[^\n]*\.key-up \{ left: 50%; top: calc\(var\(--u\) \* 39\); \}/);
  // swipes mean the same: ↑ is up, ← → are next and previous
  assert.match(JS, /if \(browse\.isOpen\(\)\) \{ browse\.move\(dx < 0 \? 1 : -1\); return true; \}/, 'a sideways swipe steps the highlight');
  assert.match(JS, /axis\(dy > 0 \? 1 : -1\);/, 'a vertical swipe walks the axis (Peter, 09-04)');
  assert.match(CSS, /\.puck:not\(\[data-browse\]\) \.nav-keys, \.puck\[data-spell="1"\] \.nav-keys \{ display: none; \}/);
});

/**
 * ⚖️ A PICTURE FOR EACH GENRE, CHOSEN WISELY (Peter, 09-03). Only on a genre
 * level, so an album called "Country Roads" never wears a hat; the more specific
 * word wins, so Latin Jazz is Latin and Folk/Rock is folk.
 */
test('genres get their own pictures, and only on a genre level', () => {
  assert.equal(genreIconFor('Latin'), 'maracas');
  assert.equal(genreIconFor('Latin Jazz / World'), 'maracas', 'the specific word wins');
  assert.equal(genreIconFor('Country'), 'hat');
  assert.equal(genreIconFor('Alternative Country'), 'hat');
  assert.equal(genreIconFor('Jazz'), 'trumpet');
  assert.equal(genreIconFor('Classical'), 'clef');
  assert.equal(genreIconFor('Blues'), 'harmonica');
  assert.equal(genreIconFor('Folk/Rock'), 'guitar');
  assert.equal(genreIconFor('Pop/Rock'), 'star', 'pop before rock on the biggest shelf');
  assert.equal(genreIconFor('Hip-Hop/Rap'), 'mic');
  assert.equal(genreIconFor('R&B/Soul'), 'heart');
  assert.equal(genreIconFor('Reggae'), 'globe');
  assert.equal(genreIconFor('Electronic'), 'wave');
  assert.equal(genreIconFor('Stage & Screen'), 'clapper');
  assert.equal(genreIconFor('Holiday'), 'snowflake');
  assert.equal(genreIconFor("Children's"), 'balloon');
  assert.equal(genreIconFor('Unclassifiable'), null, 'no picture beats a wrong one');
  // The level gate: the same word is a hat on a genre level and nothing elsewhere.
  assert.equal(iconNameFor('Country', 'list', true), 'hat');
  assert.equal(iconNameFor('Country Roads', 'list', false), null);
  assert.equal(iconNameFor('Artists', 'list', true), 'artist', 'Roon\'s nouns keep their own pictures on a genre level');
  assert.equal(iconNameFor('Play Genre', 'action_list', true), 'play');
  for (const name of ['maracas', 'hat', 'trumpet', 'clef', 'harmonica', 'guitar', 'mic', 'heart', 'globe', 'wave', 'clapper', 'bubble', 'star', 'snowflake', 'bell', 'balloon', 'leaf']) {
    assert.ok(hasGlyph(name), name + ' has line-work');
  }
  // Eight a page, each with its name beneath.
  assert.match(BROWSE, /var SLOTS = 7;/, 'seven a page: eight puts circles at three and nine, whose names land on their neighbours');
  assert.match(BROWSE, /function drawPaged\(\)[\s\S]{0,1800}var name = el\('div', 'opt-name', item === null \? '\\u2026' : nameOf\(item\)\);/);
});

/**
 * ⚖️ A TURN OR A TAP ON THE WHEEL SHOWS THE LEVEL IN THE CENTRE, THEN FADES
 * (Peter, 09-03). Raised by the same `data-turning` a turn or a tap holds for
 * a moment; it fades by itself and takes no touch.
 */
test('the level shows large in the centre on a turn or a tap, then fades', () => {
  assert.match(JS, /var volRead = el\('div', 'vol-read'\);/);
  assert.match(JS, /volReadValue\.textContent = String\(Math\.round\(shown\)\);/, 'the reading under the hand, bounded by the gate — the number even when muted');
  assert.match(JS, /function tapBezel\(degrees\)[\s\S]{0,700}showTurning\(\);/, 'a tap on the wheel raises it');
  assert.match(JS, /function turn\(step\)[\s\S]{0,400}showTurning\(\);/, 'so does a turn');
  assert.match(CSS, /\.vol-read \{[\s\S]{0,600}top: 50%;[\s\S]{0,500}opacity: 0;[\s\S]{0,120}pointer-events: none;[\s\S]{0,200}transition: opacity \.55s ease-out;/);
  assert.match(CSS, /\.puck\[data-turning="1"\] \.vol-read \{ opacity: 1;/);
  assert.match(CSS, /\.puck\[data-vol="none"\] \.vol-read \{ display: none; \}/, 'hidden only where there is no level to read — the cog is the volume in browse too');
});

/**
 * ⚖️ THE COG IS THE VOLUME, IN EVERY STATE (Peter, 09-04: "in browse mode let
 * the outer cog still adjust volume — so it always serves that function
 * alone"). The highlight moves by ‹ ›, swipes, taps and the outer letters; the
 * bezel, the glass's edge and the scroll wheel never touch it.
 */
test('in a menu the cog moves the highlight, on the music face it is the volume; the alphabet outside is reached by tap', () => {
  // ⚖️ Peter, 09-05: "use the outer cog to move rapidly through the 8 or so displayed" — supersedes 09-04's cog-is-always-volume
  assert.match(JS, /if \(browse\.isOpen\(\)\) \{\s*while \(Math\.abs\(turning\.carried\) >= DETENT_DEG\) \{[\s\S]{0,200}browse\.move\(step\);\s*\}\s*return;\s*\}\s*if \(turning\.moved >= DETENT_DEG \/ 2\) dragLevel\(now, false\);/, 'the bezel: highlight in a menu; on the music a drag is a dial');
  assert.match(JS, /if \(browse\.isOpen\(\)\) \{ browse\.move\(dir\); return; \}\s*if \(wake\(\)\) \{ showTurning\(\); return; \}/, 'the desk\'s scroll wheel, the same');
  assert.doesNotMatch(JS, /browse\.turn\(/, 'the face never asks the menu what a turn means');
  assert.doesNotMatch(BROWSE, /function turn\(|stepLetter/);
  assert.match(JS, /function tapBezel\(degrees\) \{\s*var output = currentOutput\(\);/, 'a tap on the wheel sets the level in browse too');
  assert.doesNotMatch(CSS, /\.puck\[data-browse\] \.vol-read/, 'the reading shows in browse as everywhere');
  assert.match(BROWSE, /function drawAlphabetOutside\(\)[\s\S]{0,400}'lt lt-on' : 'lt'/);
  assert.match(BROWSE, /node\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); jumpWithin\(letter\); \}\);/, 'a letter is a tap');
  assert.match(BROWSE, /var LETTER_R = 44;/, 'just inside the glass\'s edge');
  assert.match(BROWSE, /var LETTER_GAP = 44 \* Math\.PI \/ 180;/, 'a gap at twelve for the title');
  assert.match(BROWSE, /var from = Math\.floor\(offset \/ SLOTS\) \* SLOTS;/, 'a jump loads from the page\'s own start');
  assert.match(CSS, /\.puck\[data-lettered="1"\] \.count \{ bottom: calc\(var\(--u\) \* 14\);/);
  assert.match(CSS, /\.nav-keys \.key-up, \.puck\[data-browse\]\[data-lettered="1"\] \.nav-keys \.key-up \{ left: 50%; top: calc\(var\(--u\) \* 39\); \}/);
  assert.match(BROWSE, /function fillBack\(\)[\s\S]{0,500}page\.items = items\.concat\(page\.items\);/);
});

/**
 * ⚖️ THE TIMES ARE ON THE DIAL, THE ROOM INSIDE THE RING, THE WHEEL SAYS ITS
 * NUMBER (Peter, 09-04). Elapsed / length rides the bead as a small tag; the
 * room name drops inside the ring, off the arc's start; the level is written at
 * the end of the lit run on the bezel.
 */
test('the times ride the bead, the room name sits inside the ring, the wheel says its number', () => {
  assert.match(JS, /var progRead = el\('div', 'prog-read'\);/);
  // ⚖️ 09-05: the elapsed time IS the bead — a circle in the arc's tone at the arc's end — and the length sits above the room name
  assert.match(JS, /progRead\.textContent = formatTime\(positionSec\);\s*progLength\.textContent = formatTime\(lengthSec\);/);
  assert.match(JS, /var tagAngle = angle;\s*progRead\.style\.left/, 'always exactly at the arc\'s end: stepping aside made "two different places" (Peter, 09-05)');
  assert.match(JS, /progLength\.style\.display = clamped < 0\.03 \|\| clamped > 0\.97 \? 'none' : 'block';/, 'the length yields its spot at twelve to the bead');
  assert.match(CSS, /\.puck\[data-browse\] \.prog-length \{ display: none !important; \}/, 'the length shows in control too, now that the mute holds six');
  assert.match(CSS, /\.prog-length \{[\s\S]{0,400}text-shadow: 0 0 calc\(var\(--u\) \* 1\.4\) rgba\(6, 7, 10, \.95\)/, 'bone with a soft dark glow: no pill, no bullet');
  assert.doesNotMatch(CSS, /\.prog-length \{[\s\S]{0,400}background: rgba/, 'no bullet behind the length');
  assert.match(JS, /progBead\.style\.display = 'none';   \/\/ the circle IS the bead/);
  assert.match(CSS, /\.room-name \{[\s\S]{0,200}background: rgba\(6, 7, 10, \.52\);/, 'the room name in a translucent pill, clearly over the art');
  assert.match(JS, /style\.setProperty\('--on-accent', onTone\(/, 'the number reads on the tone: ink on a light one, bone on a deep one');
  assert.match(CSS, /\.prog-read \{[\s\S]{0,300}border-radius: 50%;\s*background: var\(--accent\);/, 'a circle in the arc\'s own tone, not a white-on-black pill');
  assert.match(CSS, /\.prog-length \{[\s\S]{0,160}top: calc\(var\(--u\) \* 2\.8\);/, 'the length exactly over the top of the arc, at twelve');
  assert.match(JS, /var READ_R = 42;/, 'on the arc, inside the glass at three and nine');
  assert.match(JS, /setProgress\(position \/ length, position, length\);/);
  assert.match(CSS, /\.prog-read \{[\s\S]{0,700}white-space: nowrap;[\s\S]{0,200}pointer-events: none;/);
  assert.match(CSS, /\.room \{[\s\S]{0,340}top: calc\(var\(--u\) \* 14\.2\);/, 'off the arc at twelve; at 14.2 the elapsed circle at twelve clears it');
  assert.match(JS, /var tickRead = document\.createElementNS\(SVG_NS, 'text'\);/);
  assert.match(JS, /lightDetents\(\(shown - bounds\.min\) \/ span, String\(Math\.round\(shown\)\), \(bounds\.ceiling - bounds\.min\) \/ span\);/);
  assert.match(JS, /var TICK_READ_R = 44\.6;/);
  assert.match(CSS, /\.tick-read \{ fill: var\(--accent\);/);
});

/**
 * ⚖️ A PLAYLIST'S CIRCLE IS A COLLAGE OF ITS COVERS (Peter, 09-04), built in a
 * browse session of its own, remembered by title, and swapped in only if the
 * circle is still on the face.
 */
test('a playlist circle asks for a collage and the initial stands in meanwhile', () => {
  assert.match(BROWSE, /import \{ createCollages \} from '\.\/collage\.js';/);
  assert.match(BROWSE, /var collages = createCollages\(ask, \{ size: 96, want: 4 \}\);/);
  assert.match(BROWSE, /function ask\(body, sessionKey\) \{\s*body\.sessionKey = sessionKey \|\| session;/, 'the builder may use its own stack');
  assert.match(BROWSE, /var playlist = item !== null && !item\.art && onPlaylistsLevel\(\) && item\.hint !== 'action'/, 'only a playlist row, never an action');
  assert.match(BROWSE, /var name = item === null \|\| playlist \|\| view\.plain === true \? null : iconNameFor\(/, 'the collage comes before the shelf icons: "dCS Favourites" is a playlist, not a shelf');
  assert.match(BROWSE, /collages\.request\('playlists', item\.title,/, "always Roon's own playlists hierarchy: via Explore the level is in `browse`, whose root has no playlists");
  assert.match(BROWSE, /var RADIAL_MAX = 7;/, 'more than seven are pages, named');
  assert.match(BROWSE, /if \(url === null \|\| node\.parentNode === null\) return;/, 'a late collage for a circle no longer on the face is dropped');
});

/**
 * ⚖️ ONE AXIS, THREE FACES — A WHEEL (Peter, 09-04: "an up and a down arrow on
 * that centre circle that indicates a swipe up or down — and those navigate
 * between control, browse and queue"). ↓ from the music is the library, then
 * the queue, then the music again; ↑ runs the other way. Both arrows always
 * lead somewhere, and climbing a level is the title's job, not the axis's.
 */
test('the axis is a wheel of three faces: every face is one swipe from every other', () => {
  assert.deepEqual(STOPS, ['play', 'browse', 'queue']);
  assert.equal(nextStop('play', 1), 'browse', '↓ from the music is the library');
  assert.equal(nextStop('browse', 1), 'queue', '↓ again is the queue');
  assert.equal(nextStop('queue', 1), 'play', '↓ again is the music: a wheel, not a ladder');
  assert.equal(nextStop('play', -1), 'queue', '↑ from the music is the queue');
  assert.equal(nextStop('queue', -1), 'browse');
  assert.equal(nextStop('browse', -1), 'play');
  assert.equal(nextStop('elsewhere', 1), 'browse', 'an unknown place counts as the music');
  // the disc wears ↑ and ↓, and they ARE the axis — not the level
  assert.match(BROWSE, /var upKey = key\('', 'swipe up: the face above', function \(\) \{ onAxis\(-1\); \}\);/);
  assert.match(BROWSE, /var downKey = key\('', 'swipe down: the face below', function \(\) \{ onAxis\(1\); \}\);/);
  assert.match(BROWSE, /upKey\.appendChild\(glyph\('up'\)\);[^\n]*\n\s*downKey\.appendChild\(glyph\('down'\)\);/, 'the same line-work on both faces');
  assert.ok(hasGlyph('up') && hasGlyph('down'));
  // the same idiom on the music face: ↑ above play, ↓ below the shoulder row, tap to rotate
  assert.match(JS, /var btnUp = button\('up', 'btn-up'\);\s*var btnDown = button\('down', 'btn-down'\);/);
  assert.match(JS, /press\(btnUp, function \(\) \{ axis\(-1\); \}\);\s*press\(btnDown, function \(\) \{ axis\(1\); \}\);/);
  assert.match(CSS, /\.btn-up \{ top: calc\(var\(--u\) \* 24\); \}\s*\.btn-down \{ top: calc\(var\(--u\) \* 56\); \}/, '↓ in the shoulder row\'s centre: below it is the credit, which the overlay keeps whole');
  assert.match(CSS, /\.btn-mute \{\s*left: 50%; top: calc\(var\(--u\) \* 95\.6\);\s*width: calc\(var\(--u\) \* 5\.6\);/, 'mute at the bottom, between the two rings, opposite the length (Peter, 09-05)');
  assert.doesNotMatch(JS, /tagAngle \+= /, 'the circle never steps aside: it IS the bead');
  assert.doesNotMatch(CSS, /\.puck\[data-chrome="1"\] \.artist[^\n]*display: none/, 'the overlay never hides a credit line (Peter, 09-03)');
  assert.match(BROWSE, /downKey\.className = 'key key-down';/);
  assert.match(CSS, /\.nav-keys \.key-down, \.puck\[data-browse\]\[data-lettered="1"\] \.nav-keys \.key-down \{ left: 50%; top: calc\(var\(--u\) \* 61\); \}/, '↓ at six, just inside the rim: on the rim at 65 it crossed the 5 and 7 o\'clock names by two pixels (measured)');
  assert.match(CSS, /\.puck\[data-browse\] \.chosen-title \{[^\n]*\n[^\n]*\n  max-height: calc\(var\(--u\) \* 9\.5\);/, 'the name keeps to two lines between ↑ and ↓');
  // a swipe is judged where it started: the glass captures the pointer, so a lift over the disc or the credit is not lost
  assert.match(JS, /document\.addEventListener\('pointerup', lift, true\);/, 'heard at the document in the capture phase, before a control can stop it');
  assert.match(JS, /function lift\(event\) \{\s*if \(touch === null\) return;/);
  assert.doesNotMatch(JS, /setPointerCapture\(event\.pointerId\)[\s\S]{0,60}\n\}\);\n\nfunction lift/, 'the capture that Chrome took without honouring is gone');
  // the seven slots stay put whatever a page holds: a last page of four never puts a circle at six o'clock
  assert.match(BROWSE, /function drawPaged\(\)[\s\S]{0,1200}var angle = \(k \/ SLOTS\) \* 2 \* Math\.PI - Math\.PI \/ 2;/);
  assert.match(BROWSE, /var size = lettered \? 12 : tokenSize\(SLOTS\);/);
  // a swipe and the arrow keys walk the wheel; the title (and Backspace) climb a level
  assert.match(JS, /function axis\(dir\) \{\s*var next = nextStop\(browse\.at\(\), dir\);/);
  assert.match(JS, /if \(next === 'play'\) \{ browse\.park\(\); wake\(\); \}\s*else \{ wake\(\); browse\.open\(next\); \}/, 'the library is parked, not closed, when the axis leaves it; the cluster comes up with the music');
  assert.match(JS, /if \(key === 'ArrowDown'\) \{\s*axis\(1\);\s*\} else if \(key === 'ArrowUp'\) \{\s*axis\(-1\);/);
  assert.match(JS, /key === 'Backspace'\) \{\s*if \(open\) browse\.back\(\);/);
  assert.match(BROWSE, /levelBack\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); back\(\); \}\);/, 'the ‹ on the title is still the way back a level');
  // the library keeps its place across the axis
  assert.match(BROWSE, /if \(hierarchy === 'browse' && parked !== null\) \{[\s\S]{0,400}view = parked\.view;/);
  assert.match(BROWSE, /function park\(\) \{\s*if \(view !== null && !view\.queue && !view\.rooms\) parked = \{ view: view, spellReturn: spellReturn \};\s*leave\(\);/);
  assert.match(BROWSE, /function close\(\) \{\s*parked = null;\s*leave\(\);/, 'closing forgets; only the axis parks');
  assert.match(BROWSE, /if \(view\.queue \|\| view\.rooms\) park\(\); else close\(\);/, "the queue's title leaves the queue without forgetting the parked library");
});

/**
 * ⚖️ THE QUEUE IS A LEVEL OF THIS FACE (Peter, 09-04: "an option to expose and
 * select from the queue"). Roon's forward window, drawn as pages of seven like
 * every other list, each circle the track's own sleeve; a tap on a row plays
 * from there through the deck's own queue route, fenced by generation and
 * revision. Row zero is what is playing and cannot be "played from".
 */
test('the queue reads as a level: sleeves ring the face, the playing row is marked, a row plays from there', () => {
  const rows = queueRows({ items: [
    { id: '557527', title: 'Burn', artist: 'Norah Jones', album: 'Day Breaks', lengthSec: 279, art: '/api/v1/art/x' },
    { id: 557528, title: 'Tragedy', artist: 'Norah Jones', album: '', lengthSec: 200, art: null },
    { id: '557529', title: '', artist: '', album: '', lengthSec: null, art: null },
  ] });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { title: 'Tragedy', subtitle: 'Norah Jones', art: null, hint: 'queue', queueId: '557528', now: false }, 'ids are strings on the wire, whatever Roon sent');
  assert.equal(rows[2].title, '(untitled)');
  assert.equal(rows[2].subtitle, '');
  assert.deepEqual(queueRows({}), []);
  assert.deepEqual(queueRows(null), []);
  // read from the deck's queue mirror, waiting in place while it fills
  assert.match(BROWSE, /fetch\('\/api\/v1\/queue\?zone=' \+ encodeURIComponent\(zone\), \{ cache: 'no-store' \}\)/);
  assert.match(BROWSE, /if \(data\.ready !== true && attempt < 8\)/, 'the mirror may honestly still be loading');
  assert.match(BROWSE, /if \(hierarchy === 'queue'\) \{ if \(view !== null && view\.queue\) return; park\(\); openQueue\(\); return; \}/);
  assert.match(BROWSE, /function queueSub\(pick\) \{\s*var where = pick\.now === true \? 'now' : String\(view\.sel \+ 1\) \+ ' \/ ' \+ String\(view\.total\);/, 'the hub says where in the queue this is');
  assert.match(BROWSE, /var chosenPlay = el\('div', 'chosen-play'\);\s*chosenPlay\.appendChild\(glyph\('play'\)\);/, 'the hub wears ▶');
  assert.match(JS, /if \(browse\.isOpen\(\)\) \{ if \(!band && browse\.at\(\) !== 'queue'\) browse\.commit\(\); return; \}/, 'in the queue a stray tap on the glass never plays: only the hub does');
  assert.match(BROWSE, /sel: rows\.length > 1 \? 1 : 0/, 'the highlight opens on the first row still to come');
  // a row plays from there, fenced; the playing row is refused before the wire
  assert.match(BROWSE, /if \(view\.queue\) \{ playFrom\(item\); return; \}/);
  assert.match(BROWSE, /function playFrom\(item\) \{\s*if \(item\.now\) \{ flash\('already playing'\); return; \}/);
  assert.match(BROWSE, /body: JSON\.stringify\(\{ zone: fence\.zone, itemId: item\.queueId, generation: fence\.generation, queueRevision: fence\.revision \}\),/);
  assert.match(BROWSE, /if \(response\.ok\) \{ flash\('playing ' \+ item\.title\); close\(\); return; \}/, 'and the face returns to the music');
  assert.match(BROWSE, /if \(data\.code === 'stale' \|\| data\.code === 'current'\) \{[^\n]*reloadQueue\(\); return; \}/, 'a queue that moved is read again, never guessed at');
  // the playing row is marked on the ring; tracks never wear shelf icons
  assert.match(BROWSE, /function nameOf\(item\) \{\s*return item === null \? '' : \(item\.now === true \? '\\u25b6 ' : ''\) \+ item\.title;/);
  assert.match(BROWSE, /var name = item === null \|\| playlist \|\| view\.plain === true \? null : iconNameFor\(/);
  // when the room moves on, the face is read again in place, keeping the row under the hand
  assert.match(JS, /if \(playing !== nowKey\) \{\s*nowKey = playing;\s*if \(browse !== undefined\) browse\.reloadQueue\(\);/);
  assert.match(BROWSE, /var held = was\.items\[was\.sel\]\.queueId;/);
  assert.match(BROWSE, /'Nothing queued'/);
  assert.match(BROWSE, /hierarchy: 'queue', tier: 'queue',/, 'a ring of titled circles (Peter, 09-04) — the spokes before it were "not so good with just a few items"');
  assert.match(BROWSE, /else if \(view\.tier === 'queue'\) drawQueueRing\(\);/);
  assert.match(BROWSE, /var QUEUE_PAGE = 12;/, 'up to twelve ring the face at once; more are pages of twelve');
  assert.match(BROWSE, /var angle = \(k \/ m\) \* 2 \* Math\.PI - Math\.PI \/ 2;/, 'spread evenly round the whole face, whatever the page holds');
  assert.match(BROWSE, /node\.appendChild\(titledToken\(item\.title, size, mine\)\);/, 'the title in each circle, not the sleeve');
  assert.match(BROWSE, /function titledToken\(title, size, mine\) \{\s*var mark = el\('div', 'tok tok-titled'\);\s*mark\.appendChild\(el\('div', 'tok-title', title\)\);/);
  assert.match(BROWSE, /\(item\.now === true \? ' opt-now' : ''\)/, 'the playing row is marked on its rim');
  assert.match(BROWSE, /function bindChoose\(node, index\) \{[\s\S]{0,300}if \(view === null \|\| view\.sel === index\) return;\s*view\.sel = index;\s*tick\(\);\s*draw\(\);/, 'a tap on a circle chooses; only the hub plays');
  assert.match(CSS, /\.tok-title \{[^\n]*-webkit-line-clamp: 3;/);
  assert.match(CSS, /\.opt-now \.tok \{ border-color: rgba\(242, 238, 230, \.7\); \}/);
  assert.match(CSS, /\.puck\[data-tier="queue"\] \.count \{ display: none; \}/, 'the place in the queue is read in the hub; an even ring puts a circle where the count would be');
  assert.match(CSS, /\.puck\[data-tier="queue"\] \.nav-keys \.key-up \{ top: calc\(var\(--u\) \* 38\.8\); \}\s*\.puck\[data-tier="queue"\] \.nav-keys \.key-down \{ top: calc\(var\(--u\) \* 61\.2\); \}/, 'the hub\'s keys sit on its rim so two lines of title fit between them');
  assert.doesNotMatch(BROWSE, /drawSpokes|spokeTitle|bindSpoke|SPOKE_/, 'the spokes are gone (rejected 09-04)');
  assert.doesNotMatch(CSS, /data-tier="spokes"|\.spoke/);
});

/**
 * ⚖️ TAPS SPELL (Peter, 09-04: "clicking a second or third letter should spell
 * out the search until located and selected"). On a letter's page the next tap
 * extends what is spelt — M, MA, MAR — and the same bisection lands on the
 * first title under it, judged in Roon's own order: the band first (# · A–Z ·
 * other scripts), then the key letter by letter.
 */
test('taps spell a prefix, judged in Roon\'s order, and the page seeks the first title under it', () => {
  assert.equal(keyOf('The Real McCoy'), 'REAL MCCOY');
  assert.equal(keyOf('Édith Piaf'), 'EDITH PIAF');
  assert.equal(keyOf("'Round About Midnight"), 'ROUND ABOUT MIDNIGHT');
  assert.equal(prefixCompare('Marvin Gaye', 'M'), 0);
  assert.equal(prefixCompare('Marvin Gaye', 'MAR'), 0);
  assert.equal(prefixCompare('Marvin Gaye', 'MARV'), 0);
  assert.equal(prefixCompare('Mars Volta', 'MARV'), -1, 'MARS is before MARV');
  assert.equal(prefixCompare('Masekela', 'MAR'), 1, 'MAS is after MAR');
  assert.equal(prefixCompare('Ma', 'MAR'), -1, 'a title shorter than the prefix sorts before it');
  assert.equal(prefixCompare('Lyle Lovett', 'MA'), -1);
  assert.equal(prefixCompare('思い出のパリ', 'M'), 1, 'other scripts keep their end past Z');
  assert.equal(prefixCompare("(What's The Story) Morning Glory?", 'A'), -1, 'brackets keep their end before A');
  assert.equal(prefixCompare('The Real McCoy', 'RE'), 0, 'THE is dropped, as Roon files it');
  // the machinery: one bisection for a letter or a spelt prefix alike, over the same probes
  assert.match(BROWSE, /function findLetter\(hierarchy, prefix, total, mine, probes, done\)/);
  assert.match(BROWSE, /if \(prefixCompare\(title, prefix\) >= 0\) \{ best = mid; high = mid - 1; \} else \{ low = mid \+ 1; \}/);
  assert.match(BROWSE, /var SPELL_MS = 6000;/, 'taps this close together spell one name');
  assert.match(BROWSE, /var wanted = extend \? spelt\.prefix \+ letter : letter;/);
  assert.match(BROWSE, /if \(found \|\| !extend\) \{ if \(done\) done\(found\); return; \}\s*\/\/ Nothing spells that far[^\n]*\n\s*seek\(page, letter, false,/, 'a letter that spells nothing starts over');
  assert.match(BROWSE, /function seek\(page, prefix, quiet, done\) \{[\s\S]{0,700}if \(!quiet\) flash\('nothing under ' \+ prefix\);/, 'a failed extension is quiet; a letter the library lacks is said');
  assert.match(BROWSE, /page\.spelt = \{ prefix: prefix, at: Date\.now\(\) \};/);
  assert.match(BROWSE, /spelt: letter !== undefined \? \{ prefix: letter, at: Date\.now\(\) \} : null,/, 'the first letter, from the ring, can be spelt on from');
  assert.match(BROWSE, /if \(view\.spelt && pick !== null && prefixCompare\(pick\.title, view\.spelt\.prefix\) !== 0\) view\.spelt = null;/, 'what is spelt stays only while the highlight is under it');
  assert.match(BROWSE, /\(view\.spelt \? view\.spelt\.prefix : view\.letter\)\);/, 'what is spelt is written beside the count');
});

/**
 * ⚖️ ROOMS: PULL FROM · SHIFT TO (Peter, 09-05: "if a simple interface is
 * possible"). A tap on the room name shows the other rooms as titled circles,
 * playing ones first and white-rimmed; the hub holds the chosen room, what it
 * plays, and the two verbs as keys — pull (that room's music here) and shift
 * (this room's music there) — through FlightDeck's own pull and transfer.
 */
test('the room name opens the rooms; pull and shift are two keys in the hub, each lit only when it can act', () => {
  assert.match(JS, /room\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); haptic\(10\); browse\.open\('rooms'\); \}\);/);
  assert.match(JS, /zones: function \(\) \{ var s = store\.snapshot\(\); return s === null \? \[\] : s\.zones; \},/);
  assert.match(JS, /act: function \(body\) \{ return command\(body\)\.then\(function \(result\) \{ return result === null; \}\); \},/, 'success is the deck\'s null; a refusal was already flashed');
  assert.match(JS, /if \(browse !== undefined\) browse\.refreshRooms\(\);/, 'the rooms follow the house');
  assert.match(BROWSE, /if \(hierarchy === 'rooms'\) \{ if \(view !== null && view\.rooms\) return; park\(\); openRooms\(\); return; \}/);
  assert.match(BROWSE, /if \(zone\.id === mine \|\| !zone\.outputs \|\| zone\.outputs\.length === 0\) continue;/, 'never this room, never a room with no speaker');
  assert.match(BROWSE, /if \(a\.playing !== b\.playing\) return a\.playing \? -1 : 1;/, 'playing rooms first');
  assert.match(BROWSE, /pullKey\.setAttribute\('data-off', pick !== null && pick\.live \? '0' : '1'\);/, 'pull needs that room to have something — a paused queue counts, as the deck rules');
  assert.match(BROWSE, /var playing = live && zone\.state === 'playing';/, 'the white rim and the front of the ring are for rooms actually playing');
  assert.match(BROWSE, /subtitle: !live \? 'quiet' : \(playing \? what : 'paused · ' \+ what\),/);
  assert.match(BROWSE, /shiftKey\.setAttribute\('data-off', pick !== null && here !== null && here\.nowPlaying \? '0' : '1'\);/, 'shift needs this room playing');
  assert.match(BROWSE, /act\(\{ action: 'pull', from: room\.zoneId, output: output, generation: fenced\.generation, revision: fenced\.revision \}\)/, 'pull is fenced by the snapshot it was chosen from');
  assert.match(BROWSE, /act\(\{ action: 'transfer', zone: here\.id, output: room\.outputId \}\)/, 'shift goes to the room\'s durable output');
  assert.match(BROWSE, /if \(ok\) \{ flash\('pulling from ' \+ room\.title\); close\(\); \}/);
  assert.match(BROWSE, /if \(view\.rooms\) \{ onSwitch\(item\); return; \}/, 'the rooms\' hub is the zone picker: a tap makes this puck that room\'s (Peter, 09-05)');
  assert.match(JS, /function switchRoom\(room\) \{[\s\S]{0,200}window\.location\.href = '\/puck\/' \+ encodeURIComponent\(room\.outputId\)/, 'by its durable output');
  assert.match(BROWSE, /if \(view !== null && !view\.queue && !view\.rooms\) parked = /, 'the rooms are never parked as the library');
  assert.match(BROWSE, /if \(view\.queue \|\| view\.rooms\) park\(\); else close\(\);/);
  assert.match(BROWSE, /if \(key === view\.key\) return;/, 'a snapshot that changes nothing on the ring redraws nothing');
  assert.ok(hasGlyph('pull') && hasGlyph('shift'));
  assert.match(CSS, /\.puck\[data-tier="rooms"\] \.room-keys \{ display: -webkit-flex; display: flex; \}/);
  assert.match(CSS, /\.key\[data-off="1"\] \{ color: rgba\(242, 238, 230, \.28\);/, 'a key that cannot act is dimmed, never hidden');
});

/**
 * ⚖️ ROON'S OWN LIMIT IS THE CEILING (Peter, 09-05: "Roon already provides a
 * comprehensive max volume per zone — don't create a duplicate; say users
 * should set it when the zone is first enabled"). Measured on Peter's Core:
 * the wire's volume object carries `soft_limit`. The wheel cannot ask past it
 * and the scale shows where it lies; nothing here stores a limit of its own.
 */
test('the wheel honours Roon\'s soft_limit and draws the scale past it dead', () => {
  assert.match(JS, /var soft = typeof volume\.softLimit === 'number' \? volume\.softLimit : max;\s*var ceiling = soft < max && soft > min \? soft : max;/);
  assert.match(JS, /if \(value > bounds\.ceiling\) value = bounds\.ceiling;/, 'a tap past the limit asks for the limit');
  assert.match(JS, /lightDetents\(\(shown - bounds\.min\) \/ span, String\(Math\.round\(shown\)\), \(bounds\.ceiling - bounds\.min\) \/ span\);/);
  assert.match(JS, /\(i >= alive \? ' beyond' : ''\)/, 'the ticks past the limit are dead');
  assert.match(JS, /"at Roon's limit \\u00b7 "/, 'and the readout says so, beneath the number');
  assert.match(CSS, /\.tick\.beyond, \.tick\.major\.beyond \{ display: none; \}/, 'Roon\'s way: only the ticks up to the comfort level are drawn');
  assert.match(CSS, /\.tick\.beyond\.is-lit, \.tick\.major\.beyond\.is-lit \{ display: inline; stroke: rgb\(232, 84, 70\); stroke-opacity: 1; \}/, 'above it, only where the level is, and red');
  assert.match(JS, /var over = volume\.value > bounds\.ceiling;/, 'a level set above the comfort level from Roon is shown where it is');
  assert.match(JS, /"above the limit set in Roon \\u00b7 "/);
});

/**
 * ⚖️ TRACKS EARNS THE RING (Peter, 09-05: "the tracks screen should present an
 * alphabet picker as it does for artists and albums"). Measured: 28,390 tracks,
 * alphabetical, and the very first title is "¡Buenos Días, Marco!" — Latin-1
 * punctuation the old rule filed after Z, which failed the order check and
 * cost the whole level its ring. Roon files such marks ahead of A.
 */
test('Latin-1 punctuation and symbols sort ahead of A, as Roon files them; other scripts still after Z', () => {
  assert.equal(letterOf('¡Buenos Días, Marco! For my Brother'), '#');
  assert.equal(letterOf('¿Quién?'), '#');
  assert.equal(letterOf('★ Star'), '#');
  assert.equal(letterOf('聽 Just Listen'), '~');
  assert.equal(letterOf('Édith Piaf'), 'E');
  assert.ok(isAlphabetical([
    { title: '¡Buenos Días, Marco!' }, { title: '(Ad Lib) Slow Dances' }, { title: 'Everybody Has a Dream' },
    { title: 'Line' }, { title: 'Se Me Rompe el Alma' }, { title: '聽 Just Listen' },
  ]), 'the measured Tracks samples, in Roon\'s order');
});

/**
 * ⚖️ MODES ON THE LABEL (Peter, 09-05: "each of these views should present
 * options for recently played, random or most frequently played, controlled by
 * clicking on the label and rotating"). Recent and top are the deck's own
 * ledger folded per level; random deals a page of the Roon list; a ledger row
 * hops into Roon by search. ‹ stays the way up.
 */
test('the label rotates A-Z, recent, top and random; recent and top fold the ledger per level', () => {
  const tracks = [
    { title: 'Burn', line2: 'Norah Jones', line3: 'Day Breaks', zoneName: 'Study', at: '2026-09-05T10:00:00Z', artKey: 'a' },
    { title: 'Burn', line2: 'Norah Jones', line3: 'Day Breaks', zoneName: 'Kitchen', at: '2026-09-05T12:00:00Z', artKey: 'a' },
    { title: 'Flipside', line2: 'Norah Jones / Leon Michels', line3: 'Day Breaks', zoneName: 'Study', at: '2026-09-05T11:00:00Z', artKey: 'a' },
    { title: 'Linger Awhile', line2: 'Samara Joy', line3: 'Linger Awhile', zoneName: 'Theater', at: '2026-09-05T09:00:00Z', artKey: 'b' },
    { title: 'Old Row', line2: 'Someone', line3: '', zoneName: 'Porch', at: '2026-09-01T09:00:00Z', artKey: null },
  ];
  const now = Date.parse('2026-09-05T12:30:00Z');
  assert.equal(firstArtist('Norah Jones / Leon Michels'), 'Norah Jones');
  const recentTracks = ledgerRows(tracks, 'tracks', 'recent', now);
  assert.deepEqual(recentTracks.map((r) => r.title), ['Burn', 'Flipside', 'Linger Awhile', 'Old Row'], 'newest first, a repeat folded');
  assert.equal(recentTracks[0].subtitle, '30 min ago · Kitchen');
  const topTracks = ledgerRows(tracks, 'tracks', 'top', now);
  assert.equal(topTracks[0].title, 'Burn');
  assert.equal(topTracks[0].subtitle, '2 plays · Norah Jones');
  const albums = ledgerRows(tracks, 'albums', 'top', now);
  assert.deepEqual(albums.map((r) => [r.title, r.plays]), [['Day Breaks', 3], ['Linger Awhile', 1]], 'albums fold by album and artist; a row without an album is skipped');
  const artists = ledgerRows(tracks, 'artists', 'recent', now);
  assert.deepEqual(artists.map((r) => r.title), ['Norah Jones', 'Samara Joy', 'Someone'], 'artists fold by the first name on the credit');
  assert.equal(ago('2026-09-05T12:29:50Z', now), 'just now');
  assert.equal(ago('2026-09-03T12:30:00Z', now), '2 d ago');
  // the label
  assert.match(BROWSE, /var levelBack = el\('span', 'level-back', '‹'\);\s*var levelName = el\('span', 'level-name'\);/);
  assert.match(BROWSE, /levelName\.addEventListener\('click', function \(event\) \{ event\.stopPropagation\(\); cycleMode\(\); \}\);/, 'the name rotates the mode');
  assert.match(BROWSE, /var MODES = \['az', 'recent', 'top', 'random', 'search'\];/, 'and SEARCH, last: the speller for this kind (Peter, 09-05)');
  assert.match(BROWSE, /if \(next === 'search'\) \{ view = base; spell\(\{ title: 'Search', input: \{ prompt: 'search ' \+ base\.title\.toLowerCase\(\) \} \}, base\.kind\); return; \}/);
  assert.match(BROWSE, /var want = \{ tracks: 'Tracks', albums: 'Albums', artists: 'Artists' \}\[speller\.spell\.kind\];/, 'results open straight into the matching category');
  assert.match(BROWSE, /function levelKind\(title\) \{[\s\S]{0,200}t === 'artists' \|\| t === 'albums' \|\| t === 'tracks' \? t : null;/, 'the three library lists have modes');
  assert.match(BROWSE, /if \(base === null\) \{ back\(\); return; \}/, 'a level without modes: the name is the way up, as before');
  assert.match(BROWSE, /kind: levelKind\(list\.title\), mode: 'az',/);
  assert.match(BROWSE, /fetch\('\/api\/v1\/recent\?limit=2000', \{ cache: 'no-store' \}\)/, 'recent and top read the deck\'s own ledger');
  assert.match(BROWSE, /if \(base !== null && base\.mode === 'random' && Math\.floor\(next \/ SLOTS\) !== Math\.floor\(view\.sel \/ SLOTS\)\) \{ randomPage\(\); return; \}/, 'in RANDOM, stepping off the page deals another');
  assert.match(BROWSE, /if \(view\.local\) \{ hop\(item\); return; \}/);
  assert.match(BROWSE, /ask\(\{ hierarchy: 'search', popAll: true, input: query \}\)/, 'a ledger row hops into Roon by search');
  assert.match(BROWSE, /landAt\(alpha, offset, letter\);/, 'the letter jump and RANDOM land the same way');
  assert.match(BROWSE, /if \(v\.parent && v\.parent\.kind && \(v\.local \|\| v\.letters !== null\)\) return v\.parent;\s*return null;/, 'a hopped Roon level is not mode territory: its label is its own name and the way up');
  assert.match(BROWSE, /if \(only === null \|\| keyOf\(only\.title\) !== wantKey \|\| \(only\.hint !== 'list' && only\.hint !== 'action_list'\)\) return;/, 'the one-row shell Roon nests a track in is passed through, never a bare action');
  assert.match(BROWSE, /\/\/ Hung straight under the ledger ring: ‹ never shows the one-row shell\.\s*if \(current\(mine\)\) \{ view\.parent = from; view\.roonLevel = false; \}/);
  assert.match(CSS, /\.level-back \{[^\n]*color: var\(--accent\);/);
  assert.match(CSS, /\.puck\[data-mode\] \.level \{ font-size: calc\(var\(--u\) \* 3\.6\); \}/, 'a longer label is set smaller');
  assert.doesNotMatch(CSS, /\.level:before/, 'the ‹ is a real element now, with its own tap');
});

/**
 * ⚖️ DRAGS WORK AS WELL AS TAPS (Peter, 09-05). On the volume scale a drag is a
 * dial: the level is the tick under the finger, bounded by the comfort level,
 * never flung across twelve, sent at most every 150 ms and once on release. On
 * the progress ring a drag scrubs: the bead follows the finger, one seek goes
 * when it lifts, and the room's own position waits until then.
 */
test('a drag on the scale is a dial: the tick under the finger, bounded, never flung across twelve', () => {
  const bounds = { min: 0, max: 100, ceiling: 80, step: 1 };
  assert.equal(levelForDrag(-90, bounds, null, 100), 0, 'twelve o\'clock is the bottom of the scale');
  assert.equal(levelForDrag(0, bounds, null, 100), 25, 'three o\'clock is a quarter');
  assert.equal(levelForDrag(90, bounds, 40, 100), 50, 'six o\'clock is half');
  assert.equal(levelForDrag(170, bounds, 60, 100), 72, 'eight o\'clock, up from sixty');
  assert.equal(levelForDrag(-100, bounds, 70, 100), 80, 'past the comfort level it asks for the comfort level');
  assert.equal(levelForDrag(-88, bounds, 3, 100), 1, 'a small move near twelve is fine');
  assert.equal(levelForDrag(-92, bounds, 3, 100), null, 'crossing twelve from three would fling to ninety-nine: refused, the level stays');
  assert.equal(levelForDrag(-92, { min: 0, max: 100, step: 1 }, null, 100), 99, 'no ceiling, no last: the raw tick');
  // the wiring
  assert.match(JS, /function dragLevel\(degrees, final\) \{[\s\S]{0,500}var value = levelForDrag\(degrees, bounds, dragLast, ticks\.length\);/);
  assert.match(JS, /if \(!force && Date\.now\(\) - dragSentAt < 150\) \{/, 'sent at most every 150 ms');
  assert.match(JS, /if \(dragLast !== null\) \{ flushDrag\(true\); dragLast = null; \}/, 'and once more when the finger lifts');
  assert.match(JS, /command\(\{ action: 'volume', output: send\.output, value: send\.value \}\);/, 'an absolute level, never a step: it cannot run away');
  assert.match(JS, /if \(dragLast !== null && turning !== null\) return;/, 'a hand on the scale paints its own target; the room\'s answer waits');
  // the scrub
  assert.match(JS, /if \(radiusOf\(glassMetrics\(\), event\.clientX, event\.clientY\) >= SEEK_BAND && !browse\.isOpen\(\)\) \{\s*scrub = \{ moved: false \};/, 'a finger landing in the ring band may scrub; in a menu the rim belongs to nothing');
  assert.match(JS, /setProgress\(fraction, fraction \* length, length\);\s*\}\);/, 'the bead and its time follow the finger');
  assert.match(JS, /if \(was\.moved\) \{ wake\(\); seekTo\(event\.clientX, event\.clientY\); return; \}/, 'ONE seek, when the finger lifts');
  assert.match(JS, /if \(scrubbing\) return;   \/\/ the bead is under a finger/, 'the room\'s own position waits');
});


// Peter 09-06, the puck on a phone: bigger verbs, a broader ring
test('the browse verbs are bigger circles with a touch halo, and the ring is broad to the finger', () => {
  assert.match(JS, /var SEEK_BAND = 29;/, 'the band begins just outside the select disc');
  assert.match(CSS, /\.nav-keys \.key \{[^}]*width: calc\(var\(--u\) \* 8\.5\); height: calc\(var\(--u\) \* 8\.5\);/);
  assert.match(CSS, /\.nav-keys \.key::before \{ content: ""; position: absolute; left: -30%; top: -30%; right: -30%; bottom: -30%; border-radius: 50%; \}/, 'an invisible halo a third wider again');
  assert.match(CSS, /\.key-down, [^{]*\{ left: 50%; top: calc\(var\(--u\) \* 61\); \}/, '\u2193 ends at 65.25, under the lowest names at 65.7');
  assert.match(CSS, /\.nav-keys \.key-prev, \.nav-keys \.key-next \{ width: calc\(var\(--u\) \* 7\.5\);/, '\u2039 \u203a keep to 7.5 beside the longer names, the halo doing the rest');
});

// Peter 09-06, the puck on a phone: verbs plainly on or gone; the letter is the select, large
test('the verbs read by colour and leave when inert; the letter ring and the speller show their select large', () => {
  assert.match(BROWSE, /var canStep = view\.total > 1;\s*prevKey\.setAttribute\('data-off', canStep \? '0' : '1'\);/, '\u2039 \u203a leave with one thing to choose from');
  assert.match(CSS, /\.nav-keys \.key\[data-off="1"\] \{ display: none; \}/, 'absent, not dimmed');
  assert.match(CSS, /\.nav-keys \.key-up, \.nav-keys \.key-down \{ border-color: var\(--accent\); color: var\(--accent\); \}/, 'the axis wears the accent');
  assert.match(CSS, /\.puck\[data-tier="alpha"\] \.chosen-title \{ font-size: calc\(var\(--u\) \* 13\);/, 'the letter, large');
  assert.match(CSS, /\.spell-keys \.key:last-child \{ width: calc\(var\(--u\) \* 11\);[^}]*border-color: var\(--accent\);/, 'the search key, largest and in the accent');
});
