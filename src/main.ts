import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { ArtRelay } from './art/relay.ts';
import { EventHub } from './http/events.ts';
import { FlightDeckExtension } from './roon/extension.ts';
import { BrowseGateway } from './roon/browse.ts';
import { MdnsResponder } from './net/mdns.ts';
import { DisplayRegistry } from './displays/registry.ts';
import { IslandRegistry } from './labels/islands.ts';
import { RecentLedger } from './ledger/recent.ts';
import { buildSnapshot, structuralSignature } from './model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from './http/server.ts';
import { PullCoordinator } from './control/pull.ts';
import { HOST_SWITCH_POLL_MS, readHostSwitch, waitWhileSwitchedOff } from './host-switch.ts';
import { buildSettingsLayout, saveSettingsValues } from './settings.ts';
import type { SeekFrame, Snapshot } from './model/types.ts';
import { networkInterfaces } from 'node:os';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DATA_DIR = resolve(process.env.FLIGHTDECK_DATA ?? resolve(HERE, '..', 'data'));
const ASSET_DIR = resolve(HERE, '..', 'assets');
const DOC_DIR = resolve(HERE, '..', 'docs');
const HOSTNAME = process.env.FLIGHTDECK_NAME ?? 'flightdeck';
/**
 * The port ladder: 80 first, because only :80 makes a bare hostname work.
 * Deduped — an explicit FLIGHTDECK_PORT=8440 used to build [8440, 8440] and the
 * log would claim it was "trying the next" while retrying the same port.
 */
const ALT_PORT = 8440;
const PORTS = [...new Set(
  process.env.FLIGHTDECK_PORT === undefined
    ? [80, 8440]
    : [Number(process.env.FLIGHTDECK_PORT), 8440],
)].filter((port) => Number.isInteger(port) && port >= 0 && port <= 65535);

function stamp(): string { return new Date().toISOString(); }
function log(message: string): void { process.stdout.write(stamp() + '  ' + message + '\n'); }

mkdirSync(DATA_DIR, { recursive: true });

const ledger = new RecentLedger(DATA_DIR);
const islands = new IslandRegistry(DATA_DIR);
const displays = new DisplayRegistry(DATA_DIR);
const hub = new EventHub();

let rawZones: unknown[] = [];
let corePaired = false;
let coreName: string | null = null;
let coreSinceAt = stamp();
let revision = 0;
let signature = '';
/** New on every start: what tells a client its held revision is from a dead process. */
const GENERATION = randomBytes(8).toString('hex');
let boundPort = 0;
let altPort = 0;
let mdns: MdnsResponder | null = null;

const BROWSE = process.env.FLIGHTDECK_BROWSE === '1';

const extension = new FlightDeckExtension(
  {
    dataDir: DATA_DIR, displayVersion: '0.1.0', log,
    // Opt-in: turning this on changes the registration, and Roon then parks the
    // extension until someone re-enables it in Settings.
    browse: BROWSE,
    /**
     * ⚠️ Providing a service changes the registration Roon holds, and Roon PARKS
     * the extension until a human re-enables it in Settings → Extensions. Peter
     * asked for it on 08-26 knowing that, so the click is expected — but it is
     * the reason this cannot be switched on quietly in someone else's house.
     */
    settings: { layout: (values) => settingsLayout(values), save: saveSettings },
  },
  {
    onZones: (zones: unknown[]): void => { rawZones = zones; republish(); },
    onCore: (paired: boolean, name: string | null): void => {
      corePaired = paired;
      coreName = name;
      coreSinceAt = stamp();
      if (!paired) rawZones = [];
      republish();
    },
  },
);

const relay = new ArtRelay({ artworkUrl: extension.artworkUrl });
// Both HTTP listeners share this one transport owner. Two coordinators would let
// the same gesture race through :80 and :8440 as independent transactions.
const pull = new PullCoordinator({ snapshots: hub, commands: extension });
// Present only when Browse was requested at startup; the route answers 503 otherwise.
const browseGateway = new BrowseGateway(() => extension.browseService());

/**
 * One snapshot per change. The revision bumps ONLY when the structural signature
 * moves, so a 1 Hz seek tick never invalidates a client's snapshot — seek rides
 * its own frame instead.
 */
function republish(): void {
  const at = stamp();
  for (const raw of rawZones) {
    if (raw === null || typeof raw !== 'object') continue;
    const zone = raw as Record<string, unknown>;
    const id = typeof zone.zone_id === 'string' ? zone.zone_id : null;
    if (id === null) continue;
    const np = (zone.now_playing ?? null) as Record<string, unknown> | null;
    const three = (np?.three_line ?? {}) as Record<string, unknown>;
    ledger.observe(
      id,
      typeof zone.display_name === 'string' ? zone.display_name : id,
      typeof zone.state === 'string' ? zone.state : 'stopped',
      typeof three.line1 === 'string' ? three.line1 : null,
      typeof three.line2 === 'string' ? three.line2 : '',
      typeof np?.image_key === 'string' ? np.image_key : null,
      at,
      typeof three.line3 === 'string' ? three.line3 : '',
    );
  }
  const candidate = buildSnapshot(
    { generation: GENERATION, zones: rawZones, coreName, corePaired, coreSinceAt, revision: revision + 1, at,
      resolveIsland: (members, hash) => islands.resolve(members, hash),
      knownIslands: islands.known() },
    relay,
    ledger,
  );
  const nextSignature = structuralSignature(candidate);
  if (nextSignature === signature && hub.snapshot() !== null) return;
  signature = nextSignature;
  revision += 1;
  hub.publish(candidate as Snapshot);
}

