import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { SizeClass } from '../art/relay.ts';
import { SIZES } from '../art/relay.ts';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const RoonApi = require('node-roon-api');
const RoonApiTransport = require('node-roon-api-transport');
const RoonApiBrowse = require('node-roon-api-browse');

export interface ExtensionEvents {
  /** Every zone the Core knows, on every change. FlightDeck is core-wide by design. */
  onZones(zones: unknown[]): void;
  onCore(paired: boolean, name: string | null): void;
}

export interface ExtensionOptions {
  readonly dataDir: string;
  readonly displayVersion: string;
  readonly log?: (message: string) => void;
  /**
   * Request the Browse service (library browse, genres, search).
   *
   * ⚠️ OFF by default, and that is not timidity. Changing the service list
   * changes the registration Roon has on file, and Roon then PARKS the
   * extension until a human re-enables it in Settings → Extensions. Turning
   * this on without warning silently kills every screen in the house until
   * someone clicks. Proven the hard way on 2026-08-25.
   */
  readonly browse?: boolean;
}

/**
 * The Roon half. Registers as a normal extension and subscribes to zones — which
 * is CORE-WIDE for any extension, so FlightDeck serves every Roon zone (RHEOS
 * rooms and Roon Ready rooms alike) and needs nothing from RHEOS.
 *
 * Identity is Peter's ruling of 2026-08-25 and is not a knob.
 */
export class FlightDeckExtension {
  private readonly options: ExtensionOptions;
  private readonly events: ExtensionEvents;
  private api: any = null;
  private transport: any = null;
  private browse: any = null;
  private coreHost: string | null = null;
  private coreHttpPort = 9330;

  constructor(options: ExtensionOptions, events: ExtensionEvents) {
    this.options = options;
    this.events = events;
    try { mkdirSync(options.dataDir, { recursive: true }); } catch { /* exists */ }
  }

  /**
   * The Core's artwork endpoint. Derived from the live pairing, NEVER hardcoded —
   * the RHEOS pattern (packages/v4/src/RoonHub.mjs:300-305).
   */
  artworkUrl = (imageKey: string, size: SizeClass): string => {
    if (this.coreHost === null || imageKey === '') return '';
    const spec = SIZES[size];
    return 'http://' + this.coreHost + ':' + String(this.coreHttpPort)
      + '/api/image/' + imageKey
      + '?scale=' + spec.scale + '&width=' + String(spec.width) + '&height=' + String(spec.height);
  };

  start(): void {
    const log = this.options.log ?? ((): void => {});
    const api = new RoonApi({
      extension_id: 'linvale.FlightDeck',
      display_name: 'FlightDeck',
      display_version: this.options.displayVersion,
      publisher: 'Linvale',
      email: 'dr.pcrichardson@gmail.com',
      website: 'https://github.com/LINVALE',
      // Without this the library prints every MOO frame — tens of KB per restart,
      // including full zone payloads. FlightDeck's own log is the useful one.
      log_level: 'none',

      // The library's default save_config writes config.json into the PROCESS CWD.
      // Pin persistence to DATA_DIR instead, so a service restart from anywhere re-pairs.
      get_persisted_state: (): unknown => this.readState(),
      set_persisted_state: (state: unknown): void => this.writeState(state),

      core_paired: (core: any): void => {
        this.transport = core.services.RoonApiTransport;
        this.browse = core.services.RoonApiBrowse ?? null;
        if (this.options.browse === true) log('browse service: ' + (this.browse === null ? 'NOT granted' : 'granted'));
        const rawHost = core.moo?.transport?.host ?? null;
        const loopback = rawHost === '127.0.0.1' || rawHost === '::1' || rawHost === 'localhost';
        this.coreHost = loopback ? '127.0.0.1' : rawHost;
        const port = Number(core.registration?.http_port);
        this.coreHttpPort = Number.isFinite(port) && port > 0 ? port : 9330;
        const name = typeof core.display_name === 'string' ? core.display_name : null;
        log('core paired: ' + String(name) + ' @ ' + String(this.coreHost) + ':' + String(this.coreHttpPort));
        this.events.onCore(true, name);

        this.transport.subscribe_zones((response: string, message: any): void => {
          if (response === 'Subscribed' && Array.isArray(message?.zones)) {
            this.events.onZones(message.zones as unknown[]);
            return;
          }
          if (response === 'Changed') {
            // The library keeps its own merged map; read it back rather than
            // re-implementing the added/changed/removed/seek merge here.
            const zones = this.transport._zones;
            if (zones !== undefined && zones !== null) {
              this.events.onZones(Object.values(zones) as unknown[]);
            }
          }
        });
      },

      core_unpaired: (): void => {
        log('core unpaired');
        this.transport = null;
        this.browse = null;
        this.coreHost = null;
        this.events.onCore(false, null);
      },
    });

    api.init_services(this.options.browse === true
      ? { required_services: [RoonApiTransport], optional_services: [RoonApiBrowse] }
      : { required_services: [RoonApiTransport] });
    api.start_discovery();
    this.api = api;
    log('discovery started — enable "FlightDeck" in Roon Settings → Extensions');
  }

