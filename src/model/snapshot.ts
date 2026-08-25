import type { Allowed, ArtRef, NowPlaying, Snapshot, Zone, ZoneOutput, ZoneState } from './types.ts';

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
    lengthSec: positive(np.length),
    seek: position === null ? null : { positionSec: position, at },
  };
}

function projectOutputs(raw: unknown): ZoneOutput[] {
  if (!Array.isArray(raw)) return [];
  const outputs: ZoneOutput[] = [];
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const output = candidate as Record<string, unknown>;
    const id = str(output.output_id);
    if (id === '') continue;
    outputs.push({ id, name: str(output.display_name, id) });
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
  readonly zones: readonly unknown[];
  readonly coreName: string | null;
  readonly corePaired: boolean;
  readonly coreSinceAt: string;
  readonly revision: number;
  readonly at: string;
}

export function buildSnapshot(input: SnapshotInput, art: ArtMinter, recency: RecencyReader): Snapshot {
  const projected: Zone[] = [];
  for (const raw of input.zones) {
    const zone = projectZone(raw, art, recency, input.at);
    if (zone !== null) projected.push(zone);
  }
  return {
    revision: input.revision,
    generatedAt: input.at,
    core: {
      state: input.corePaired ? 'paired' : 'away',
      name: input.coreName,
      sinceAt: input.coreSinceAt,
    },
    zones: orderByRecency(projected, Date.parse(input.at) || Date.now()),
  };
}

/**
 * Structural signature: everything EXCEPT seek position. The revision bumps only
 * when this changes, so a 1 Hz seek tick never invalidates a client's snapshot.
 */
export function structuralSignature(snapshot: Snapshot): string {
  const parts = snapshot.zones.map((zone) => [
    zone.id, zone.name, zone.state,
    zone.outputs.map((output) => output.id + ':' + output.name).join(','),
    zone.nowPlaying === null ? '-' : [
      zone.nowPlaying.title, zone.nowPlaying.line2, zone.nowPlaying.line3,
      zone.nowPlaying.art === null ? '-' : zone.nowPlaying.art.key,
      zone.nowPlaying.artistArt === null ? '-' : zone.nowPlaying.artistArt.key,
      zone.nowPlaying.artistArts.map((ref) => ref.key).join('+'),
      String(zone.nowPlaying.lengthSec),
    ].join('|'),
    [zone.allowed.play, zone.allowed.pause, zone.allowed.next, zone.allowed.previous, zone.allowed.seek].join(''),
    String(zone.lastPlayedAt),
  ].join('~'));
  return snapshot.core.state + '#' + String(snapshot.core.name) + '#' + parts.join(';');
}
