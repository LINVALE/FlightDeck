import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, uiOverride, decideUi, screenReport, PHONE_SHORT_SIDE } from '../assets/screen-shape.js';

// Peter 09-06: a Fire TV was taken for a phone. Shape is decided by the short
// side and the pointer together, never by the user agent or the width alone.
test('a phone is phone-sized on its short side with no hover and a coarse pointer; everything else is a television', () => {
  assert.equal(shapeOf({ shortSide: 390, hoverNone: true, coarse: true }), 'phone', 'iPhone, portrait');
  assert.equal(shapeOf({ shortSide: 390, hoverNone: true, coarse: true }), 'phone', 'iPhone lying down: the short side is still 390');
  assert.equal(shapeOf({ shortSide: 540, hoverNone: false, coarse: false }), 'tv', 'a Fire TV laying out at 960×540 with a cursor');
  assert.equal(shapeOf({ shortSide: 540, hoverNone: true, coarse: false }), 'tv', 'a television with no hover but a fine pointer');
  assert.equal(shapeOf({ shortSide: 600, hoverNone: false, coarse: false }), 'tv', 'a narrow desktop window');
  assert.equal(shapeOf({ shortSide: 768, hoverNone: true, coarse: true }), 'tv', 'a tablet: past the bound, the television pages fit');
  assert.equal(shapeOf({ shortSide: PHONE_SHORT_SIDE, hoverNone: true, coarse: true }), 'phone', 'the bound is inclusive');
  assert.equal(shapeOf({ shortSide: 0, hoverNone: true, coarse: true }), 'tv', 'no reading is no phone');
});

class FakeStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}

test('?ui= wins and is remembered; ?ui=auto forgets; private mode only ever reads the address', () => {
  const storage = new FakeStorage();
  assert.equal(uiOverride('', storage), null);
  assert.equal(uiOverride('?ui=tv', storage), 'tv');
  assert.equal(uiOverride('', storage), 'tv', 'remembered');
  assert.equal(uiOverride('?face=plate&ui=phone', storage), 'phone');
  assert.equal(uiOverride('?ui=fridge', storage), 'phone', 'nonsense changes nothing');
  assert.equal(uiOverride('?ui=auto', storage), null);
  assert.equal(uiOverride('', storage), null, 'forgotten');
  assert.equal(uiOverride('?ui=tv', null), 'tv', 'private mode: the address still counts');
  assert.equal(uiOverride('', null), null);
});

function fakeWindow(width: number, height: number, hoverNone: boolean, coarse: boolean, agent = 'Test/1') {
  return {
    innerWidth: width, innerHeight: height,
    navigator: { userAgent: agent },
    matchMedia: (query: string) => ({ matches: query === '(hover: none)' ? hoverNone : (query === '(pointer: coarse)' ? coarse : false) }),
  };
}

test('the decision reads the window; the override reads the address; the report says what was seen', () => {
  const storage = new FakeStorage();
  assert.equal(decideUi(fakeWindow(390, 844, true, true), '', storage), 'phone');
  assert.equal(decideUi(fakeWindow(844, 390, true, true), '', storage), 'phone', 'lying down');
  assert.equal(decideUi(fakeWindow(960, 540, false, false), '', storage), 'tv', 'the Fire TV case');
  assert.equal(decideUi(fakeWindow(390, 844, true, true), '?ui=tv', storage), 'tv', 'a phone asked for the television pages');
  assert.equal(decideUi(fakeWindow(1920, 1080, false, false), '?ui=phone', storage), 'phone', 'a desktop asked to see the phone wall');
  const report = screenReport(fakeWindow(960, 540, false, false, 'Mozilla/5.0 (Linux; Android 9; AFTKA) Silk/120'), 'face', 'tv');
  assert.deepEqual(report, { width: 960, height: 540, agent: 'Mozilla/5.0 (Linux; Android 9; AFTKA) Silk/120', page: 'face', shape: 'tv' });
  assert.equal(screenReport(fakeWindow(1, 1, false, false, 'x'.repeat(400)), 'wall', 'tv').agent.length, 160, 'the agent is trimmed at the source too');
});
