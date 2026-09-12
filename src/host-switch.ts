import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A HOST APPLICATION CAN SWITCH FLIGHTDECK OFF WITHOUT OWNING IT.
 *
 * RHEOS's installer runs FlightDeck as a second container beside RHEOS, and RHEOS has an On/Off switch for it. A
 * container cannot start or stop another container without the Docker socket, which is root on the host, so the
 * switch is a note instead: RHEOS writes `host-switch.json` into FlightDeck's data folder, which the two containers
 * share. FlightDeck reads it before it opens a port or registers with Roon, and keeps reading it while it runs.
 *
 * Off: FlightDeck waits quietly — no web page, no mDNS name, not registered with Roon.
 * Switched off while running: FlightDeck shuts down cleanly and exits 0, and Docker restarts it into the wait.
 * Standalone: there is no note, so FlightDeck simply runs. Nothing here depends on RHEOS.
 *
 * Only an explicit, well-formed `{"enabled": false}` switches FlightDeck off. A missing, unreadable or malformed note
 * leaves it ON: a broken file must never silently take FlightDeck away from someone who installed it.
 */
export const HOST_SWITCH_FILE = 'host-switch.json';
export const HOST_SWITCH_POLL_MS = 3000;

export type HostSwitch =
  | { readonly on: true; readonly host: string | null }
  | { readonly on: false; readonly host: string };

export function parseHostSwitch(text: string | null): HostSwitch {
  if (text === null) return { on: true, host: null };
  let note: unknown;
  try { note = JSON.parse(text); } catch { return { on: true, host: null }; }
  if (note === null || typeof note !== 'object') return { on: true, host: null };
  const { enabled, host } = note as { enabled?: unknown; host?: unknown };
  const name = typeof host === 'string' && host.trim() !== '' ? host.trim().slice(0, 40) : 'the host';
  return enabled === false ? { on: false, host: name } : { on: true, host: typeof host === 'string' ? name : null };
}

export function readHostSwitch(dataDir: string): HostSwitch {
  let text: string | null = null;
  try { text = readFileSync(join(dataDir, HOST_SWITCH_FILE), 'utf8'); } catch { text = null; }
  return parseHostSwitch(text);
}

/**
 * The container healthcheck's verdict: 0 healthy, 1 unhealthy. A FlightDeck a host switched off serves nothing by
 * design, so it is healthy; otherwise the health endpoint has to answer.
 */
export async function healthVerdict(switchedOn: boolean, probe: () => Promise<boolean>): Promise<0 | 1> {
  if (!switchedOn) return 0;
  try { return (await probe()) ? 0 : 1; } catch { return 1; }
}

/** Resolves once FlightDeck may run: at once when nothing switched it off, otherwise when the host switches it on. */
export async function waitWhileSwitchedOff(
  read: () => HostSwitch,
  log: (message: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
  pollMs: number = HOST_SWITCH_POLL_MS,
): Promise<void> {
  let current = read();
  if (current.on) return;
  log(`switched off by ${current.host} — waiting: no web page, not registered with Roon, until it is switched on`);
  while (!current.on) {
    await sleep(pollMs);
    current = read();
  }
  log(`switched on by ${current.host ?? 'the host'} — starting`);
}
