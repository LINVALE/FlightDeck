import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsLayout, IDLE_DELAY_CHOICES, saveSettingsValues } from '../src/settings.ts';
import { DisplayRegistry, type DisplayRecord } from '../src/displays/registry.ts';
import type { Snapshot } from '../src/model/types.ts';

const AT = '2026-08-31T16:00:00.000Z';
const NOW = Date.parse(AT);

const display: DisplayRecord = {
  id: 'd1',
  name: 'study · rondo',
  lastSeenAt: AT,
  outputId: 'oStudy',
  idleDelayMinutes: 15,
};

const snapshot: Snapshot = {
  generation: 'g',
  revision: 1,
  generatedAt: AT,
  core: { state: 'paired', name: 'Core', sinceAt: AT },
  islands: [{ id: 'i1', label: null, count: 1 }],
  zones: [{
    id: 'zStudy',
    name: 'Study',
    state: 'stopped',
    nowPlaying: null,
    outputs: [{
      id: 'oStudy', name: 'Study', volume: null,
      groupableWith: ['oStudy', 'oKitchen'], island: 'i1',
    }],
    allowed: { play: true, pause: false, next: false, previous: false, seek: false },
    settings: null,
    lastPlayedAt: null,
    runStartedAt: null,
  }],
};

test('Roon Settings exposes the bounded idle-clock choices per active display', () => {
  const islands = {
    resolve: (): { id: string } => ({ id: 'i1' }),
    setLabel: (): boolean => true,
  };
  const displays = {
    active: (): DisplayRecord[] => [display],
    bind: (): boolean => true,
    setIdleDelay: (): boolean => true,
  };

  const settings = buildSettingsLayout(snapshot, islands, displays, undefined, NOW);
  assert.equal(settings.values['display:d1'], 'oStudy');
  assert.equal(settings.values['saver:d1'], '15');
  const saver = (settings.layout as Record<string, unknown>[])
    .find((entry) => entry.setting === 'saver:d1');
  assert.equal(saver?.type, 'dropdown');
  assert.equal(saver?.title, 'Study · idle clock after');
  assert.deepEqual(saver?.values, IDLE_DELAY_CHOICES);
  assert.deepEqual(IDLE_DELAY_CHOICES.map((choice) => choice.value), ['0', '15', '30', '60', '120', '240']);

  const proposed = buildSettingsLayout(snapshot, islands, displays, { 'saver:d1': '240' }, NOW);
  assert.equal(proposed.values['saver:d1'], '240');
  const malformed = buildSettingsLayout(snapshot, islands, displays, { 'saver:d1': '7' }, NOW);
  assert.equal(malformed.values['saver:d1'], '15', 'unsupported values fall back to the persisted value');
});

test('Canvas and Libretto are one named physical display, while raw records stay hidden', () => {
  const displays = new DisplayRegistry(null);
  displays.see('physical-study', 'study · Canvas', AT);
  displays.bind('physical-study', 'oStudy');
  displays.setIdleDelay('physical-study', 120);
  const rawId = 'd12345678abc';
  displays.see(rawId, rawId, AT);
  const islands = {
    resolve: (): { id: string } => ({ id: 'i1' }),
    setLabel: (): boolean => true,
  };

  const canvas = buildSettingsLayout(snapshot, islands, displays, undefined, NOW);
  const canvasFields = (canvas.layout as Record<string, unknown>[])
    .filter((entry) => typeof entry.setting === 'string'
      && (entry.setting as string).endsWith(':physical-study'));
  assert.deepEqual(canvasFields.map((entry) => entry.setting),
    ['display:physical-study', 'saver:physical-study']);
  assert.deepEqual(canvasFields.map((entry) => entry.title),
    ['Study · room', 'Study · idle clock after']);
  assert.equal(canvas.values['display:' + rawId], undefined);
  assert.equal(canvas.values['saver:' + rawId], undefined);
  assert.notEqual(displays.get(rawId), null, 'hidden legacy records are preserved, not deleted');

  displays.see('physical-study', 'study · Libretto', AT);
  const libretto = buildSettingsLayout(snapshot, islands, displays, undefined, NOW);
  const bindingKeys = Object.keys(libretto.values).filter((key) => key.startsWith('display:'));
  const saverKeys = Object.keys(libretto.values).filter((key) => key.startsWith('saver:'));
  assert.deepEqual(bindingKeys, ['display:physical-study']);
  assert.deepEqual(saverKeys, ['saver:physical-study']);
  assert.equal(displays.get('physical-study')?.outputId, 'oStudy', 'a face rename cannot create or clear a binding');
  assert.equal(displays.get('physical-study')?.idleDelayMinutes, 120,
    'a face rename cannot create or clear the idle policy');
});

test('saving a saver value reaches only the display delay namespace', () => {
  const labels: [string, string][] = [];
  const bindings: [string, string | null][] = [];
  const delays: [string, number][] = [];
  const islands = {
    resolve: (): { id: string } => ({ id: 'i1' }),
    setLabel: (id: string, label: string): boolean => { labels.push([id, label]); return true; },
  };
  const displays = {
    active: (): DisplayRecord[] => [display],
    bind: (id: string, outputId: string | null): boolean => { bindings.push([id, outputId]); return true; },
    setIdleDelay: (id: string, minutes: number): boolean => { delays.push([id, minutes]); return true; },
  };

  saveSettingsValues({
    'saver:d1': '120',
    'display:d1': '',
    i1: 'Squeezebox',
  }, islands, displays);
  assert.deepEqual(delays, [['d1', 120]]);
  assert.deepEqual(bindings, [['d1', null]]);
  assert.deepEqual(labels, [['i1', 'Squeezebox']]);

  saveSettingsValues({ 'saver:d1': '7', 'saver:d2': 30 }, islands, displays);
  assert.deepEqual(delays, [['d1', 120]], 'invalid values are ignored rather than persisted');
  assert.deepEqual(labels, [['i1', 'Squeezebox']], 'a saver key can never fall through to island labels');
});
