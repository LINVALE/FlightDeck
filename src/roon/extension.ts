import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { SizeClass } from '../art/relay.ts';
import { SIZES } from '../art/relay.ts';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const RoonApi = require('node-roon-api');
const RoonApiTransport = require('node-roon-api-transport');

export interface ExtensionEvents {
  /** Every zone the Core knows, on every change. FlightDeck is core-wide by design. */
  onZones(zones: unknown[]): void;
  onCore(paired: boolean, name: string | null): void;
}

export interface ExtensionOptions {
  readonly dataDir: string;
  readonly displayVersion: string;
  readonly log?: (message: string) => void;
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
        this.coreHost = null;
        this.events.onCore(false, null);
      },
    });

    api.init_services({ required_services: [RoonApiTransport] });
    api.start_discovery();
    this.api = api;
    log('discovery started — enable "FlightDeck" in Roon Settings → Extensions');
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
