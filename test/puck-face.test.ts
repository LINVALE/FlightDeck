import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { tierFor, letterOf, isAlphabetical, selectionComplete } from '../assets/puck-browse.js';
import { ZONES } from './fixtures/zones.ts';

const asset = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '..', 'assets', name), 'utf8');

const JS = asset('puck.js');
const BROWSE = asset('puck-browse.js');
const CSS = asset('puck.css');

/**
 * ⚖️ THE TIER IS CHOSEN BEFORE THE ITEMS ARE LOADED. Roon reports `list.count`
 * with the level, so the dial never fetches two thousand albums to discover that
 * they will not fit around a circle. The measured counts on Peter's library —
 * Explore 7, Genres 56, Albums 2295 — are exactly why all three tiers exist.
 */
test('the browse tier is decided by the count Roon states with the level', () => {
  assert.equal(tierFor(7), 'radial');
  assert.equal(tierFor(12), 'radial');
  assert.equal(tierFor(13), 'alpha');
  assert.equal(tierFor(56), 'alpha');
  assert.equal(tierFor(200), 'alpha');
  assert.equal(tierFor(201), 'linear');
  assert.equal(tierFor(2295), 'linear');
  // An empty level is still a level, and a ring of nothing is not a crash.
  assert.equal(tierFor(0), 'radial');
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

/** Roon sorts "The Beatles" under B and numbers ahead of letters; the jump must agree. */
test('the alphabet jump buckets a title the way the Core already ordered it', () => {
  assert.equal(letterOf('The Beatles'), 'B');
  assert.equal(letterOf('A Love Supreme'), 'L');
  assert.equal(letterOf('An Awesome Wave'), 'A');
  assert.equal(letterOf('Kind of Blue'), 'K');
  assert.equal(letterOf('1979'), '#');
  assert.equal(letterOf('…And Justice For All'), '#');
  assert.equal(letterOf(''), '#');
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
 * ⚖️ TWO RINGS, ADJACENT (Peter, 09-03): volume OUTSIDE — the wheel's own
 * readout, drawn where the hand is — and progress inside it. Both sweep from
 * twelve o'clock, which is the convention every FlightDeck ring already shares.
 */
test('the outer ring is volume, the inner ring is progress, and both start at twelve', () => {
  assert.match(JS, /var VOL_R = 47;/);
  assert.match(JS, /var PROG_R = 42;/);
  assert.match(JS, /rotate\(-90 50 50\)/);
  assert.match(JS, /var volArc = arcOf\('vol-arc', VOL_R, VOL_C\)/);
  assert.match(JS, /var progArc = arcOf\('prog-arc', PROG_R, PROG_C\)/);
  assert.match(CSS, /\.vol-arc \{[\s\S]{0,160}stroke: rgba\(242, 238, 230, \.88\)/);
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
 * ⚖️ ONE DETENT, ONE STEP, and a fast spin is ONE intention. Sixty separate
 * requests would arrive after the hand had already stopped.
 */
test('the wheel is quantised to its detents and its steps are flushed together', () => {
  assert.match(JS, /var DETENT_DEG = 12;/);
  assert.match(JS, /while \(Math\.abs\(turning\.carried\) >= DETENT_DEG\)/);
  assert.match(JS, /volPending \+= steps;[\s\S]{0,140}setTimeout\(flushVolume, 140\)/);
  assert.match(JS, /Math\.max\(-4, Math\.min\(4, steps\)\)/,
    'the server clamps a step run to four; asking for more invites a lie in return');
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
test('the words are title, artist and album, and the overlay condenses them', () => {
  assert.match(JS, /title\.textContent = np\.title;\s*artist\.textContent = np\.line2;\s*album\.textContent = np\.line3;/);
  assert.match(CSS, /\.puck\[data-chrome="1"\] \.artist,\s*\.puck\[data-chrome="1"\] \.album \{ display: none; \}/);
});

/**
 * ⚖️ THE WORDS ARE THE WAY IN (Peter, 09-03) — what is playing and what could be
 * playing are the same question asked twice.
 */
test('the credit at the foot opens browse, as does a downward swipe', () => {
  assert.match(JS, /press\(words, function \(\) \{[\s\S]{0,120}browse\.open\('browse'\)/);
  assert.match(JS, /if \(dy > 0\) \{[\s\S]{0,120}browse\.open\('browse'\)/);
});

/**
 * ⚖️ ONE AXIS WITH THREE STOPS (09-02): ↑ always climbs and ↓ always descends,
 * at every depth, so a repeated ↑ walks home from anywhere. This retired the
 * earlier conflict where ↓ meant both "back a level" and "leave browse".
 */
test('an unordered middle level falls to the column, and the jump is a lookup', () => {
  assert.match(BROWSE, /if \(wanted === 'alpha' && !isAlphabetical\(view\.items\)\) view\.tier = 'linear';/);
  assert.match(BROWSE, /var take = wanted === 'radial' \? RADIAL_MAX : \(wanted === 'alpha' \? ALPHA_MAX : PAGE\)/,
    'the middle band loads whole, which is what buys the right to read its order');
  assert.doesNotMatch(BROWSE, /findLetter/,
    'the bisection is gone: with the level in hand the first row under a letter is a scan');
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
