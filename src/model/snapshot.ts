import { createHash } from 'node:crypto';
import type { Allowed, ArtRef, Island, NowPlaying, OutputVolume, Snapshot, Zone, ZoneOutput, ZoneSettings, ZoneState, OutputPower } from './types.ts';

/** Mints opaque same-origin art paths. The projection never sees a Core URL or image key. */
export interface ArtMinter {
  pathFor(imageKey: unknown, size: 'cover' | 'bg' | 'hero'): ArtRef | null;
}

/** Per-zone playback recency, owned by the ledger. Roon's API has no history — this is ours. */
export interface RecencyReader {
  lastPlayedAt(zoneId: string): string | null;
  runStartedAt(zoneId: string): string | null;
}

const STATES = new Set<string>(['playing', 'paused', 'loading', 'stopped']);

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function zoneState(value: unknown): ZoneState {
  return typeof value === 'string' && STATES.has(value) ? (value as ZoneState) : 'stopped';
}

/**
 * Roon's `artist_image_keys` is undocumented and disappeared once (build 880).
 * Tolerate undefined, a non-array, and an empty array — forever.
 */
function firstArtistKey(raw: unknown): unknown {
  if (!Array.isArray(raw)) return null;
  const first = raw[0];
  return typeof first === 'string' && first.length > 0 ? first : null;
}

const MAX_ARTIST_IMAGES = 4;

function artistKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    if (keys.indexOf(candidate) !== -1) continue;
    keys.push(candidate);
    if (keys.length >= MAX_ARTIST_IMAGES) break;
  }
  return keys;
}

function projectNowPlaying(raw: unknown, art: ArtMinter, at: string): NowPlaying | null {
  if (raw === null || typeof raw !== 'object') return null;
  const np = raw as Record<string, unknown>;
  const three = (np.three_line ?? {}) as Record<string, unknown>;
  const two = (np.two_line ?? {}) as Record<string, unknown>;
  const one = (np.one_line ?? {}) as Record<string, unknown>;
  const title = str(three.line1, str(two.line1, str(one.line1)));
  if (title === '') return null;
  const position = positive(np.seek_position);
  return {
    title,
    line2: str(three.line2, str(two.line2)),
    line3: str(three.line3),
    art: art.pathFor(np.image_key, 'cover'),
    artistArt: art.pathFor(firstArtistKey(np.artist_image_keys), 'bg'),
    artistArts: artistKeys(np.artist_image_keys)
      .map((key) => art.pathFor(key, 'hero'))
      .filter((ref): ref is ArtRef => ref !== null),
    artKnob: art.pathFor(np.image_key, 'knob'),
    lengthSec: positive(np.length),
    seek: position === null ? null : { positionSec: position, at },
  };
}

function projectVolume(raw: unknown): OutputVolume | null {
  if (raw === null || typeof raw !== 'object') return null;
  const volume = raw as Record<string, unknown>;
  const type = typeof volume.type === 'string' ? volume.type : 'number';
  return {
    type,
    min: positive(volume.min) ?? (typeof volume.min === 'number' ? volume.min : null),
    max: positive(volume.max) ?? (typeof volume.max === 'number' ? volume.max : null),
    value: typeof volume.value === 'number' ? volume.value : null,
    step: typeof volume.step === 'number' ? volume.step : null,
    muted: volume.is_muted === true,
    softLimit: typeof volume.soft_limit === 'number' && Number.isFinite(volume.soft_limit) ? volume.soft_limit : null,
    hardLimitMax: typeof volume.hard_limit_max === 'number' && Number.isFinite(volume.hard_limit_max) ? volume.hard_limit_max : null,
  };
}

/**
 * An island's name is its membership. Hashed only so it is short enough to carry
 * and compare; nothing is inferred from it.
 *
 * ⚖️ AN ISLAND OF ONE IS STILL AN ISLAND (Peter, 09-06: "Study ROON should
 * trigger a new tab"). A Roon Ready device standing alone says it can group
 * with ITSELF and nothing else — that is still a family (the registry then
 * finds the family it was last seen in, by that one member, so the tab keeps
 * its name). Only an output that names no peer at all — Roon's word for a
 * device that cannot group right now, asleep or otherwise — gets no island.
 * (Until 09-06 a lone output got none, and the Wall's tabs vanished with it.)
 */
export function islandOf(peers: readonly string[]): string {
  if (peers.length === 0) return '';
  return createHash('sha1').update([...peers].sort().join(',')).digest('hex').slice(0, 8);
}

/**
 * Roon lists a device's power under `source_controls`; the one that matters is
 * the first that supports standby. `status` is one of selected | deselected |
 * standby | indeterminate — only `standby` is "asleep" for certain.
 */
function projectPower(raw: unknown): OutputPower | null {
  if (!Array.isArray(raw)) return null;
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const control = candidate as Record<string, unknown>;
    if (control.supports_standby !== true) continue;
    return {
      wakeable: true,
      asleep: control.status === 'standby',
      controlKey: typeof control.control_key === 'string' ? control.control_key : null,
    };
  }
  return null;
}

