import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctArt, collageLayout, createCollages } from '../assets/collage.js';

/**
 * ⚖️ A PLAYLIST'S CIRCLE IS A COLLAGE OF ITS COVERS (Peter, 09-04). The pure
 * parts: which sleeves, and where they go.
 */
test('the first four distinct sleeves, in order, and none twice', () => {
  const rows = [
    { art: '/a' }, { art: '/a' }, { title: 'no art' }, { art: '/b' }, { art: null }, { art: '/c' }, { art: '/b' }, { art: '/d' }, { art: '/e' },
  ];
  assert.deepEqual(distinctArt(rows, 4), ['/a', '/b', '/c', '/d']);
  assert.deepEqual(distinctArt(rows, 2), ['/a', '/b']);
  assert.deepEqual(distinctArt([{}, { art: 7 }], 4), []);
});

test('one sleeve fills, two share, three and four tile — and three never leaves a dark corner', () => {
  assert.deepEqual(collageLayout(1, 96), [{ x: 0, y: 0, w: 96, h: 96, at: 0 }]);
  assert.deepEqual(collageLayout(2, 96).map((c) => [c.x, c.w, c.at]), [[0, 48, 0], [48, 48, 1]]);
  const four = collageLayout(4, 96);
  assert.equal(four.length, 4);
  assert.deepEqual(four.map((c) => c.at), [0, 1, 2, 3]);
  const three = collageLayout(3, 96);
  assert.deepEqual(three.map((c) => c.at), [0, 1, 2, 0], 'the fourth cell repeats the first');
  assert.deepEqual(collageLayout(0, 96), []);
});

/**
 * The builder uses a browse session of its OWN, so the level a person is
 * looking at never moves under them; and it remembers by title, so a second
 * request costs no calls at all.
 */
test('the builder browses in its own session, one at a time, and remembers', async () => {
  const calls: { body: Record<string, unknown>; session: string }[] = [];
  const ask = (body: Record<string, unknown>, session: string): Promise<unknown> => {
    calls.push({ body, session });
    if (body.load === true && body.count === 200) return Promise.resolve({ items: [{ title: 'Relax', itemKey: 'k1' }, { title: 'Other', itemKey: 'k2' }] });
    if (body.load === true) return Promise.resolve({ items: [] });   // no sleeves: nothing to draw
    return Promise.resolve({});
  };
  const collages = createCollages(ask, { size: 8, want: 4 });
  const first = await new Promise<string | null>((done) => collages.request('playlists', 'Relax', done));
  assert.equal(first, null, 'no sleeves in the playlist: nothing to show, honestly');
  assert.ok(calls.every((c) => c.session.startsWith('puck-collage-')), 'never the person\'s own session');
  assert.deepEqual(calls.map((c) => Object.keys(c.body).filter((k) => k !== 'sessionKey').sort().join(',')),
    ['hierarchy,popAll', 'count,hierarchy,load,offset', 'hierarchy,itemKey', 'count,hierarchy,load,offset'],
    'to the root, find the row, descend, read rows');
  assert.equal(calls[2].body.itemKey, 'k1', 'the row found by title');
  const before = calls.length;
  const again = await new Promise<string | null>((done) => collages.request('playlists', 'Relax', done));
  assert.equal(again, null);
  assert.equal(calls.length, before, 'remembered: no calls the second time');
  const unknown = await new Promise<string | null>((done) => collages.request('playlists', 'Nowhere', done));
  assert.equal(unknown, null, 'a title Roon does not list resolves to nothing, without throwing');
});
