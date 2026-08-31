import {
  IDLE_DELAY_MINUTES,
  isIdleDelayMinutes,
  type DisplayRecord,
  type IdleDelayMinutes,
} from './displays/registry.ts';
import type { Snapshot } from './model/types.ts';

interface SettingsIslandAccess {
  resolve(members: readonly string[]): { readonly id: string };
  setLabel(id: string, label: string): boolean;
}

interface SettingsDisplayAccess {
  active(now: number): DisplayRecord[];
  bind(id: string, outputId: string | null): boolean;
  setIdleDelay(id: string, idleDelayMinutes: number): boolean;
}

export interface SettingsLayout {
  readonly values: Record<string, unknown>;
  readonly layout: unknown[];
  readonly has_error: boolean;
}

const IDLE_DELAY_LABELS: Record<IdleDelayMinutes, string> = {
  0: 'Immediately',
  15: '15 minutes',
  30: '30 minutes',
  60: '1 hour',
  120: '2 hours',
  240: '4 hours',
};

export const IDLE_DELAY_CHOICES: readonly { readonly title: string; readonly value: string }[] =
  IDLE_DELAY_MINUTES.map((minutes) => ({
    title: IDLE_DELAY_LABELS[minutes],
    value: String(minutes),
  }));

const FACE_NAMES = [
  'presence', 'classic', 'dial', 'orbit', 'libretto', 'folio',
  'plate', 'rondo', 'canvas', 'gallery', 'aurora',
] as const;
const FACE_SUFFIX = new RegExp('^(.*?)\\s*·\\s*(' + FACE_NAMES.join('|') + ')\\s*$', 'i');

/** A registry record remains intact; only its human-facing settings label is cleaned. */
export function physicalDisplayName(display: DisplayRecord): string | null {
  const raw = display.name.replace(/\s+/g, ' ').trim();
  if (raw === '' || raw === display.id || raw === display.id.slice(0, 8)) return null;
  // Generated display ids are deliberately opaque and are not useful choices in
  // Roon Settings. Preserve their records so a later named heartbeat can reveal them.
  if (/^d\d{8}[a-z0-9]{0,6}$/i.test(raw)) return null;
  const match = FACE_SUFFIX.exec(raw);
  const family = (match === null ? raw : match[1]).trim();
  const lower = family.toLowerCase();
  if (family === '' || lower === 'wall' || lower === 'follows the music') return null;
  return family.charAt(0).toUpperCase() + family.slice(1);
}

function idleDelayValue(value: unknown): IdleDelayMinutes | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const minutes = Number(value);
  return isIdleDelayMinutes(minutes) ? minutes : null;
}

/**
 * THE SETTINGS PAGE inside Roon: grouping-island names and one policy per screen.
 * A screen is the browser-persisted display id, so its idle delay follows that
 * television without becoming a house-wide playback setting.
 */
export function buildSettingsLayout(
  snapshot: Snapshot | null,
  islands: SettingsIslandAccess,
  displays: SettingsDisplayAccess,
  values?: Record<string, unknown>,
  now = Date.now(),
): SettingsLayout {
  const present = snapshot === null ? [] : snapshot.islands;
  const rooms = new Map<string, string[]>();
  for (const zone of snapshot?.zones ?? []) {
    if (zone.outputs.length === 0) continue;
    const island = islands.resolve(zone.outputs[0].groupableWith).id;
    if (island === '') continue;
    rooms.set(island, [...(rooms.get(island) ?? []), zone.name]);
  }

  const out: Record<string, unknown> = {};
  const layout: unknown[] = [{
    type: 'label',
    title: 'Roon groups rooms by how they connect, but never says what those groups are.'
      + ' Name them here and every FlightDeck screen in the house will use the name.',
  }];
  present.forEach((island, index) => {
    const proposed = values === undefined ? undefined : values[island.id];
    out[island.id] = typeof proposed === 'string' ? proposed : (island.label ?? '');
    const members = (rooms.get(island.id) ?? []).sort();
    layout.push({
      type: 'string',
      title: 'roon ' + String(index + 1) + '  ·  ' + String(island.count) + ' rooms',
      subtitle: members.join(' · '),
      setting: island.id,
    });
  });
  if (present.length === 0) {
    layout.push({ type: 'label', title: 'No groups to name yet — waiting for the Core.' });
  }

  const seen = displays.active(now)
    .map((display) => ({ display, name: physicalDisplayName(display) }))
    .filter((entry): entry is { display: DisplayRecord; name: string } => entry.name !== null);
  const outputs: { title: string; value: string }[] = [{ title: 'Any room', value: '' }];
  for (const zone of snapshot?.zones ?? []) {
    for (const output of zone.outputs) outputs.push({ title: output.name, value: output.id });
  }
  outputs.sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : a.title.localeCompare(b.title)));

  if (seen.length > 0) {
    layout.push({
      type: 'label',
      title: 'Screens that have checked in. Lock one to a room and it will only ever show'
        + ' that room — or the group that room joins. Its idle clock delay is independent.',
    });
    for (const entry of seen) {
      const display = entry.display;
      const displayKey = 'display:' + display.id;
      const proposedOutput = values === undefined ? undefined : values[displayKey];
      out[displayKey] = typeof proposedOutput === 'string' ? proposedOutput : (display.outputId ?? '');
      layout.push({
        type: 'dropdown', title: entry.name + ' · room', values: outputs, setting: displayKey,
        subtitle: 'last seen ' + display.lastSeenAt.slice(11, 16),
      });

      const saverKey = 'saver:' + display.id;
      const proposedDelay = values === undefined ? null : idleDelayValue(values[saverKey]);
      out[saverKey] = String(proposedDelay ?? display.idleDelayMinutes);
      layout.push({
        type: 'dropdown',
        title: entry.name + ' · idle clock after',
        values: IDLE_DELAY_CHOICES,
        setting: saverKey,
        subtitle: 'when playback is paused or stopped',
      });
    }
  }
  return { values: out, layout, has_error: false };
}

/** Apply only recognised setting namespaces; a saver key can never rename an island. */
export function saveSettingsValues(
  values: Record<string, unknown>,
  islands: SettingsIslandAccess,
  displays: SettingsDisplayAccess,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string') continue;
    if (key.startsWith('saver:')) {
      const idleDelayMinutes = idleDelayValue(value);
      if (idleDelayMinutes !== null) displays.setIdleDelay(key.slice('saver:'.length), idleDelayMinutes);
    } else if (key.startsWith('display:')) {
      displays.bind(key.slice('display:'.length), value === '' ? null : value);
    } else {
      islands.setLabel(key, value);
    }
  }
}