function projectOutputs(raw: unknown): ZoneOutput[] {
  if (!Array.isArray(raw)) return [];
  const outputs: ZoneOutput[] = [];
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const output = candidate as Record<string, unknown>;
    const id = str(output.output_id);
    if (id === '') continue;
    const peers = Array.isArray(output.can_group_with_output_ids)
      ? output.can_group_with_output_ids.filter((v): v is string => typeof v === 'string')
      : [];
    outputs.push({
      id, name: str(output.display_name, id), volume: projectVolume(output.volume),
      power: projectPower(output.source_controls),
      groupableWith: peers, island: islandOf(peers),
    });
  }
  return outputs;
}

function projectAllowed(zone: Record<string, unknown>): Allowed {
  return {
    play: bool(zone.is_play_allowed),
    pause: bool(zone.is_pause_allowed),
    next: bool(zone.is_next_allowed),
    previous: bool(zone.is_previous_allowed),
    seek: bool(zone.is_seek_allowed),
  };
}

const LOOPS = ['disabled', 'loop', 'loop_one'] as const;

function projectSettings(raw: unknown): ZoneSettings | null {
  if (raw === null || typeof raw !== 'object') return null;
  const settings = raw as Record<string, unknown>;
  const loop = String(settings.loop ?? '');
  return {
    shuffle: settings.shuffle === true,
    loop: (LOOPS as readonly string[]).includes(loop) ? (loop as ZoneSettings['loop']) : 'disabled',
    autoRadio: settings.auto_radio === true,
  };
}

export function projectZone(raw: unknown, art: ArtMinter, recency: RecencyReader, at: string): Zone | null {
  if (raw === null || typeof raw !== 'object') return null;
  const zone = raw as Record<string, unknown>;
  const id = str(zone.zone_id);
  if (id === '') return null;
  return {
    id,
    name: str(zone.display_name, id),
    state: zoneState(zone.state),
    outputs: projectOutputs(zone.outputs),
    nowPlaying: projectNowPlaying(zone.now_playing, art, at),
    allowed: projectAllowed(zone),
    settings: projectSettings(zone.settings),
    lastPlayedAt: recency.lastPlayedAt(id),
    runStartedAt: recency.runStartedAt(id),
  };
}

/**
 * Order for the House Wall: MOST RECENTLY PLAYED first (Peter's ruling 08-25).
 * A playing or loading zone counts as "now"; ties break on the run start, so a
 * track change never reshuffles the wall. Zones that never played sink to the end,
 * ordered by name so the tail is stable rather than arbitrary.
 */
export function orderByRecency(zones: readonly Zone[], now: number): Zone[] {
  const live = (zone: Zone): boolean => zone.state === 'playing' || zone.state === 'loading';
  // A zone that never played ranks below every real timestamp. A SENTINEL, not
  // -Infinity: an infinite delta is not finite, so it would fall through the
  // comparison below and sort such a zone by name among the played ones.
  const NEVER = -1;
  const rank = (zone: Zone): number => {
    if (live(zone)) return now;
    const at = zone.lastPlayedAt === null ? NaN : Date.parse(zone.lastPlayedAt);
    return Number.isFinite(at) ? at : NEVER;
  };
  return [...zones].sort((left, right) => {
    const delta = rank(right) - rank(left);
    if (delta !== 0) return delta;
    if (live(left) !== live(right)) return live(right) ? 1 : -1;
    if (live(left) && live(right)) {
      const ls = left.runStartedAt === null ? 0 : Date.parse(left.runStartedAt);
      const rs = right.runStartedAt === null ? 0 : Date.parse(right.runStartedAt);
      if (rs !== ls) return rs - ls;
    }
    return left.name.localeCompare(right.name);
  });
}

export interface SnapshotInput {
  readonly generation: string;
  readonly zones: readonly unknown[];
  readonly coreName: string | null;
  readonly corePaired: boolean;
  readonly coreSinceAt: string;
  readonly revision: number;
  readonly at: string;
  /**
   * Turns an island's membership into a STABLE id and whatever name it has.
   * Passed in rather than computed because identity has to survive a device going
   * to sleep — see `src/labels/islands.ts`. Absent, islands are keyed by their
   * membership and unnamed.
   */
  readonly resolveIsland?: (members: readonly string[], membershipHash: string) => { id: string; label: string | null };
  /** Every island ever seen, so its stable identity and label survive every device sleeping. */
  readonly knownIslands?: readonly { id: string; label: string | null }[];
}

export function buildSnapshot(input: SnapshotInput, art: ArtMinter, recency: RecencyReader): Snapshot {
  const projected: Zone[] = [];
  for (const raw of input.zones) {
    const zone = projectZone(raw, art, recency, input.at);
    if (zone !== null) projected.push(zone);
  }
  const resolved = resolveAll(projected, input.resolveIsland);
  return {
    generation: input.generation,
    revision: input.revision,
    generatedAt: input.at,
    core: {
      state: input.corePaired ? 'paired' : 'away',
      name: input.coreName,
      sinceAt: input.coreSinceAt,
    },
    zones: orderByRecency(stampIslands(projected, resolved), Date.parse(input.at) || Date.now()),
    islands: islandsFrom(resolved, input.knownIslands),
  };
}

