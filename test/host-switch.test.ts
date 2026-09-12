import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HOST_SWITCH_FILE, parseHostSwitch, readHostSwitch, waitWhileSwitchedOff, type HostSwitch,
} from '../src/host-switch.ts';

test('standalone: no note means FlightDeck runs', () => {
  assert.deepEqual(parseHostSwitch(null), { on: true, host: null });
  const dir = mkdtempSync(join(tmpdir(), 'fd-switch-'));
  try { assert.deepEqual(readHostSwitch(dir), { on: true, host: null }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only an explicit enabled:false switches it off, and names the host', () => {
  assert.deepEqual(parseHostSwitch('{"enabled":false,"host":"RHEOS"}'), { on: false, host: 'RHEOS' });
  assert.deepEqual(parseHostSwitch('{"enabled":false}'), { on: false, host: 'the host' });
  assert.deepEqual(parseHostSwitch('{"enabled":true,"host":"RHEOS"}'), { on: true, host: 'RHEOS' });
});

test('a broken note never takes FlightDeck away', () => {
  for (const text of ['', 'not json', 'null', '42', '"off"', '[false]', '{"enabled":"false"}', '{"enabled":0}', '{}']) {
    assert.equal(parseHostSwitch(text).on, true, JSON.stringify(text));
  }
});

test('the note is read from the data folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-switch-'));
  try {
    writeFileSync(join(dir, HOST_SWITCH_FILE), JSON.stringify({ enabled: false, host: 'RHEOS', at: '2026-09-12T20:00:00Z' }));
    assert.deepEqual(readHostSwitch(dir), { on: false, host: 'RHEOS' });
    assert.equal(readFileSync(join(dir, HOST_SWITCH_FILE), 'utf8').includes('RHEOS'), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('switched on: the wait returns at once without logging or sleeping', async () => {
  const lines: string[] = []; let sleeps = 0;
  await waitWhileSwitchedOff(() => ({ on: true, host: null }), (m) => lines.push(m), async () => { sleeps += 1; });
  assert.deepEqual(lines, []);
  assert.equal(sleeps, 0);
});

test('switched off: it waits, polling, until the host switches it on — and says so once each way', async () => {
  const states: HostSwitch[] = [
    { on: false, host: 'RHEOS' }, { on: false, host: 'RHEOS' }, { on: false, host: 'RHEOS' }, { on: true, host: 'RHEOS' },
  ];
  const lines: string[] = []; const slept: number[] = [];
  await waitWhileSwitchedOff(() => states.shift()!, (m) => lines.push(m), async (ms) => { slept.push(ms); }, 3000);
  assert.deepEqual(slept, [3000, 3000, 3000]);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /switched off by RHEOS — waiting: no web page, not registered with Roon/);
  assert.match(lines[1]!, /switched on by RHEOS — starting/);
});

test('main.ts waits on the switch before it opens a port or registers with Roon, and leaves when switched off', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const wait = main.indexOf('await waitWhileSwitchedOff(');
  assert.ok(wait > 0, 'main() waits on the host switch');
  assert.ok(wait < main.indexOf('await listenWithLadder(server'), 'before the first listener');
  assert.ok(wait < main.indexOf('extension.start()'), 'before Roon registration');
  assert.match(main, /const note = readHostSwitch\(DATA_DIR\);[\s\S]{0,200}shutdown\(\);/, 'a running FlightDeck shuts down when switched off');
});
