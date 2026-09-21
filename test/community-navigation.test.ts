import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { captureListPosition, restoreListPosition } from '../assets/browse-position.js';
import { createWakePolicy } from '../assets/display-care.js';
import { levelAtAngle } from '../assets/volume-gate.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('Back remembers the visible ordinal and pixel inset without retaining item keys', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ getBoundingClientRect: () => ({ top: 10 + i * 30 - 515, bottom: 40 + i * 30 - 515 }) }));
  const list = { querySelectorAll: () => rows, getBoundingClientRect: () => ({ top: 10 }), scrollTop: 515 };
  const position = captureListPosition(list, '.row', 300, rows[20]);
  assert.deepEqual(position, { offset: 317, inset: -5, selected: 3 });
  let scroll = 0;
  const freshRows = Array.from({ length: 60 }, (_, i) => ({ key: 'fresh-' + i, getBoundingClientRect: () => ({ top: 50 + i * 30 - scroll }) }));
  const fresh = { querySelectorAll: () => freshRows, getBoundingClientRect: () => ({ top: 10 }), get scrollTop() { return scroll; }, set scrollTop(v) { scroll = v; } };
  assert.equal(restoreListPosition(fresh, '.row', position), freshRows[3]);
  assert.equal(freshRows[0].getBoundingClientRect().top - 10, -5);
});

test('phone Back pops the Core stack, loads the saved window with fresh keys and pages from its real offset', async () => {
  const source = readFileSync(new URL('../assets/phone.js', import.meta.url), 'utf8');
  const calls: any[] = [];
  const context = vm.createContext({
    browse: { epoch: 0, hierarchy: 'albums', loading: false, list: { level: 2 }, positions: [{ offset: 317, inset: -5, selected: 3 }], items: [], offset: 0 },
    BROWSE_PAGE: 60, sheet: { querySelector: () => null }, repaintSheet() {}, flash() {}, closeSheet() {},
    captureListPosition, restoreListPosition,
    ask: async (body: any) => { calls.push(body); return body.load ? { list: { count: 800, level: 1 }, offset: body.offset, items: Array.from({ length: 60 }, (_, i) => ({ itemKey: 'fresh-' + (body.offset + i) })) } : {}; },
  });
  vm.runInContext(source.slice(source.indexOf('function phoneBrowsePosition'), source.indexOf('/** A row of the library')), context);
  await context.browseBack();
  assert.equal(calls[0].popLevels, 1); assert.equal(calls[1].offset, 317);
  assert.equal(context.browse.items[3].itemKey, 'fresh-320');
  await context.browseMore();
  assert.equal(calls[2].offset, 377);
});

test('phone discards a page that arrives after a newer search has taken ownership', async () => {
  const source = readFileSync(new URL('../assets/phone.js', import.meta.url), 'utf8');
  let finish: (value: any) => void = () => {};
  const context = vm.createContext({ browse: { epoch: 1, hierarchy: 'albums', items: [{ title: 'new search' }] }, BROWSE_PAGE: 60,
    ask: () => new Promise((resolve) => { finish = resolve; }), repaintSheet() { throw new Error('stale page repainted'); } });
  vm.runInContext(source.slice(source.indexOf('function browseShow('), source.indexOf('function browseFailed(')), context);
  const pending = context.browseShow(null, 1); context.browse.epoch = 2;
  finish({ items: [{ title: 'old page' }], list: {} }); await pending;
  assert.equal(context.browse.items[0].title, 'new search');
});

test('wake lock owns one request and releases both active and late grants', async () => {
  let calls = 0, releases = 0, grant: (value: any) => void = () => {};
  const policy = createWakePolicy(() => { calls++; return new Promise((resolve) => { grant = resolve; }); });
  const lock = () => ({ addEventListener() {}, release() { releases++; return Promise.resolve(); } });
  policy.update(true); policy.update(true); await turn(); assert.equal(calls, 1);
  policy.update(false); grant(lock()); await turn(); assert.equal(releases, 1);
  policy.update(true); await turn(); grant(lock()); await turn(); policy.update(false);
  assert.equal(releases, 2);
});

test('puck angle selection preserves a device half-dB step', () => {
  assert.equal(levelAtAngle(177.75, -80, 0, 160, .5), -20.5);
});
