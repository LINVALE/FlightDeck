import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NAMES FOR THE GROUPING ISLANDS, AND STABLE IDENTITY FOR THEM.
 *
 * Roon partitions grouping by protocol and names it nowhere. Measured on a live
 * Core, 08-26: an output carries `output_id`, `zone_id`, `display_name`, `volume`,
 * `can_group_with_output_ids` and `source_controls` — and `source_controls` names
 * the DEVICE ("Marantz LINK 10n", "Study (RHEOS)"), never the transport. There is
 * no MAC, no protocol field, and `subscribe_outputs` carries nothing extra. So the
 * label cannot be derived; it is stated once by a person and kept here.
 *
 * ⚠️ THE FIRST VERSION OF THIS WAS NOT RELIABLE, which is the whole reason this
 * class exists. It keyed the name on a hash of the island's membership — and a
 * device that goes to sleep leaves Roon's zone list, so the membership changes,
 * so the hash changes, so the name silently reverts to "type 1" and the screen's
 * remembered tab breaks. On a house of sixteen HEOS rooms that is not an edge
 * case, it is Tuesday.
 *
 * An island is therefore identified by OVERLAP, not by equality. Roon's islands
 * are disjoint — an output belongs to exactly one — so a single output still in
 * common is unambiguous proof it is the same island, however many of its
 * neighbours are asleep. The stored membership is the UNION of everything ever
 * seen in the island, so a device is still remembered while it sleeps; a device
 * that genuinely moves island is taken off every other record as it is claimed.
 */

const MAX_LABEL = 24;
const MAX_ISLANDS = 32;

interface IslandRecord {
  id: string;
  label: string | null;
  members: string[];
  /** Only set by the legacy migration, and only until the record is next seen. */
  legacyKey?: string;
}

export interface ResolvedIsland {
  readonly id: string;
  readonly label: string | null;
}

function normalise(members: readonly string[]): string[] {
  return [...new Set(members)].sort();
}

export class IslandRegistry {
  private records: IslandRecord[] = [];
  private next = 1;
  private readonly path: string | null;

  constructor(dataDir: string | null) {
    this.path = dataDir === null ? null : join(dataDir, 'island-labels.json');
    this.load();
  }

  private load(): void {
    if (this.path === null) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return;                       // no file yet: an unnamed house is a fine start
    }
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        if (id === '') continue;
        this.records.push({
          id,
          label: typeof record.label === 'string' && record.label !== '' ? record.label : null,
          members: Array.isArray(record.members)
            ? record.members.filter((m): m is string => typeof m === 'string') : [],
        });
      }
    } else if (raw !== null && typeof raw === 'object') {
      // The first format was { membershipHash: label } and kept no members at all.
      // Carried over so nobody has to retype a name, and matched once by that hash.
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string' || value === '') continue;
        this.records.push({ id: key, label: value.slice(0, MAX_LABEL), members: [], legacyKey: key });
      }
    }
    for (const record of this.records) {
      const n = /^i(\d+)$/.exec(record.id);
      if (n !== null) this.next = Math.max(this.next, Number(n[1]) + 1);
    }
  }

  private save(): void {
    if (this.path === null) return;
    try {
      const temp = this.path + '.tmp';
      writeFileSync(temp, JSON.stringify(
        this.records.map((r) => ({ id: r.id, label: r.label, members: r.members })), null, 2));
      renameSync(temp, this.path);   // atomic: a half-written file loses every name
    } catch {
      // read-only data dir: the names live for this run and no longer
    }
  }

  /**
   * The island these outputs belong to, remembering it if it is new. `legacyHash`
   * lets a name written by the first format be claimed once, after which the
   * record has real members and never needs it again.
   */
  resolve(members: readonly string[], legacyHash?: string): ResolvedIsland {
    const wanted = normalise(members);
    if (wanted.length === 0) return { id: '', label: null };

    let best: IslandRecord | null = null;
    let bestOverlap = 0;
    for (const record of this.records) {
      let overlap = 0;
      for (const member of record.members) if (wanted.includes(member)) overlap += 1;
      if (overlap > bestOverlap) { best = record; bestOverlap = overlap; }
    }
    if (best === null && legacyHash !== undefined) {
      best = this.records.find((r) => r.legacyKey === legacyHash) ?? null;
    }

    if (best === null) {
      if (this.records.length >= MAX_ISLANDS) return { id: '', label: null };
      best = { id: 'i' + String(this.next), label: null, members: [] };
      this.next += 1;
      this.records.push(best);
    }

    /**
     * The membership is a UNION of everything ever seen in this island, not the
     * latest snapshot. Replacing it was the same bug one level down: resolving a
     * house with one room asleep dropped that room from the record, so when it
     * woke alone it matched nothing and became a new island.
     *
     * A device that genuinely MOVES island — re-provisioned onto another
     * transport — is handled by taking it off every other record here, so the two
     * can never both claim it.
     */
    const before = this.records.map((r) => r.id + ':' + r.members.join(',')).join('|');
    for (const record of this.records) {
      if (record === best) continue;
      record.members = record.members.filter((m) => !wanted.includes(m));
    }
    for (const member of wanted) if (!best.members.includes(member)) best.members.push(member);
    best.members.sort();
    if (best.legacyKey !== undefined) delete best.legacyKey;
    if (before !== this.records.map((r) => r.id + ':' + r.members.join(',')).join('|')) this.save();
    return { id: best.id, label: best.label };
  }

  /**
   * Every island ever seen, awake or not. The Wall needs this because a family
   * whose devices are all asleep vanishes from Roon's zone list completely — and
   * a tab bar that erases the families you own the moment they sleep is worse
   * than useless, it looks broken. The registry already remembers them; this
   * just says so.
   */
  known(): { id: string; label: string | null }[] {
    return this.records.map((r) => ({ id: r.id, label: r.label }));
  }

  label(id: string): string | null {
    return this.records.find((r) => r.id === id)?.label ?? null;
  }

  /** An empty name clears it, which is how a screen undoes a rename. */
  setLabel(id: string, label: string): boolean {
    const record = this.records.find((r) => r.id === id);
    if (record === undefined) return false;
    const clean = label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
    record.label = clean === '' ? null : clean;
    this.save();
    return true;
  }
}
