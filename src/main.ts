import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { ArtRelay } from './art/relay.ts';
import { EventHub } from './http/events.ts';
import { FlightDeckExtension } from './roon/extension.ts';
import { MdnsResponder } from './net/mdns.ts';
import { RecentLedger } from './ledger/recent.ts';
import { buildSnapshot, structuralSignature } from './model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from './http/server.ts';
import type { SeekFrame, Snapshot } from './model/types.ts';
import { networkInterfaces } from 'node:os';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DATA_DIR = resolve(process.env.FLIGHTDECK_DATA ?? resolve(HERE, '..', 'data'));
const ASSET_DIR = resolve(HERE, '..', 'assets');
const HOSTNAME = process.env.FLIGHTDECK_NAME ?? 'flightdeck';
const PORTS = process.env.FLIGHTDECK_PORT === undefined
  ? [80, 8440]
  : [Number(process.env.FLIGHTDECK_PORT), 8440];

function stamp(): string { return new Date().toISOString(); }
function log(message: string): void { process.stdout.write(stamp() + '  ' + message + '\n'); }

mkdirSync(DATA_DIR, { recursive: true });

const ledger = new RecentLedger(DATA_DIR);
const hub = new EventHub();

let rawZones: unknown[] = [];
let corePaired = false;
let coreName: string | null = null;
let coreSinceAt = stamp();
let revision = 0;
let signature = '';
let boundPort = 0;
let mdns: MdnsResponder | null = null;

const extension = new FlightDeckExtension(
  {
    dataDir: DATA_DIR, displayVersion: '0.1.0', log,
    // Opt-in: turning this on changes the registration, and Roon then parks the
    // extension until someone re-enables it in Settings.
    browse: process.env.FLIGHTDECK_BROWSE === '1',
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
    );
  }
  const candidate = buildSnapshot(
    { zones: rawZones, coreName, corePaired, coreSinceAt, revision: revision + 1, at },
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
    if (zone.state !== 'playing') continue;
    const id = typeof zone.zone_id === 'string' ? zone.zone_id : null;
    const np = (zone.now_playing ?? null) as Record<string, unknown> | null;
    const position = typeof np?.seek_position === 'number' ? np.seek_position : null;
    if (id === null || position === null) continue;
    zones.push({ id, positionSec: position });
  }
  hub.publishSeek({ revision: snapshot.revision, at, zones } as SeekFrame);
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
  return list;
}

const server = createFlightDeckServer({
  hub, relay, ledger,
  assetDir: ASSET_DIR,
  mdns: () => mdns,
  urls,
  port: () => boundPort,
  log,
});

async function main(): Promise<void> {
  boundPort = await listenWithLadder(server, PORTS, log);
  log('http listening on :' + String(boundPort));

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
    hub.closeAll();
    extension.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  log('fatal: ' + String(error));
  process.exit(1);
});