function islandsFrom(
  resolved: Map<string, { id: string; label: string | null; count: number }>,
  known?: readonly { id: string; label: string | null }[],
): Island[] {
  const islands: Island[] = [];
  const seen = new Set<string>();
  for (const entry of resolved.values()) {
    if (entry.id === '') continue;        // the registry is full; not drawn rather than mis-drawn
    islands.push({ id: entry.id, count: entry.count, label: entry.label });
    seen.add(entry.id);
  }
  /**
   * A family whose every device is asleep leaves Roon's zone list entirely. It
   * remains in the model with count zero so identity and its chosen label are not
   * forgotten; display clients may omit it while it has no active destination.
   */
  for (const entry of known ?? []) {
    if (entry.id === '' || seen.has(entry.id)) continue;
    islands.push({ id: entry.id, count: 0, label: entry.label });
  }
  return islands.sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
}

/**
 * The islands present, largest first — a stable order, because it does not move
 * as the music does. A zone belongs to the island of its first output: every
 * output of a grouped zone is necessarily in the same one, or Roon could not have
 * grouped them.
 */
/**
 * Resolve every island present, ONCE, so the same identity is used for the tabs
 * and for the outputs. Publishing two kinds of island id was a real defect: the
 * tabs carried the registry's id (`i1`) while an output carried the membership
 * HASH, and `wall.js` compared the two. It only ever worked on a box whose
 * label file predated the registry, because that migration adopted the hashes as
 * ids. On a clean install every tab filtered to nothing.
 */
function resolveAll(
  zones: readonly Zone[],
  resolve?: (members: readonly string[], membershipHash: string) => { id: string; label: string | null },
): Map<string, { id: string; label: string | null; count: number }> {
  const members = new Map<string, readonly string[]>();
  const counts = new Map<string, number>();
  for (const zone of zones) {
    if (zone.outputs.length === 0) continue;
    const hash = zone.outputs[0].island;
    if (hash === '') continue;
    if (!members.has(hash)) members.set(hash, zone.outputs[0].groupableWith);
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  const out = new Map<string, { id: string; label: string | null; count: number }>();
  for (const [hash, list] of members) {
    const resolved = resolve === undefined ? { id: hash, label: null } : resolve(list, hash);
    out.set(hash, { ...resolved, count: counts.get(hash) ?? 0 });
  }
  return out;
}

/** Restamp each output with the RESOLVED island id, so the wire carries one identity. */
function stampIslands(
  zones: readonly Zone[],
  resolved: Map<string, { id: string; label: string | null; count: number }>,
): Zone[] {
  return zones.map((zone) => ({
    ...zone,
    outputs: zone.outputs.map((output) => ({
      ...output,
      island: output.island === '' ? '' : (resolved.get(output.island)?.id ?? ''),
    })),
  }));
}

export function collectIslands(
  zones: readonly Zone[],
  resolve?: (members: readonly string[], membershipHash: string) => { id: string; label: string | null },
): Island[] {
  return islandsFrom(resolveAll(zones, resolve));
}

/**
 * Structural signature: everything EXCEPT seek position. The revision bumps only
 * when this changes, so a 1 Hz seek tick never invalidates a client's snapshot.
 */
export function structuralSignature(snapshot: Snapshot): string {
  const parts = snapshot.zones.map((zone) => [
    zone.id, zone.name, zone.state,
    // the output LIST is the group: forming or dissolving one must redraw
    zone.outputs.map((output) => output.id + ':' + output.name
      + ':' + (output.volume === null ? '-' : String(output.volume.value) + '/' + String(output.volume.muted))).join(','),
    zone.nowPlaying === null ? '-' : [
      zone.nowPlaying.title, zone.nowPlaying.line2, zone.nowPlaying.line3,
      zone.nowPlaying.art === null ? '-' : zone.nowPlaying.art.key,
      zone.nowPlaying.artistArt === null ? '-' : zone.nowPlaying.artistArt.key,
      zone.nowPlaying.artistArts.map((ref) => ref.key).join('+'),
      String(zone.nowPlaying.lengthSec),
    ].join('|'),
    [zone.allowed.play, zone.allowed.pause, zone.allowed.next, zone.allowed.previous, zone.allowed.seek].join(''),
    // shuffle and repeat are drawn as lit or unlit buttons, so a change to either
    // has to reach the screen — without this the toggle would appear to do nothing
    zone.settings === null ? '-' : String(zone.settings.shuffle) + '/' + zone.settings.loop,
    String(zone.lastPlayedAt),
  ].join('~'));
  // A renamed island must reach every screen, not just the one that renamed it.
  const named = snapshot.islands.map((i) => i.id + '=' + String(i.label)).join(',');
  return snapshot.core.state + '#' + String(snapshot.core.name) + '#' + named + '#' + parts.join(';');
}