  /** The Browse service, or null when not requested or not granted. */
  browseService(): any { return this.browse; }

  /**
   * A user's gesture, translated into a Roon-led instruction. FlightDeck never
   * drives a device directly: Roon owns the queue, the cursor and now-playing, so
   * every control here goes to the Core and the state comes back on the ordinary
   * zone subscription. Nothing is optimistically applied.
   */
  control(zoneId: string, action: 'play' | 'pause' | 'playpause' | 'next' | 'previous' | 'stop'): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = this.transport;
      if (transport === null) { reject(new Error('core not paired')); return; }
      transport.control(zoneId, action, (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  /**
   * Volume acts on ONE OUTPUT — the speaker in that room (Peter's ruling 08-25) —
   * never on the zone, so a screen in the study cannot turn up a whole grouped
   * house.
   *
   * `relative_step` moves by the device's own step. An `incremental` control has
   * no readout or step at all and takes `relative` ±1 instead; sending it a step
   * would be meaningless.
   */
  changeVolume(outputId: string, steps: number, incremental: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = this.transport;
      if (transport === null) { reject(new Error('core not paired')); return; }
      const how = incremental ? 'relative' : 'relative_step';
      const value = incremental ? (steps > 0 ? 1 : -1) : steps;
      transport.change_volume(outputId, how, value, (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  /** Absolute position in seconds. Roon refuses it where seeking makes no sense. */
  /**
   * Shuffle and repeat. Roon owns both, per zone, and `loop: 'next'` asks the
   * Core itself to cycle disabled -> loop -> loop_one — so the button never has
   * to guess the order, and two screens pressing it cannot disagree.
   */
  changeSettings(zoneId: string, settings: { shuffle?: boolean; loop?: 'next' }): Promise<void> {
    const transport = this.transport;
    if (transport === null) return Promise.reject(new Error('no core'));
    return new Promise((resolve, reject) => {
      transport.change_settings(zoneId, settings, (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  /**
   * Form a group. The ORDER matters and is not ours to choose lightly: Roon
   * preserves "the first output's zone's queue", so the head of this list is the
   * room whose music the others join. Everything else's queue is discarded.
   */
  groupOutputs(outputIds: readonly string[]): Promise<void> {
    return this.transportCall((transport, done) => transport.group_outputs(outputIds.slice(), done));
  }

  /**
   * Dissolve a group. Kept to ONE call for the whole set on purpose: Roon tears a
   * Squeezebox grouped zone down on every ungroup, so repeated calls are repeated
   * damage rather than a more thorough job.
   */
  ungroupOutputs(outputIds: readonly string[]): Promise<void> {
    return this.transportCall((transport, done) => transport.ungroup_outputs(outputIds.slice(), done));
  }

  /** Move what is playing from one zone to another, queue and position intact. */
  transferZone(fromZoneId: string, toZoneId: string): Promise<void> {
    return this.transportCall((transport, done) => transport.transfer_zone(fromZoneId, toZoneId, done));
  }

  private transportCall(run: (transport: any, done: (error: unknown) => void) => void): Promise<void> {
    const transport = this.transport;
    if (transport === null) return Promise.reject(new Error('no core'));
    return new Promise((resolve, reject) => {
      run(transport, (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  seek(zoneId: string, seconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = this.transport;
      if (transport === null) { reject(new Error('core not paired')); return; }
      transport.seek(zoneId, 'absolute', Math.max(0, Math.round(seconds)), (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  /** An exact level, for a scale you press rather than step. */
  setVolume(outputId: string, value: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = this.transport;
      if (transport === null) { reject(new Error('core not paired')); return; }
      transport.change_volume(outputId, 'absolute', value, (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  mute(outputId: string, muted: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = this.transport;
      if (transport === null) { reject(new Error('core not paired')); return; }
      transport.mute(outputId, muted ? 'mute' : 'unmute', (error: unknown) => {
        if (error === false || error === undefined || error === null) resolve();
        else reject(new Error(String(error)));
      });
    });
  }

  stop(): void {
    try { this.api?.stop_discovery?.(); } catch { /* best effort */ }
  }

  private statePath(): string {
    return join(this.options.dataDir, 'roon-state.json');
  }

  private readState(): unknown {
    try { return JSON.parse(readFileSync(this.statePath(), 'utf8')); } catch { return {}; }
  }

  private writeState(state: unknown): void {
    try {
      const temp = this.statePath() + '.tmp';
      writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
      renameSync(temp, this.statePath());
    } catch { /* an unwritable data dir surfaces at pairing, not here */ }
  }
}
