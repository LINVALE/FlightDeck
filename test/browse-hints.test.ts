import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintFor } from '../assets/browse-hints.js';

// Peter 09-07: "can we provide info in hover tags to show what they do?" — measured on the Core, Jazz and below
test('a list row says what it opens and that nothing plays yet', () => {
  const jazz = { title: 'Jazz', hierarchy: 'genres' };
  assert.equal(hintFor({ title: 'Artists', hint: 'list' }, jazz), 'the artists in Jazz — choose one to open it, nothing plays yet');
  assert.equal(hintFor({ title: 'Albums', hint: 'list' }, jazz), 'the albums in Jazz — choose one to open it, nothing plays yet');
  assert.equal(hintFor({ title: 'Post-Bop', subtitle: '143 Artists, 126 Albums', hint: 'list' }, jazz), 'a subgenre of Jazz: opens its artists, albums and subgenres');
  assert.equal(hintFor({ title: 'Jazz', hint: 'list' }, { title: 'Genres', hierarchy: 'genres' }), 'a genre: opens its artists, albums and subgenres');
  assert.equal(hintFor({ title: 'Post-Bop', subtitle: '143 Artists, 126 Albums', hint: 'list' }, { title: 'Jazz', hierarchy: 'browse' }), 'a subgenre of Jazz: opens its artists, albums and subgenres', 'by the browse-root route too');
  assert.equal(hintFor({ title: 'Genres', hint: 'list' }, { title: 'Explore', hierarchy: 'browse' }), 'the genres — choose one to open its artists, albums and subgenres');
  assert.equal(hintFor({ title: 'The Very Best of Acoustic Alchemy', hint: 'list' }, { title: 'Acoustic Alchemy', hierarchy: 'genres' }), 'opens The Very Best of Acoustic Alchemy; nothing plays until you choose how');
  assert.equal(hintFor({ title: 'Search', hint: 'list' }, { title: 'Library', hierarchy: 'browse' }), 'search Roon by spelling a name');
});

test('an action list names the whole thing and its verbs; a track row its own', () => {
  assert.equal(hintFor({ title: 'Play Genre', hint: 'action_list' }, { title: 'Jazz' }), 'the whole genre: shuffle it, or start a radio from it');
  assert.equal(hintFor({ title: 'Play Artist', hint: 'action_list' }, { title: 'Acoustic Alchemy' }), 'the whole artist: shuffle, or start a radio from them');
  assert.equal(hintFor({ title: 'Play Album', hint: 'action_list' }, { title: 'A Charlie Brown Christmas' }), 'the whole album: play now, add next, queue, or start a radio from it');
  assert.equal(hintFor({ title: '3. The Girl from Ipanema', hint: 'action_list' }, { title: 'An album' }), 'this track: play now, add next, queue, or start a radio from it');
});

test('an action says exactly what pressing it does', () => {
  assert.equal(hintFor({ title: 'Play Now', hint: 'action' }, {}), 'Play Now: plays this now, in place of what is playing');
  assert.equal(hintFor({ title: 'Add Next', hint: 'action' }, {}), 'Add Next: plays this after the current track');
  assert.equal(hintFor({ title: 'Queue', hint: 'action' }, {}), 'Queue: adds this to the end of the queue');
  assert.equal(hintFor({ title: 'Start Radio', hint: 'action' }, {}), 'Start Radio: starts a radio built from this');
  assert.equal(hintFor({ title: 'Shuffle', hint: 'action' }, {}), 'Shuffle: plays this in a random order');
  assert.equal(hintFor({ title: 'Header', hint: 'header' }, {}), '', 'a header says nothing');
  assert.equal(hintFor(null, {}), '');
});
