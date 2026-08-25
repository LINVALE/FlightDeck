import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The last-played ledger. Roon's API has NO history — but FlightDeck sees every
 * zone, so it keeps its own. This is what orders the House Wall (Peter's ruling
 * 08-25: most recently played first) and what feeds the Idle Face's recent gallery.
 *
 * Deliberately small: a per-zone stamp plus a bounded ring of recent tracks.
 */

export interface RecentTrack {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly title: string;
  readonly line2: string;
  readonly artKey: string | null;
  readonly at: string;
}

interface ZoneRecord {
  lastPlayedAt: string | null;
  runStartedAt: string | null;
  lastTitle: string | null;
  wasLive: boolean;
}

const MAX_TRACKS = 120;

export class RecentLedger {
  private readonly zones = new Map<string, ZoneRecord>();
  private tracks: RecentTrack[] = [];
  private readonly path: string | null;
  private dirty = false;

  constructor(dataDir: string | null) {
    this.path = dataDir === null ? null : join(dataDir, 'recent.json');
    this.load();
  }

  lastPlayedAt(zoneId: string): string | null {
    const record = this.zones.get(zoneId);
    return record === undefined ? null : record.lastPlayedAt;
  }

  runStartedAt(zoneId: string): string | null {
    const record = this.zones.get(zoneId);
    return record === undefined ? null : record.runStartedAt;
  }

  recent(limit = 24): RecentTrack[] {
    return this.tracks.slice(0, Math.max(0, limit));
  }

  /**
   * Fed from every projected zone, BEFORE the snapshot is built, so the stamp a
   * zone carries is already current when the Wall orders on it.
   */
  observe(
    zoneId: string, zoneName: string, state: string,
    title: string | null, line2: string, artKey: string | null, at: string,
  ): void {
    const live = state === 'playing' || state === 'loading';
    let record = this.zones.get(zoneId);
    if (record === undefined) {
      record = { lastPlayedAt: null, runStartedAt: null, lastTitle: null, wasLive: false };
      this.zones.set(zoneId, record);
    }
    if (live) {
      record.lastPlayedAt = at;
      if (!record.wasLive) record.runStartedAt = at;
      this.dirty = true;
    }
    // A new title while live is a new track — but "new" has to survive a process
    // restart and a pause/resume, or every run re-logs whatever is playing.
    // Checked against the newest row for THIS zone, not just in-memory state.
    if (live && title !== null && title !== record.lastTitle && !this.alreadyNewest(zoneId, title)) {
      record.lastTitle = title;
      this.tracks.unshift({ zoneId, zoneName, title, line2, artKey, at });
      if (this.tracks.length > MAX_TRACKS) this.tracks.length = MAX_TRACKS;
      this.dirty = true;
    }
    // Deliberately NOT cleared when a zone stops: resuming the same track is the
    // same track, and clearing it here is what made a pause/resume log twice.
    if (live) record.lastTitle = title === null ? record.lastTitle : title;
    record.wasLive = live;
  }

  /** The newest row for a zone, so a restart does not re-log the current track. */
  private alreadyNewest(zoneId: string, title: string): boolean {
    for (const track of this.tracks) {
      if (track.zoneId !== zoneId) continue;
      return track.title === title;
    }
    return false;
  }

  /** Persist at most once per call site; callers throttle. A failed write is never fatal. */
  flush(): void {
    if (!this.dirty || this.path === null) return;
    this.dirty = false;
    const payload = JSON.stringify({
      zones: [...this.zones.entries()].map(([id, r]) => [id, r.lastPlayedAt, r.runStartedAt]),
      tracks: this.tracks,
    });
    try {
      const temp = this.path + '.tmp';
      writeFileSync(temp, payload, 'utf8');
      renameSync(temp, this.path);
    } catch { /* the ledger is a convenience, never a dependency */ }
  }

  private load(): void {
    if (this.path === null) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
      if (Array.isArray(parsed.zones)) {
        for (const entry of parsed.zones) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
          this.zones.set(entry[0], {
            lastPlayedAt: typeof entry[1] === 'string' ? entry[1] : null,
            runStartedAt: typeof entry[2] === 'string' ? entry[2] : null,
            lastTitle: null,
            wasLive: false,
          });
        }
      }
      if (Array.isArray(parsed.tracks)) {
        this.tracks = parsed.tracks.filter((t: unknown): t is RecentTrack =>
          t !== null && typeof t === 'object' && typeof (t as RecentTrack).title === 'string')
          .slice(0, MAX_TRACKS);
        // Re-seed each zone's last title from the newest surviving row, so the
        // first observation after a restart is not mistaken for a track change.
        for (const track of this.tracks) {
          const record = this.zones.get(track.zoneId);
          if (record !== undefined && record.lastTitle === null) record.lastTitle = track.title;
        }
      }
    } catch { /* first run, or a corrupt file: start clean rather than refuse to boot */ }
  }
}
