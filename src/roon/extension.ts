import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { SizeClass } from '../art/relay.ts';
import { SIZES } from '../art/relay.ts';
import { QueueGateway } from './queue.ts';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const RoonApi = require('node-roon-api');
const RoonApiTransport = require('node-roon-api-transport');
const RoonApiBrowse = require('node-roon-api-browse');
const RoonApiSettings = require('node-roon-api-settings');

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
  /**
   * Offer a settings page inside Roon (Settings → Extensions → FlightDeck).
   *
   * ⚠️ Providing a service is a change to the registration Roon holds, with the
   * same consequence as changing the required list: Roon PARKS the extension
   * until a human re-enables it. Worth it here — naming the grouping islands
   * wants a real keyboard, and this is where a Roon user looks for an
   * extension's settings — but it costs one click, once.
   */
  readonly settings?: SettingsProvider;
}

export interface SettingsLayout {
  readonly values: Record<string, unknown>;
  readonly layout: readonly unknown[];
  readonly has_error: boolean;
}

export interface SettingsProvider {
  /** The page, built from whatever values Roon has just shown or is proposing. */
  layout(values?: Record<string, unknown>): SettingsLayout;
  /** Called only for a real save, never for Roon's dry run. */
  save(values: Record<string, unknown>): void;
}

/**
 * The Roon half. Registers as a normal extension and subscribes to zones — which
 * is CORE-WIDE for any extension, so FlightDeck serves every Roon zone (RHEOS
 * rooms and Roon Ready rooms alike) and needs nothing from RHEOS.
 *
 * Identity is Peter's ruling of 2026-08-25 and is not a knob.
 */
export class FlightDeckExtension {
  /** One Core-wide owner for the bounded forward queues of all current zones. */
  readonly queue = new QueueGateway();
  private readonly options: ExtensionOptions;
  private readonly events: ExtensionEvents;
  private api: any = null;
  private settingsService: any = null;
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
      email: 'rheos.control@gmail.com',
      website: 'https://github.com/LINVALE',
      // Without this the library prints every MOO frame — tens of KB per restart,
      // including full zone payloads. FlightDeck's own log is the useful one.
      log_level: 'none',

      // The library's default save_config writes config.json into the PROCESS CWD.
      // Pin persistence to DATA_DIR instead, so a service restart from anywhere re-pairs.
      get_persisted_state: (): unknown => this.readState(),
      set_persisted_state: (state: unknown): void => this.writeState(state),

      core_paired: (core: any): void => {
        const transport = core.services.RoonApiTransport;
        this.transport = transport;
        this.queue.reconcile(transport, []);
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

        transport.subscribe_zones((response: string, message: any): void => {
          // A late callback from an old Core must not rebuild its queues inside
          // the replacement Core's epoch.
          if (this.transport !== transport) return;
          if (response === 'Subscribed' && Array.isArray(message?.zones)) {
            this.queue.reconcile(transport, message.zones as unknown[]);
            this.events.onZones(message.zones as unknown[]);
            return;
          }
          if (response === 'Changed') {
            // The library keeps its own merged map; read it back rather than
            // re-implementing the added/changed/removed/seek merge here.
            const zones = transport._zones;
            if (zones !== undefined && zones !== null) {
              const current = Object.values(zones) as unknown[];
              this.queue.reconcile(transport, current);
              this.events.onZones(current);
            }
          }
        });
      },

      core_unpaired: (): void => {
        log('core unpaired');
        this.queue.reconcile(null, []);
        this.transport = null;
        this.browse = null;
        this.coreHost = null;
        this.events.onCore(false, null);
      },
    });

    // Built BEFORE init_services: constructing it is what registers the service.
    let settingsService: any = null;
    const provider = this.options.settings;
    if (provider !== undefined) {
      settingsService = new RoonApiSettings(api, {
        get_settings: (cb: (settings: unknown) => void): void => { cb(provider.layout()); },
        save_settings: (req: any, isDryRun: boolean, settings: any): void => {
          const next = provider.layout(settings?.values ?? {});
          req.send_complete(next.has_error ? 'NotValid' : 'Success', { settings: next });
          // Roon asks twice: once to validate, once for real. Only the second counts.
          if (!isDryRun && !next.has_error) {
            provider.save(next.values);
            settingsService.update_settings(provider.layout());
          }
        },
      });
      this.settingsService = settingsService;
    }

    const services: Record<string, unknown[]> = this.options.browse === true
      ? { required_services: [RoonApiTransport], optional_services: [RoonApiBrowse] }
      : { required_services: [RoonApiTransport] };
    if (settingsService !== null) services.provided_services = [settingsService];
    api.init_services(services);
    api.start_discovery();
    this.api = api;
    log('discovery started — enable "FlightDeck" in Roon Settings → Extensions');
  }

  /** Push a fresh page to anyone with the settings dialog open. */
  refreshSettings(): void {
    const provider = this.options.settings;
    if (this.settingsService === null || provider === undefined) return;
    try { this.settingsService.update_settings(provider.layout()); } catch { /* nobody watching */ }
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
   * ⚖️ START ON PLAY, AS IN ROON (Peter, 09-03). Roon's own Play on a zone whose
   * device is in standby sends a convenience switch first — "taking it out of
   * standby if needed", in the API's words — and that is what this is. It is a
   * no-op on a device that is awake, so it is safe to send ahead of every play.
   */
  standby(outputId: string, controlKey: string): Promise<void> {
    if (!controlKey) return Promise.reject(new Error('source control required'));
    return this.transportCall((transport, done) => transport.standby(outputId, { control_key: controlKey }, done));
  }

  wake(outputId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transport = this.transport;
      if (transport === null) { reject(new Error('core not paired')); return; }
      transport.convenience_switch(outputId, {}, (error: unknown) => {
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
  changeSettings(zoneId: string, settings: { shuffle?: boolean; loop?: 'next'; auto_radio?: boolean }): Promise<void> {
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

  /** Ask Roon to move the source's current queue to a zone or durable output. */
  transferZone(fromZoneId: string, toZoneOrOutputId: string): Promise<void> {
    return this.transportCall(
      (transport, done) => transport.transfer_zone(fromZoneId, toZoneOrOutputId, done));
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
    this.queue.dispose();
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
