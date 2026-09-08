/**
 * The FlightDeck wire contract. Faces never see Roon's own shape — this is the
 * only vocabulary the browser knows, so a Roon API change stops here.
 */

export interface ArtRef {
  /** Same-origin opaque path minted by the art relay. Never a Core URL or key. */
  readonly path: string;
  /** Stable identity for the image behind the path, so a client can tell "same art". */
  readonly key: string;
}

export interface SeekRef {
  readonly positionSec: number;
  /** ISO time the position was observed, so the client interpolates from a known instant. */
  readonly at: string;
}

export interface NowPlaying {
  readonly title: string;
  readonly line2: string;
  readonly line3: string;
  readonly art: ArtRef | null;
  /**
   * The artist backdrop. Sourced from Roon's UNDOCUMENTED `artist_image_keys`
   * (185/192 frames on Peter's Core; vanished once in build 880) — always optional,
   * never required; faces fall back to the blurred cover.
   */
  readonly artistArt: ArtRef | null;
  /**
   * Every artist image Roon offers for this track (bounded), at foreground size.
   * Roon ships 1-4 keys and which is the performer rather than the composer has
   * never been verified — so the Face lets a viewer cycle them, which both
   * answers "who is this?" and settles the question on screen.
   */
  readonly artistArts: readonly ArtRef[];
  /**
   * The same sleeve at the puck's own size (320px). A knob decodes the JPEG on
   * its own processor, so it is served what it can draw rather than four times
   * as much; browsers keep using `art`.
   */
  readonly artKnob: ArtRef | null;
  readonly lengthSec: number | null;
  readonly seek: SeekRef | null;
}

export type ZoneState = 'playing' | 'paused' | 'loading' | 'stopped';

/**
 * An output's volume control. Absent when the device has none (a fixed-volume
 * line out), which is why the Face must ask rather than assume.
 *
 * `type: 'incremental'` means "+ and - buttons only, no readout" — min, max,
 * value and step are all absent there, and it takes `relative` ±1 rather than
 * `relative_step`.
 */
export interface OutputVolume {
  readonly type: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly value: number | null;
  readonly step: number | null;
  readonly muted: boolean;
  /**
   * Roon's own Volume Limit for the zone — set in Roon's zone settings, reported
   * on the wire as `soft_limit` (measured on Peter's Core 2026-08-03: `max 100,
   * soft_limit 100` when unset). FlightDeck never duplicates it: screens read it,
   * the wheel cannot ask past it, the scale shows where it lies. Null when Roon
   * did not say.
   */
  readonly softLimit: number | null;
  /** Roon's SAFETY level (`hard_limit_max`): nothing passes it; softLimit is the COMFORT level a double tap may pass. */
  readonly hardLimitMax: number | null;
}

/**
 * The device's own power, as Roon sees it. A Roon Ready amp that has gone to
 * standby keeps its output on the wire but loses its volume object (measured
 * 09-03, a Marantz LINK 10n at 80/80); this is the honest word for that state.
 * `asleep` is Roon's `standby` status; `wakeable` is whether Roon can bring it
 * back, which is what Play does on a sleeping zone in Roon's own app.
 */
export interface OutputPower {
  readonly wakeable: boolean;
  readonly asleep: boolean;
  readonly controlKey: string | null;
}

export interface ZoneOutput {
  readonly id: string;
  readonly name: string;
  readonly volume: OutputVolume | null;
  readonly power: OutputPower | null;
  /**
   * The outputs Roon will let this one join, ITSELF INCLUDED. Roon partitions
   * grouping by protocol — measured on a live Core, 08-26: RAAT with RAAT,
   * AirPlay with AirPlay, Squeezebox with Squeezebox, never across — so this is
   * the only honest way to know what may be offered. Never inferred from a name.
   */
  readonly groupableWith: readonly string[];
  /**
   * Which grouping ISLAND this output belongs to, or '' if it can group with
   * nothing. Roon does not name the protocol anywhere on the wire — an output
   * carries only id, name, volume, source controls, zone and this list — so the
   * relation IS the taxonomy (Peter, 08-26: "can group with — that's the key").
   *
   * It is safe to treat as an equivalence class rather than a neighbour list:
   * measured on a live Core, 22 outputs produced exactly three membership lists,
   * every one closed and identical for all its members. So two outputs share an
   * island exactly when their lists match, and no graph walk is needed.
   */
  readonly island: string;
}

export interface Allowed {
  readonly play: boolean;
  readonly pause: boolean;
  readonly next: boolean;
  readonly previous: boolean;
  readonly seek: boolean;
}

/**
 * How the zone plays through its queue. Roon owns these — they are per-zone and
 * survive us — so they are read from the wire and never held locally.
 */
export interface ZoneSettings {
  readonly shuffle: boolean;
  readonly loop: 'disabled' | 'loop' | 'loop_one';
  readonly autoRadio: boolean;
}

export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly state: ZoneState;
  readonly outputs: readonly ZoneOutput[];
  readonly nowPlaying: NowPlaying | null;
  readonly allowed: Allowed;
  /** Shuffle and repeat, as Roon reports them; null if the Core did not say. */
  readonly settings: ZoneSettings | null;
  /** ISO time this zone last had playback activity — the House Wall's ordering key. */
  readonly lastPlayedAt: string | null;
  /** ISO time the current run of playback began; ties are broken on it so a track change never reshuffles. */
  readonly runStartedAt: string | null;
}

export type CoreState = 'paired' | 'away';

export interface Core {
  readonly state: CoreState;
  readonly name: string | null;
  readonly sinceAt: string;
}

/**
 * A grouping island, with the name someone gave it. Roon names the protocol
 * nowhere — see `src/labels/islands.ts` — so `label` is null until a person says
 * what this one is, and the screen falls back to naming it by its members.
 */
export interface Island {
  readonly id: string;
  readonly label: string | null;
  readonly count: number;
}

export interface Snapshot {
  /**
   * Identity of the SERVER PROCESS. The revision counter restarts from zero when
   * FlightDeck restarts, so a client holding a high revision would otherwise
   * reject every frame the new process sends and freeze until someone reloaded
   * it. A changed generation tells the client to trust what it is being given.
   */
  readonly generation: string;
  /** Bumps on STRUCTURAL change only. Seek rides its own frame and never bumps this. */
  readonly revision: number;
  readonly generatedAt: string;
  readonly core: Core;
  readonly zones: readonly Zone[];
  /** Grouping islands present in this snapshot, largest first. */
  readonly islands: readonly Island[];
}

/** The 1 Hz seek frame: playing zones only, no revision bump. */
export interface SeekFrame {
  readonly generation: string;
  readonly revision: number;
  readonly at: string;
  readonly zones: readonly { readonly id: string; readonly positionSec: number }[];
}
