import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { tierFor, sampleOffsets, letterOf, isAlphabetical, selectionComplete } from '../assets/puck-browse.js';
import { iconNameFor, hasGlyph } from '../assets/puck-icons.js';
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
  assert.equal(tierFor(12), 'radial');
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
  assert.equal(named('Start Radio', 'action'), 'radio');
  assert.equal(named('Add Next', 'action'), 'queue');
  assert.equal(named('Shuffle', 'action'), 'shuffle');
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
  assert.match(JS, /var markAngle = \(\(tick \* DETENT_DEG\) - 90\) \* Math\.PI \/ 180;/, 'dots from twelve o\'clock');
  assert.match(JS, /function lightDetents\(fraction\)[\s\S]{0,300}'detent is-lit' : 'detent'/);
  assert.match(JS, /lightDetents\(\(shown - bounds\.min\) \/ span\)/);
  assert.match(JS, /rotate\(-90 50 50\)/);
  assert.match(JS, /var progArc = arcOf\('prog-arc', PROG_R, PROG_C\)/);
  assert.doesNotMatch(JS, /vol-arc|VOL_R|ring-gutter|vol-track/, 'nothing but progress is drawn on the glass');
  assert.match(CSS, /\.detent\.is-lit \{ fill: rgba\(242, 238, 230, \.92\); \}/);
  assert.match(CSS, /\.rig\[data-muted="1"\] \.detent\.is-lit/, 'muted dims the lit run rather than emptying it');
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
  assert.match(JS, /import \{ createVolumeGate \} from '\.\/volume-gate\.js';/);
  assert.match(JS, /var volumeGate = createVolumeGate\(function \(steps\) \{[\s\S]{0,240}command\(\{ action: 'volume', output: output\.id, steps: steps \}\)/,
    'the gate is the only thing that ever sends a volume step');
  assert.equal((JS.match(/action: 'volume'/g) ?? []).length, 1, 'one place, not two');
  assert.match(JS, /var verdict = volumeGate\.step\(step\);/);
  // A wheel event is DISTANCE: the gate turns it into detents, and a page that
  // is asleep is only woken by the first of them.
  assert.match(JS, /volumeGate\.scroll\(delta, function \(dir\)/);
  assert.match(JS, /if \(event\.deltaMode === 1\) delta \*= 33;/);
  assert.match(JS, /function turn\(step\)[\s\S]{0,400}if \(wake\(\)\) \{ showTurning\(\); return; \}/,
    'a scroll that lands on an idle page must not change a room before anyone has looked');
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
  assert.match(JS, /var PROG_R = 47;/, 'progress at the rim');
  assert.match(CSS, /\.cover img \{[\s\S]{0,120}object-fit: cover/, 'the sleeve fills the circle: cropped, never stretched or boxed');
  // The wheel and its dots ARE the volume (Peter, 09-03): nothing on the glass.
  assert.doesNotMatch(JS, /vol-pill|volMinus|volPlus|volMute|vol-num/);
  assert.doesNotMatch(CSS, /vol-pill|vol-num|vol-step/);
});

/**
 * ⚖️ THE FIRST TOUCH SUMMONS; THE SECOND ACTS. A puck lives where a hand brushes
 * past it, so a brush may raise the controls and must never pause the room.
 */
test('the first touch only summons the controls', () => {
  assert.match(JS, /function tapped\([\s\S]{0,400}if \(wake\(\)\) return;/);
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
  assert.match(BROWSE, /function token\(item, text\)[\s\S]{0,420}node\.appendChild\(el\('span', 'tok-text', text\)\)/,
    'icon, then the row\'s own sleeve, then its initial');
  assert.match(CSS, /\.tok \{[\s\S]{0,300}border-radius: 50%/);
  assert.match(CSS, /\.opt-on \.tok \{[\s\S]{0,160}border-color: var\(--accent\)/,
    'the chosen circle is marked the way an engaged transport button is');
  assert.match(BROWSE, /var below = Math\.sin\(angle\) <= 0;/,
    'a label hangs below on the top half and above on the bottom: a circle has no room at its foot');
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
  assert.match(JS, /if \(dy > 0\) \{[\s\S]{0,120}browse\.open\('browse'\)/);
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
  assert.match(BROWSE, /function back\(\)[\s\S]{0,400}if \(view\.depth === 0\) \{ close\(\); return; \}/);
  assert.match(BROWSE, /popLevels: 1/);
  assert.match(BROWSE, /var session = 'puck-'/,
    'Roon keeps one stack per multi_session_key; a shared key drags every other screen');
  // A letter jump is not a Roon level and must not pop the Core's stack.
  assert.match(BROWSE, /if \(view\.letter !== null\) \{[\s\S]{0,200}view = restored;/);
});

/** The ring band is the seek control, and it never names the terminal second. */
test('a tap on the ring seeks, through the one-intent gate', () => {
  assert.match(JS, /var seconds = seekTargetSecond\(fraction, length\)/);
  assert.match(JS, /seekIntent\.seek\(\{ zone: zone\.id, seconds: seconds \}\)/);
  assert.match(JS, /if \(!zone\.allowed\.seek\) \{ flash\('seeking is not available here'\); return; \}/);
  assert.match(JS, /radiusOf\(metrics, clientX, clientY\) >= RING_BAND/);
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