/** The seek frame: playing zones only, once per second, no revision bump. */
function tickSeek(): void {
  const snapshot = hub.snapshot();
  if (snapshot === null) return;
  const at = stamp();
  const zones: { id: string; positionSec: number }[] = [];
  for (const raw of rawZones) {
    if (raw === null || typeof raw !== 'object') continue;
    const zone = raw as Record<string, unknown>;
    if (zone.state !== 'playing' || zone.is_seek_allowed !== true) continue;
    const id = typeof zone.zone_id === 'string' ? zone.zone_id : null;
    const np = (zone.now_playing ?? null) as Record<string, unknown> | null;
    const position = typeof np?.seek_position === 'number' ? np.seek_position : null;
    const length = typeof np?.length === 'number' && np.length > 0 ? np.length : null;
    // Internet radio often carries an increasing seek_position even though it
    // has no finite duration. Do not put that stream-age counter on the wire as
    // if it were a seekable timeline.
    if (id === null || position === null || length === null) continue;
    zones.push({ id, positionSec: position });
  }
  hub.publishSeek({ generation: GENERATION, revision: snapshot.revision, at, zones } as SeekFrame);
}

function lanAddresses(): string[] {
  const found: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (entries === undefined) continue;
    if (name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth')) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        found.push(entry.address);
      }
    }
  }
  return found;
}

function urls(): string[] {
  const suffix = boundPort === 80 ? '' : ':' + String(boundPort);
  const list = ['http://' + HOSTNAME + '.local' + suffix + '/'];
  for (const address of lanAddresses()) list.push('http://' + address + suffix + '/');
  // A port-bearing URL as well. Some TV browsers (Samsung's among them) rewrite a
  // typed bare address to https:// — nothing listens there, so the page fails.
  // An explicit non-standard port is not upgraded, so this one can always be typed.
  if (altPort !== 0 && altPort !== boundPort) {
    for (const address of lanAddresses()) list.push('http://' + address + ':' + String(altPort) + '/');
  }
  return list;
}

function settingsLayout(values?: Record<string, unknown>): {
  values: Record<string, unknown>; layout: unknown[]; has_error: boolean;
} {
  return buildSettingsLayout(hub.snapshot(), islands, displays, values);
}

function saveSettings(values: Record<string, unknown>): void {
  saveSettingsValues(values, islands, displays);
  republish();
  log('settings saved from Roon');
}

const deps = {
  hub, relay, ledger, islands, displays, pull,
  onIslandLabelled: (): void => { republish(); extension.refreshSettings(); },
  assetDir: ASSET_DIR,
  docDir: DOC_DIR,
  commands: extension,
  browseAccess: browseGateway,
  queueAccess: extension.queue,
  mdns: () => mdns,
  urls,
  port: () => boundPort,
  browse: () => ({ requested: BROWSE, granted: extension.browseService() !== null }),
  log,
};
const server = createFlightDeckServer(deps);
let altServer: ReturnType<typeof createFlightDeckServer> | null = null;

async function main(): Promise<void> {
  // A host that runs FlightDeck beside itself (RHEOS) may have switched it off: wait before any port, name or Roon.
  await waitWhileSwitchedOff(() => readHostSwitch(DATA_DIR), log);
  boundPort = await listenWithLadder(server, PORTS, log);
  log('http listening on :' + String(boundPort));

  // The same handler on a second, high port. Costs one socket and removes a whole
  // class of TV-browser grief: a typed address with an explicit port is not
  // silently upgraded to https, and it needs no privileges if :80 was refused.
  if (boundPort !== ALT_PORT) {
    try {
      altServer = createFlightDeckServer(deps);
      altPort = await listenWithLadder(altServer, [ALT_PORT], log);
      log('http also listening on :' + String(altPort) + ' (type this one on a TV that forces https)');
    } catch {
      altPort = 0;
      altServer = null;
      log('second port ' + String(ALT_PORT) + ' unavailable — the primary port still serves');
    }
  }

  mdns = new MdnsResponder({ hostname: HOSTNAME, instance: 'FlightDeck', port: boundPort, log });
  try { await mdns.start(); } catch (error) { log('mdns unavailable: ' + String(error)); mdns = null; }

  extension.start();

  const heartbeat = setInterval(() => hub.heartbeat(Date.now()), 10_000);
  const seek = setInterval(tickSeek, 1000);
  const flush = setInterval(() => ledger.flush(), 30_000);
  heartbeat.unref(); seek.unref(); flush.unref();

  for (const url of urls()) log('reach FlightDeck at ' + url);

  const shutdown = (): void => {
    log('shutting down');
    clearInterval(heartbeat); clearInterval(seek); clearInterval(flush);
    ledger.flush();
    mdns?.stop();
    pull.close();
    hub.closeAll();
    extension.stop();
    altServer?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Switched off while running: leave cleanly. In a container, Docker restarts FlightDeck straight into the wait above.
  const hostSwitch = setInterval(() => {
    const note = readHostSwitch(DATA_DIR);
    if (note.on) return;
    clearInterval(hostSwitch);
    log(`switched off by ${note.host} — shutting down`);
    shutdown();
  }, HOST_SWITCH_POLL_MS);
  hostSwitch.unref();
}

void main().catch((error: unknown) => {
  log('fatal: ' + String(error));
  process.exit(1);
});
