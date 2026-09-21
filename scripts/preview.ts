import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
import { ZONES } from '../test/fixtures/zones.ts';

/**
 * Preview: the real server, real projection, real SSE — fed from fixtures instead
 * of a Roon pairing, so a screen can be looked at without touching a live Core.
 * Not part of the product; a development tool.
 */

const ASSETS = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets');
// docDir gained a required place in the server deps after this script last ran.
const DOCS = resolve(fileURLToPath(import.meta.url), '..', '..', 'docs');
const PORT = Number(process.env.PREVIEW_PORT ?? 8455);

// Stand-in Core: a REAL PNG per image key. The first version emitted SVG bytes
// labelled image/png and the relay correctly refused them — the art rail is
// MIME-checked, so a preview that lies about its type proves nothing.
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function pngArt(seed: string, size: number): Buffer {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const top = [(hash % 160) + 60, ((hash >> 5) % 130) + 40, ((hash >> 11) % 150) + 50];
  const bottom = [((hash >> 7) % 90) + 20, ((hash >> 13) % 90) + 25, ((hash >> 3) % 110) + 40];
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let cursor = 0;
  for (let y = 0; y < size; y += 1) {
    raw[cursor] = 0;
    cursor += 1;
    const t = y / (size - 1);
    for (let x = 0; x < size; x += 1) {
      // A gradient plus a soft disc, so the palette pass has something real to chew on.
      const dx = (x - size / 2) / (size * 0.3);
      const dy = (y - size * 0.44) / (size * 0.3);
      const disc = dx * dx + dy * dy < 1 ? 1 : 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = Math.round(top[channel] * (1 - t) + bottom[channel] * t);
        const lit = disc === 1 ? Math.min(255, Math.round(base * 0.4 + [233, 198, 122][channel] * 0.85)) : base;
        raw[cursor] = lit;
        cursor += 1;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2;  // 8-bit truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const core = createServer((request, response) => {
  const key = (request.url ?? '').split('/api/image/')[1]?.split('?')[0] ?? 'x';
  const body = pngArt(key, 320);
  response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.byteLength });
  response.end(body);
});

