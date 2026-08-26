import { createServer } from 'node:http';
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
  const server = createFlightDeckServer({
    hub, relay, ledger, assetDir: ASSETS, docDir: DOCS, mdns: () => null, commands: null, browseAccess: null,
    urls: () => ['http://flightdeck.local/', 'http://192.168.1.114/'],
    port: () => bound,
  });
  bound = await listenWithLadder(server, [PORT], () => {});

  let revision = 0;
  const zones = JSON.parse(JSON.stringify(ZONES)) as Record<string, any>[];
  const publish = (): void => {
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
