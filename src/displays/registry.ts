import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE SCREENS THEMSELVES.
 *
 * A display is bound to an OUTPUT rather than a zone, because a screen on a wall
 * belongs to the speaker standing next to it. The zone is re-derived from that
 * output on every snapshot, so when the room is grouped the screen follows the
 * group it has joined instead of stranding on a zone that no longer exists — the
 * same reasoning `boundOutputId` already used, now under someone's control rather
 * than only the URL's.
 *
 * A screen introduces itself with an id it made up and keeps in its own browser.
 * That is enough: nothing here is a secret, everything is on one LAN, and the
 * alternative — asking people to identify their televisions — is worse.
 */

const MAX_DISPLAYS = 64;
const MAX_NAME = 40;
/** Screens not seen for a fortnight are forgotten, so the list stays the house. */
const FORGET_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export const IDLE_DELAY_MINUTES = [0, 15, 30, 60, 120, 240] as const;
export type IdleDelayMinutes = typeof IDLE_DELAY_MINUTES[number];
export const DEFAULT_IDLE_DELAY_MINUTES: IdleDelayMinutes = 15;

export function isIdleDelayMinutes(value: unknown): value is IdleDelayMinutes {
  return typeof value === 'number'
    && IDLE_DELAY_MINUTES.includes(value as IdleDelayMinutes);
}

function normaliseIdleDelay(value: unknown): IdleDelayMinutes {
  return isIdleDelayMinutes(value) ? value : DEFAULT_IDLE_DELAY_MINUTES;
}

/**
 * WHAT A SCREEN SAYS IT IS. Recorded so a misfire can be read off the registry
 * instead of guessed (Peter, 09-06: a Fire TV had fallen into the phone
 * layout and nothing here could say what its browser had reported).
 */
export interface DisplayScreen {
  /** the CSS viewport the browser laid the page out in */
  readonly width: number;
  readonly height: number;
  /** the browser's own account of itself, trimmed */
  readonly agent: string;
  /** which page said hello: wall · face · phone · puck */
  readonly page: string;
  /** what that page decided it was standing on: tv · phone */
  readonly shape: string;
}

export const MAX_AGENT = 160;
const PAGES = ['wall', 'face', 'phone', 'puck'];
const SHAPES = ['tv', 'phone'];

/** A screen report from the wire, bounded; null if it is not one. */
export function normaliseScreen(value: unknown): DisplayScreen | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const dim = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20000 ? Math.round(n) : 0);
  const width = dim(raw.width);
  const height = dim(raw.height);
  if (width === 0 || height === 0) return null;
  const page = typeof raw.page === 'string' && PAGES.includes(raw.page) ? raw.page : '';
  const shape = typeof raw.shape === 'string' && SHAPES.includes(raw.shape) ? raw.shape : '';
  const agent = typeof raw.agent === 'string' ? raw.agent.replace(/\s+/g, ' ').trim().slice(0, MAX_AGENT) : '';
  return { width, height, agent, page, shape };
}

function sameScreen(a: DisplayScreen | null, b: DisplayScreen | null): boolean {
  if (a === null || b === null) return a === b;
  return a.width === b.width && a.height === b.height && a.agent === b.agent && a.page === b.page && a.shape === b.shape;
}

export interface DisplayRecord {
  readonly id: string;
  readonly name: string;
  readonly lastSeenAt: string;
  /** The output this screen is locked to, or null to let it roam. */
  readonly outputId: string | null;
  /** Minutes of paused/stopped playback before this screen becomes its idle clock. */
  readonly idleDelayMinutes: IdleDelayMinutes;
  /** What the screen last said it was; null until a page that reports it says hello. */
  readonly screen: DisplayScreen | null;
}

export class DisplayRegistry {
  private records = new Map<string, DisplayRecord>();
  private readonly path: string | null;

  constructor(dataDir: string | null) {
    this.path = dataDir === null ? null : join(dataDir, 'displays.json');
    this.load();
  }

  private load(): void {
    if (this.path === null) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!Array.isArray(raw)) return;
      let migrated = false;
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        if (id === '') continue;
        const idleDelayMinutes = normaliseIdleDelay(record.idleDelayMinutes);
        if (record.idleDelayMinutes !== idleDelayMinutes) migrated = true;
        this.records.set(id, {
          id,
          name: typeof record.name === 'string' ? record.name.slice(0, MAX_NAME) : id,
          lastSeenAt: typeof record.lastSeenAt === 'string' ? record.lastSeenAt : new Date(0).toISOString(),
          outputId: typeof record.outputId === 'string' && record.outputId !== '' ? record.outputId : null,
          idleDelayMinutes,
          screen: normaliseScreen(record.screen),
        });
      }
      if (migrated) this.save();
    } catch {
      // no file yet, or an unreadable one: a house with no screens on record
    }
  }

  private save(): void {
    if (this.path === null) return;
    try {
      const temp = this.path + '.tmp';
      writeFileSync(temp, JSON.stringify([...this.records.values()], null, 2));
      renameSync(temp, this.path);   // atomic: a half-written file loses every binding
    } catch {
      // read-only data dir: the bindings live for this run and no longer
    }
  }

  /**
   * A screen saying hello. Returns what it is bound to, if anything. A hello
   * that carries no report keeps the last one: the report is a fact about the
   * screen, not about this heartbeat.
   */
  see(id: string, name: string, at: string, screen: DisplayScreen | null = null): DisplayRecord | null {
    if (id === '' || id.length > 64) return null;
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    const existing = this.records.get(id);
    if (existing === undefined && this.records.size >= MAX_DISPLAYS) return null;
    const record: DisplayRecord = {
      id,
      // a screen may rename itself as it moves rooms; a blank never overwrites
      name: clean === '' ? (existing?.name ?? id.slice(0, 8)) : clean,
      lastSeenAt: at,
      outputId: existing?.outputId ?? null,
      idleDelayMinutes: existing?.idleDelayMinutes ?? DEFAULT_IDLE_DELAY_MINUTES,
      screen: screen ?? existing?.screen ?? null,
    };
    const changed = existing === undefined || existing.name !== record.name || !sameScreen(existing.screen, record.screen);
    this.records.set(id, record);
    // Written on a real change only: a heartbeat every twenty seconds must not
    // rewrite the file every twenty seconds.
    if (changed) this.save();
    return record;
  }

  bind(id: string, outputId: string | null): boolean {
    const existing = this.records.get(id);
    if (existing === undefined) return false;
    this.records.set(id, { ...existing, outputId: outputId === '' ? null : outputId });
    this.save();
    return true;
  }

  setIdleDelay(id: string, idleDelayMinutes: number): boolean {
    const existing = this.records.get(id);
    if (existing === undefined || !isIdleDelayMinutes(idleDelayMinutes)) return false;
    if (existing.idleDelayMinutes === idleDelayMinutes) return true;
    this.records.set(id, { ...existing, idleDelayMinutes });
    this.save();
    return true;
  }

  get(id: string): DisplayRecord | null {
    return this.records.get(id) ?? null;
  }

  /** Most recently seen first, and only those seen lately. */
  active(now: number): DisplayRecord[] {
    return [...this.records.values()]
      .filter((r) => now - (Date.parse(r.lastSeenAt) || 0) < FORGET_AFTER_MS)
      .sort((a, b) => (Date.parse(b.lastSeenAt) || 0) - (Date.parse(a.lastSeenAt) || 0));
  }
}