async function main(): Promise<void> {
  await new Promise<void>((done) => core.listen(0, '127.0.0.1', done));
  const coreAddress = core.address();
  const corePort = typeof coreAddress === 'object' && coreAddress !== null ? coreAddress.port : 0;

  const ledger = new RecentLedger(null);
  const hub = new EventHub();
  const relay = new ArtRelay({
    artworkUrl: (key, size) => 'http://127.0.0.1:' + String(corePort) + '/api/image/' + key + '?s=' + size,
  });
  let bound = PORT;
  let publish = (): void => {};

  /**
   * Stand-in transport: enough of Roon's grouping semantics to LOOK at the
   * Wall's drag-and-drop without a Core — group moves the outputs to the head's
   * zone, ungroup gives each removed output a zone of its own. Everything else
   * just logs. Same reason the stand-in Core serves real PNGs: a preview that
   * cannot exercise the gesture proves nothing about it.
   */
  const say = (what: string): void => { process.stdout.write('command: ' + what + '\n'); };
  const zoneOfOutput = (id: string): Record<string, any> | undefined =>
    zones.find((z) => (z.outputs as Record<string, any>[]).some((o) => o.output_id === id));
  const commands = {
    control: async (zone: string, action: string) => say(action + ' ' + zone),
    seek: async (zone: string, seconds: number) => say('seek ' + zone + ' ' + String(seconds)),
    setVolume: async (output: string, value: number) => say('volume ' + output + ' = ' + String(value)),
    changeVolume: async (output: string, steps: number) => say('volume ' + output + ' ' + String(steps)),
    mute: async (output: string, muted: boolean) => say((muted ? 'mute ' : 'unmute ') + output),
    changeSettings: async (zone: string, settings: unknown) => say('settings ' + zone + ' ' + JSON.stringify(settings)),
    groupOutputs: async (ids: readonly string[]) => {
      say('group_outputs ' + ids.join('+'));
      const head = zoneOfOutput(ids[0]);
      if (head === undefined) return;
      for (const id of ids.slice(1)) {
        const from = zoneOfOutput(id);
        if (from === undefined || from === head) continue;
        const outputs = from.outputs as Record<string, any>[];
        const at = outputs.findIndex((o) => o.output_id === id);
        (head.outputs as Record<string, any>[]).push(outputs[at]);
        outputs.splice(at, 1);
        if (outputs.length === 0) zones.splice(zones.indexOf(from), 1);
      }
      const headOutputs = head.outputs as Record<string, any>[];
      head.display_name = String(headOutputs[0].display_name)
        + (headOutputs.length > 1 ? ' + ' + String(headOutputs.length - 1) : '');
      publish();
    },
    ungroupOutputs: async (ids: readonly string[]) => {
      say('ungroup_outputs ' + ids.join('+'));
      for (const id of ids) {
        const from = zoneOfOutput(id);
        if (from === undefined) continue;
        const outputs = from.outputs as Record<string, any>[];
        if (outputs.length < 2) continue;
        const at = outputs.findIndex((o) => o.output_id === id);
        const output = outputs[at];
        outputs.splice(at, 1);
        from.display_name = String(outputs[0].display_name)
          + (outputs.length > 1 ? ' + ' + String(outputs.length - 1) : '');
        zones.push({ zone_id: 'z' + String(output.output_id), display_name: output.display_name,
          state: 'stopped', outputs: [output] });
      }
      publish();
    },
    transferZone: async (from: string, to: string) => say('transfer ' + from + ' -> ' + to),
  };

  
/**
 * Browse, replayed from the 2026-08-25 capture in test/fixtures/browse/.
 *
 * A development stand-in, not a product path: it answers `browse` and `load`
 * per hierarchy from what a real Core actually returned, so the radial menu can
 * be built and measured against genuine list sizes — Explore 7, Genres 56,
 * Albums 2295 — without a Core, a pairing, or FLIGHTDECK_BROWSE=1.
 */
const CAPTURE: Record<string, { result: { body: unknown } }> = JSON.parse(
  readFileSync(resolve(fileURLToPath(import.meta.url), '..', '..', 'test', 'fixtures', 'browse', 'hierarchies.json'), 'utf8'),
);

const fixtureBrowse = {
  available: (): boolean => true,
  browse: async (call: { hierarchy?: string }): Promise<unknown> => {
    const entry = CAPTURE['root:' + String(call.hierarchy ?? 'browse')];
    if (entry === undefined) return { action: 'none', list: null, message: 'no capture', isError: true, items: [], offset: 0 };
    return entry.result.body;
  },
  load: async (call: { hierarchy?: string }): Promise<unknown> => {
    const entry = CAPTURE['load:' + String(call.hierarchy ?? 'browse')];
    if (entry === undefined) return { action: 'list', list: null, message: null, isError: false, items: [], offset: 0 };
    return entry.result.body;
  },
};

const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: ASSETS, docDir: DOCS, mdns: () => null, commands, browseAccess: fixtureBrowse,
    urls: () => ['http://flightdeck.local/', 'http://192.0.2.10/'],
    port: () => bound,
  });
  bound = await listenWithLadder(server, [PORT], () => {});

  let revision = 0;
  const zones = JSON.parse(JSON.stringify(ZONES)) as Record<string, any>[];

  /**
   * Grouping islands for the fixtures, preview-only: everything except Garden is
   * one family (so Kitchen and Terrace can take a drop), and Garden can group
   * with nothing (so the refusal is visible). The shared fixture stays as the
   * wire shows a Core that never said `can_group_with_output_ids`.
   */
  const family = ['1701a', '1701b', '1702a', '1704a'];
  for (const zone of zones) {
    for (const output of zone.outputs as Record<string, any>[]) {
      if (family.includes(output.output_id as string)) output.can_group_with_output_ids = family;
    }
  }
  publish = (): void => {
    revision += 1;
    const at = new Date().toISOString();
    for (const zone of zones) {
      const id = zone.zone_id as string;
      const np = zone.now_playing as Record<string, unknown> | undefined;
      const three = (np?.three_line ?? {}) as Record<string, unknown>;
      ledger.observe(id, zone.display_name as string, zone.state as string,
        typeof three.line1 === 'string' ? three.line1 : null,
        typeof three.line2 === 'string' ? three.line2 : '',
        typeof np?.image_key === 'string' ? np.image_key : null, at);
    }
    hub.publish(buildSnapshot(
      { generation: 'test', zones, coreName: 'ROCK (preview)', corePaired: true, coreSinceAt: at, revision, at }, relay, ledger));
  };
  publish();

  setInterval(() => {
    for (const zone of zones) {
      if (zone.state !== 'playing' || zone.now_playing === undefined) continue;
      zone.now_playing.seek_position = (zone.now_playing.seek_position as number) + 1;
    }
    hub.publishSeek({
      revision, at: new Date().toISOString(),
      zones: zones.filter((z) => z.state === 'playing' && z.now_playing !== undefined)
        .map((z) => ({ id: z.zone_id as string, positionSec: z.now_playing.seek_position as number })),
    });
  }, 1000).unref();

  process.stdout.write('preview on http://127.0.0.1:' + String(bound) + '/\n');
}

void main();
