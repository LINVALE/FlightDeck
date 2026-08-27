import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NAMES FOR THE GROUPING ISLANDS.
 *
 * Roon partitions grouping by protocol and names it nowhere. Measured on a live
 * Core, 08-26: an output carries `output_id`, `zone_id`, `display_name`, `volume`,
 * `can_group_with_output_ids` and `source_controls` — and `source_controls` names
 * the DEVICE ("Marantz LINK 10n", "Study (RHEOS)"), never the transport. There is
 * no MAC, no protocol field, and `subscribe_outputs` carries nothing extra.
 *
 * So the label cannot be derived. It can be KNOWN, though — Peter knows perfectly
 * well which of his three is Roon Ready, which is Squeezebox and which is the
 * AirPlay one — so it is stored here rather than guessed, keyed by the island's
 * own identity (the hash of its membership) and shared by every screen.
 *
 * A membership that changes is a different island and quietly loses its name.
 * That is correct: the name described a set, and the set is gone.
 */

const MAX_LABEL = 24;
const MAX_ISLANDS = 32;

export class IslandLabels {
  private labels = new Map<string, string>();
  private readonly path: string | null;

  constructor(dataDir: string | null) {
    this.path = dataDir === null ? null : join(dataDir, 'island-labels.json');
    this.load();
  }

  private load(): void {
    if (this.path === null) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (raw === null || typeof raw !== 'object') return;
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string' && value !== '') this.labels.set(id, value.slice(0, MAX_LABEL));
      }
    } catch {
      // no file yet, or an unreadable one: unnamed islands are a fine starting state
    }
  }

  private save(): void {
    if (this.path === null) return;
    const out: Record<string, string> = {};
    for (const [id, label] of this.labels) out[id] = label;
    try {
      const temp = this.path + '.tmp';
      writeFileSync(temp, JSON.stringify(out, null, 2));
      renameSync(temp, this.path);       // atomic: a half-written file loses every name
    } catch {
      // read-only data dir: the names live for this run and no longer
    }
  }

  get(id: string): string | null {
    return this.labels.get(id) ?? null;
  }

  all(): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, label] of this.labels) out[id] = label;
    return out;
  }

  /** An empty name clears it, which is how a screen undoes a rename. */
  set(id: string, label: string): void {
    const clean = label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
    if (id === '') return;
    if (clean === '') this.labels.delete(id);
    else {
      if (!this.labels.has(id) && this.labels.size >= MAX_ISLANDS) return;
      this.labels.set(id, clean);
    }
    this.save();
  }
}
