import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ArtRelay } from '../art/relay.ts';
import type { EventHub } from './events.ts';
import type { MdnsResponder } from '../net/mdns.ts';
import type { RecentLedger } from '../ledger/recent.ts';
import { renderDocPage, renderFacePage, renderPhonePage, renderPuckPage, renderWallPage, resolveOutput, resolveZone } from './pages.ts';
import { PullError, type PullOutcome, type PullRequest } from '../control/pull.ts';
import { QUEUE_MAX_ITEMS, QueueError, type QueueSnapshot } from '../roon/queue.ts';

export type TransportAction = 'play' | 'pause' | 'playpause' | 'next' | 'previous' | 'stop';

export interface BrowseAccess {
  available(): boolean;
  browse(call: Record<string, unknown>): Promise<unknown>;
  load(call: Record<string, unknown>): Promise<unknown>;
}

export interface PullAccess {
  pull(request: PullRequest): Promise<PullOutcome>;
}

export interface QueueAccess {
  snapshot(zoneId: string): QueueSnapshot | null;
  playFromHere(zoneId: string, itemId: string, expectedRevision: number): Promise<void>;
}

export interface Commands {
  control(zoneId: string, action: TransportAction): Promise<void>;
  seek(zoneId: string, seconds: number): Promise<void>;
  setVolume(outputId: string, value: number): Promise<void>;
  changeVolume(outputId: string, steps: number, incremental: boolean): Promise<void>;
  /** Roon's convenience switch: brings a standby-capable output out of standby. Optional for older deps. */
  wake?(outputId: string): Promise<void>;
  changeSettings(zoneId: string, settings: { shuffle?: boolean; loop?: 'next' }): Promise<void>;
  groupOutputs(outputIds: readonly string[]): Promise<void>;
  ungroupOutputs(outputIds: readonly string[]): Promise<void>;
  transferZone(fromZoneId: string, toZoneOrOutputId: string): Promise<void>;
  mute(outputId: string, muted: boolean): Promise<void>;
}

const TRANSPORT: ReadonlySet<string> = new Set(['play', 'pause', 'playpause', 'next', 'previous', 'stop']);

/**
 * What a remote actually sent. A television decides which keys ever reach a
 * browser, and that cannot be determined from the server — but the PAGE knows,
 * so in ?keys=1 mode it posts each key here and the answer can be read without
 * anyone transcribing it off a screen across the room.
 *
 * Diagnostic only: bounded, in memory, and gone on restart.
 */
interface ProbedKey { readonly at: string; readonly key: string; readonly code: number; readonly acted: string }
const probed: ProbedKey[] = [];
const MAX_BODY = 2048;

/** Read a small JSON body, refusing anything oversized rather than buffering it. */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { request.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null);
      } catch { resolve(null); }
    });
    request.on('error', () => resolve(null));
  });
}

export interface ServerDeps {
  /** Names people have given the grouping islands; renaming republishes the snapshot. */
  readonly islands?: { label(id: string): string | null; setLabel(id: string, label: string): boolean };
  /** Called after a rename so the caller can republish; without it the name waits for the next zone change. */
  readonly onIslandLabelled?: () => void;
  /** The screens on record, and what each is locked to. */
  readonly displays?: {
    see(id: string, name: string, at: string): {
      id: string;
      name: string;
      outputId: string | null;
      idleDelayMinutes: number;
    } | null;
  };
  readonly hub: EventHub;
  readonly relay: ArtRelay;
  readonly ledger: RecentLedger;
  readonly assetDir: string;
  readonly docDir: string;
  /**
   * The write side. Absent in tests and the preview, where nothing should reach a
   * real Core — the route then answers 503 rather than pretending it worked.
   */
  readonly commands: Commands | null;
  /** One shared transaction owner, passed to every HTTP listener. */
  readonly pull?: PullAccess | null;
  /** Bounded per-zone queue mirror. Optional so preview and older tests stay read-only. */
  readonly queueAccess?: QueueAccess | null;
  /** Roon's Browse tree. Null when Browse was not requested at startup. */
  readonly browseAccess: BrowseAccess | null;
  readonly mdns: () => MdnsResponder | null;
  readonly urls: () => string[];
  readonly port: () => number;
  /** Whether the Browse service was requested, and whether the Core granted it. */
  readonly browse?: () => { requested: boolean; granted: boolean };
  readonly log?: (message: string) => void;
}

const ASSET_TYPES = new Map<string, string>([
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.json', 'application/json; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.webmanifest', 'application/manifest+json'],
]);

/** Greatest whole seek position strictly inside a finite Roon timeline. */
function safeSeekSecond(seconds: number, length: number | null): number {
  const rounded = Math.max(0, Math.round(seconds));
  if (length === null) return rounded;
  return Math.min(rounded, Math.max(0, Math.ceil(length) - 1));
}

/**
 * `default-src 'none'` with nonces — the discipline that kept the RHEOS console
 * honest. Everything the page needs is same-origin; nothing may phone home.
 */
function csp(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self' 'nonce-" + nonce + "'",
    "connect-src 'self'",
    // default-src 'none' otherwise blocks the manifest fetch outright
    "manifest-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function secure(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.byteLength,
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function html(response: ServerResponse, status: number, body: string, nonce: string): void {
  const payload = Buffer.from(body, 'utf8');
  response.setHeader('Content-Security-Policy', csp(nonce));
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.byteLength,
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

export function createFlightDeckServer(deps: ServerDeps): Server {
  const log = deps.log ?? ((): void => {});

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    secure(response);
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const ip = request.socket.remoteAddress ?? 'unknown';

    /**
     * Queue selection is a Core write. Its queue revision is deliberately
     * separate from the structural snapshot revision: queue deltas do not
     * republish the whole House Wall.
     */
    if (request.method === 'POST' && path === '/api/v1/queue') {
      const origin = request.headers.origin;
      if (typeof origin === 'string' && origin !== '') {
        const host = request.headers.host ?? '';
        let ok = false;
        try { ok = new URL(origin).host === host; } catch { ok = false; }
        if (!ok) { json(response, 403, { error: 'cross-origin queue selection refused' }); return; }
      }
      void handleQueueSelection(request, response, deps, log);
      return;
    }

    /**
     * THE ONLY WRITE ROUTE. Everything else FlightDeck does is read-only.
     *
     * Same-origin only: a page on another site must not be able to pause the
     * music because someone left this tab open. There is no auth beyond that —
     * the same trust model as the rest of the LAN surface — but an Origin from
     * elsewhere is refused outright.
     */
    if (request.method === 'POST' && path === '/api/v1/control') {
      const origin = request.headers.origin;
      if (typeof origin === 'string' && origin !== '') {
        const host = request.headers.host ?? '';
        let ok = false;
        try { ok = new URL(origin).host === host; } catch { ok = false; }
        if (!ok) { json(response, 403, { error: 'cross-origin control refused' }); return; }
      }
      void handleControl(request, response, deps, log);
      return;
    }

    /**
     * Browse. Same-origin and read-only against the Core's library — but it can
     * START PLAYBACK when an item is played, so it is guarded like the control
     * route rather than like a GET.
     */
    if (request.method === 'POST' && path === '/api/v1/browse') {
      const origin = request.headers.origin;
      if (typeof origin === 'string' && origin !== '') {
        const host = request.headers.host ?? '';
        let ok = false;
        try { ok = new URL(origin).host === host; } catch { ok = false; }
        if (!ok) { json(response, 403, { error: 'cross-origin browse refused' }); return; }
      }
      void handleBrowse(request, response, deps);
      return;
    }

    /**
     * A SCREEN SAYING HELLO.
     *
     * Same-origin only, like the control route: it writes to the registry, and a
     * page on another site has no business naming this house's televisions. The
     * reply is what the screen is bound to, which is how a binding made in Roon's
     * settings reaches a display nobody is standing in front of.
     */
    if (request.method === 'POST' && path === '/api/v1/display') {
      const origin = request.headers.origin;
      if (typeof origin === 'string' && origin !== '') {
        const host = request.headers.host ?? '';
        let ok = false;
        try { ok = new URL(origin).host === host; } catch { ok = false; }
        if (!ok) { json(response, 403, { error: 'cross-origin refused' }); return; }
      }
      const registry = deps.displays;
      if (registry === undefined) { json(response, 200, { output: null }); return; }
      void readJson(request).then((body) => {
        const id = typeof body?.id === 'string' ? body.id : '';
        const name = typeof body?.name === 'string' ? body.name : '';
        const record = registry.see(id, name, new Date().toISOString());
        json(response, record === null ? 400 : 200,
          record === null ? { error: 'display not accepted' } : {
            output: record.outputId,
            name: record.name,
            idleDelayMinutes: record.idleDelayMinutes,
          });
      });
      return;
    }

    if (request.method === 'POST' && path === '/api/v1/keyprobe') {
      void readJson(request).then((body) => {
        if (body !== null) {
          probed.unshift({
            at: new Date().toISOString(),
            key: String(body.key ?? '').slice(0, 40),
            code: typeof body.code === 'number' ? body.code : 0,
            acted: String(body.acted ?? '').slice(0, 40),
          });
          if (probed.length > 40) probed.length = 40;
        }
        json(response, 200, { ok: true });
      });
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      json(response, 405, { error: 'method not allowed' });
      return;
    }

    // ---- live plane ----
    if (path === '/api/v1/events') {
      const header = request.headers['last-event-id'];
      deps.hub.open(response, ip, Array.isArray(header) ? header[0] : header);
      return;
    }
    if (path === '/api/v1/snapshot') {
      const snapshot = deps.hub.snapshot();
      if (snapshot === null) json(response, 503, { error: 'no snapshot yet' });
      else json(response, 200, snapshot);
      return;
    }
    if (path === '/api/v1/queue') {
      handleQueueSnapshot(response, deps, url.searchParams.get('zone'));
      return;
    }
    if (path === '/api/v1/keyprobe') {
      json(response, 200, { keys: probed });
      return;
    }

    if (path === '/api/v1/recent') {
      json(response, 200, { tracks: deps.ledger.recent(24) });
      return;
    }
    if (path === '/api/v1/health') {
      const mdns = deps.mdns();
      json(response, 200, {
        ok: true,
        port: deps.port(),
        urls: deps.urls(),
        clients: deps.hub.clientCount,
        revision: deps.hub.snapshot()?.revision ?? null,
        browse: deps.browse === undefined ? { requested: false, granted: false } : deps.browse(),
        mdns: mdns === null ? null : mdns.status(),
      });
      return;
    }

    // ---- artwork ----
    const token = ArtRelay.tokenFromPath(path);
    if (token !== null) {
      void deps.relay.resolve(token).then((resource) => {
        if (resource === null) { json(response, 404, { error: 'artwork unavailable' }); return; }
        response.writeHead(200, {
          'Content-Type': resource.contentType,
          'Content-Length': resource.bytes.byteLength,
          // The token is deterministic per run and the image behind a Core key is immutable.
          'Cache-Control': 'private, max-age=86400, immutable',
        });
        response.end(resource.bytes);
      }).catch(() => {
        if (!response.headersSent) json(response, 404, { error: 'artwork unavailable' });
        else response.destroy();
      });
      return;
    }

    // ---- static assets ----
    if (path.startsWith('/assets/')) {
      const relative = normalize(path.slice('/assets/'.length)).replace(/^(\.\.[/\\])+/, '');
      const extension = relative.slice(relative.lastIndexOf('.'));
      const type = ASSET_TYPES.get(extension);
      if (type === undefined) { json(response, 404, { error: 'not found' }); return; }
      try {
        const bytes = readFileSync(join(deps.assetDir, relative));
        /**
         * NEVER STORED. A kiosk screen runs for weeks, and 2026-08-25 showed
         * what a long max-age does. `no-cache` with an ETag was the first
         * answer — revalidate, keep repeat loads cheap — and on 2026-09-03 it
         * failed in Peter's hand: a plain refresh revalidated the PAGE and then
         * served every ES-module import from memory cache without asking, so
         * the face he refreshed was the morning's. A television cannot
         * hard-reload. The assets are small and the network is a LAN: fetch
         * them every time, and a screen can never be running old code after a
         * reload again. The ETag stays for the client that does ask.
         */
        const etag = '"' + createHash('sha256').update(bytes).digest('base64url').slice(0, 24) + '"';
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' });
          response.end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': type,
          'Content-Length': bytes.byteLength,
          'Cache-Control': 'no-store',
          ETag: etag,
        });
        response.end(bytes);
      } catch {
        json(response, 404, { error: 'not found' });
      }
      return;
    }

    // ---- pages ----
    const nonce = randomBytes(18).toString('base64');

    // Repo documents, rendered from their Markdown. Useful on the phone in your
    // hand while you stand in front of the TV you are setting up.
    const DOCS: Record<string, { file: string; title: string }> = {
      '/setup': { file: 'tv-setup.md', title: 'Putting FlightDeck on a TV' },
      '/drill': { file: 'tv-drill.md', title: 'The TV drill' },
    };
    const doc = DOCS[path];
    if (doc !== undefined) {
      try {
        const markdown = readFileSync(join(deps.docDir, doc.file), 'utf8');
        html(response, 200, renderDocPage(nonce, doc.title, markdown), nonce);
      } catch {
        json(response, 404, { error: 'document unavailable' });
      }
      return;
    }

    if (path === '/' || path === '/wall') {
      html(response, 200, renderWallPage(nonce, deps.urls()), nonce);
      return;
    }
    // The PHONE: the remote in a pocket. /phone holds what it last held;
    // /phone/study pins it to a room by name, same resolution as /face/.
    if (path === '/phone' || path === '/phone/' || path.startsWith('/phone/')) {
      const token = path.startsWith('/phone/') ? decodeURIComponent(path.slice('/phone/'.length)) : '';
      const snapshot = deps.hub.snapshot();
      const resolved = token === '' || snapshot === null ? null : resolveZone(snapshot.zones, token);
      html(response, 200, renderPhonePage(nonce, resolved ?? '', token), nonce);
      return;
    }
    // The PUCK: a model of the knob, driven by the same plane as every other
    // page. /puck follows whatever is playing; /puck/study pins it to a room by
    // name, resolved exactly as /phone resolves one.
    if (path === '/puck' || path === '/puck/' || path.startsWith('/puck/')) {
      const token = path.startsWith('/puck/') ? decodeURIComponent(path.slice('/puck/'.length)) : '';
      const snapshot = deps.hub.snapshot();
      // Prefer the durable OUTPUT, as /face does: a puck belongs to the speaker
      // in the room, so it follows that room through grouping instead of
      // stranding on a zone id Roon has since replaced.
      const bound = token === '' || snapshot === null ? null : resolveOutput(snapshot.zones, token);
      const resolved = bound !== null ? bound.zoneId
        : (token === '' || snapshot === null ? null : resolveZone(snapshot.zones, token));
      html(response, 200, renderPuckPage(nonce, resolved ?? '', token,
        url.searchParams.get('px'), url.searchParams.get('browse'),
        bound === null ? null : bound.outputId, url.searchParams.get('chrome')), nonce);
      return;
    }
    // The address worth bookmarking on a TV: no zone, always whatever is playing.
    // Checked BEFORE the prefix route, or '/face/' would fall into it with an
    // empty zone and no following — a screen pinned to nothing.
    if (path === '/now' || path === '/face' || path === '/face/') {
      html(response, 200, renderFacePage(nonce, '', url.searchParams.get('face'), '1'), nonce);
      return;
    }
    if (path.startsWith('/face/')) {
      const token = decodeURIComponent(path.slice('/face/'.length));
      const face = url.searchParams.get('face');
      // Accept a NAME as well as an id: /face/study is typeable on a remote,
      // /face/1601d5ff4c9a... is not.
      const snapshot = deps.hub.snapshot();
      // Prefer binding to an OUTPUT — the speaker in the room — so the screen
      // follows that room's audio through grouping. Fall back to a zone match
      // for a group name like "Downstairs", which is not an output at all.
      const bound = snapshot === null ? null : resolveOutput(snapshot.zones, token);
      const resolved = bound !== null ? bound.zoneId
        : (snapshot === null ? null : resolveZone(snapshot.zones, token));
      html(response, 200,
        renderFacePage(nonce, resolved ?? token, face, url.searchParams.get('follow'), token,
          bound === null ? null : bound.outputId), nonce);
      return;
    }
    json(response, 404, { error: 'not found' });
    log('404 ' + path);
  });
}

/**
 * ⚖️ The port ladder (08-25): try 80, fall back to 8440, always advertising the
 * same name. Only :80 satisfies "reachable by name, not port" — a browser given
 * a bare hostname always means :80, and no browser reads the DNS-SD SRV port.
 */
export async function listenWithLadder(
  server: Server, preferred: readonly number[], log: (message: string) => void,
): Promise<number> {
  let lastError: unknown = null;
  for (let index = 0; index < preferred.length; index += 1) {
    const port = preferred[index];
    const isLast = index === preferred.length - 1;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: unknown): void => { server.removeListener('listening', onListening); reject(error); };
        const onListening = (): void => { server.removeListener('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '0.0.0.0');
      });
      return port;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      // Say what is actually true: on the last rung there IS no next to try, and
      // the useful thing to print is what to do about it.
      if (!isLast) {
        log('port ' + String(port) + ' unavailable (' + String(code) + ') — trying the next');
      } else if (code === 'EADDRINUSE') {
        log('port ' + String(port) + ' is already in use — another FlightDeck is probably running.');
        log('  find it:  ss -ltnp | grep :' + String(port));
        log('  or pick another port:  FLIGHTDECK_PORT=8441 npm start');
      } else {
        log('port ' + String(port) + ' unavailable (' + String(code) + ') and no fallback remains');
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no port available');
}

function queueItemId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && String(numeric) === value ? value : null;
}

function queueText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 400);
}

function handleQueueSnapshot(
  response: ServerResponse, deps: ServerDeps, requestedZone: string | null,
): void {
  const zoneId = requestedZone ?? '';
  if (zoneId === '') { json(response, 400, { error: 'zone required' }); return; }
  const live = deps.hub.snapshot();
  if (live === null) { json(response, 503, { error: 'no snapshot yet' }); return; }
  if (!live.zones.some((zone) => zone.id === zoneId)) {
    json(response, 404, { error: 'unknown zone' });
    return;
  }
  const access = deps.queueAccess;
  if (access === undefined || access === null) {
    json(response, 503, { error: 'queue unavailable' });
    return;
  }

  try {
    const cached = access.snapshot(zoneId);
    if (cached === null) { json(response, 503, { error: 'queue unavailable' }); return; }
    const items = cached.items.slice(0, QUEUE_MAX_ITEMS).flatMap((item) => {
      const id = queueItemId(item.qid);
      if (id === null) return [];
      const art = deps.relay.pathFor(item.imageKey, 'thumb');
      return [{
        id,
        title: queueText(item.title),
        artist: queueText(item.artist),
        album: queueText(item.album),
        lengthSec: typeof item.length === 'number' && Number.isFinite(item.length) && item.length >= 0
          ? item.length : null,
        art: art?.path ?? null,
      }];
    });
    json(response, 200, {
      generation: live.generation,
      ready: cached.ready === true,
      revision: cached.revision,
      currentIndex: cached.ready && items.length > 0 ? 0 : null,
      atLimit: cached.atLimit === true,
      items,
    });
  } catch (error) {
    replyQueueError(response, error);
  }
}

async function handleQueueSelection(
  request: IncomingMessage, response: ServerResponse, deps: ServerDeps, log: (message: string) => void,
): Promise<void> {
  const access = deps.queueAccess;
  if (access === undefined || access === null) {
    json(response, 503, { error: 'queue unavailable' });
    return;
  }
  const body = await readJson(request);
  if (body === null) { json(response, 400, { error: 'malformed body' }); return; }
  const zoneId = typeof body.zone === 'string' ? body.zone : '';
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  const generation = typeof body.generation === 'string' ? body.generation : '';
  const queueRevision = typeof body.queueRevision === 'number' && Number.isInteger(body.queueRevision)
    && body.queueRevision >= 0 ? body.queueRevision : -1;
  if (zoneId === '' || itemId === '' || generation === '' || queueRevision < 0) {
    json(response, 400, { error: 'zone, itemId, generation and queueRevision required' });
    return;
  }

  const live = deps.hub.snapshot();
  if (live === null) { json(response, 503, { error: 'no snapshot yet' }); return; }
  if (generation !== live.generation) {
    json(response, 409, { error: 'screen snapshot is stale — reopen Queue', code: 'stale' });
    return;
  }
  const zone = live.zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }

  try {
    await access.playFromHere(zoneId, itemId, queueRevision);
    log('queue play from ' + itemId + ' -> ' + zone.name);
    json(response, 200, { ok: true });
  } catch (error) {
    replyQueueError(response, error);
  }
}

function replyQueueError(response: ServerResponse, error: unknown): void {
  const message = String(error instanceof Error ? error.message : error);
  if (!(error instanceof QueueError)) { json(response, 502, { error: message }); return; }
  let status: number;
  switch (error.code) {
    case 'invalid': status = 400; break;
    case 'stale':
    case 'current': status = 409; break;
    case 'unavailable': status = 503; break;
    case 'core-rejected': status = 502; break;
  }
  json(response, status, { error: message, code: error.code });
}

/**
 * Transport acts on a ZONE (Roon owns the queue and the cursor); volume acts on a
 * single OUTPUT — the speaker in that room — so a screen in the study can never
 * turn up a whole grouped house.
 */
async function handleControl(
  request: IncomingMessage, response: ServerResponse, deps: ServerDeps, log: (m: string) => void,
): Promise<void> {
  const commands = deps.commands;
  if (commands === null) { json(response, 503, { error: 'controls unavailable' }); return; }

  const body = await readJson(request);
  if (body === null) { json(response, 400, { error: 'malformed body' }); return; }
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (TRANSPORT.has(action)) {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      if (zoneId === '') { json(response, 400, { error: 'zone required' }); return; }
      // Honour what Roon says is possible: offering `next` on a zone that refuses
      // it produces a silent failure the viewer cannot explain.
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }
      if (action === 'next' && !zone.allowed.next) { json(response, 409, { error: 'next not allowed here' }); return; }
      if (action === 'previous' && !zone.allowed.previous) { json(response, 409, { error: 'previous not allowed here' }); return; }
      /**
       * ⚖️ START ON PLAY, AS IN ROON (Peter, 09-03). On 09-03 a Marantz LINK 10n
       * went to standby and its zone kept answering Play with nothing audible —
       * seven presses in the log. Roon's own app sends the convenience switch
       * before Play on a zone whose device can sleep; so does this, for every
       * output in the zone that supports standby. It is a no-op when awake.
       */
      if ((action === 'play' || action === 'playpause') && commands.wake !== undefined) {
        const sleepers = zone.outputs.filter((o) => o.power !== null && o.power.wakeable);
        for (const output of sleepers) {
          try { await commands.wake(output.id); }
          catch (error) { log('wake ' + output.name + ' failed: ' + String(error instanceof Error ? error.message : error)); }
        }
        if (sleepers.length > 0) log('wake ' + sleepers.map((o) => o.name).join(' + ') + ' before ' + action);
      }
      await commands.control(zoneId, action as TransportAction);
      log('control ' + action + ' -> ' + zone.name);
      json(response, 200, { ok: true });
      return;
    }

    /**
     * SHUFFLE and REPEAT. Both are zone settings rather than transport verbs, so
     * they take their own branch. Shuffle is a flat toggle read from the live
     * snapshot — never from what the screen last drew, which may be stale or may
     * belong to another screen. Repeat asks the CORE to cycle, so the order of
     * off/all/one is Roon's and cannot drift between screens.
     */
    if (action === 'shuffle' || action === 'repeat') {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      if (zoneId === '') { json(response, 400, { error: 'zone required' }); return; }
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }
      if (zone.settings === null) { json(response, 409, { error: 'this zone has no queue settings' }); return; }
      await commands.changeSettings(zoneId,
        action === 'shuffle' ? { shuffle: !zone.settings.shuffle } : { loop: 'next' });
      log(action + ' -> ' + zone.name);
      json(response, 200, { ok: true });
      return;
    }

    /**
     * GROUPING. Roon partitions grouping by protocol and says so per output, so
     * the rule is enforced HERE as well as drawn in the UI: a screen that has a
     * stale snapshot, or a request that never came from our page at all, must not
     * be able to ask for a group Roon would refuse — the failure is silent and
     * the viewer cannot explain it.
     *
     * The head of the list leads: Roon preserves the first output's queue.
     */
    if (action === 'group') {
      const wanted = Array.isArray(body.outputs) ? body.outputs.filter((v): v is string => typeof v === 'string') : [];
      if (wanted.length < 2) { json(response, 400, { error: 'a group needs at least two outputs' }); return; }
      const snapshot = deps.hub.snapshot();
      const all = snapshot === null ? [] : snapshot.zones.flatMap((z) => z.outputs);
      const found = wanted.map((id) => all.find((o) => o.id === id));
      if (found.some((o) => o === undefined)) { json(response, 404, { error: 'unknown output' }); return; }
      const head = found[0] as NonNullable<(typeof found)[number]>;
      const stranger = found.find((o) => !head.groupableWith.includes((o as { id: string }).id));
      if (stranger !== undefined) {
        json(response, 409, { error: (stranger as { name: string }).name + ' cannot be grouped with ' + head.name });
        return;
      }
      /**
       * ⚖️ A GROUP THAT IS ALREADY RIGHT IS NOT RE-FORMED (Peter, 08-28: "I think
       * we are repeating and it causes a playback glitch repeating the first
       * second or so").
       *
       * `group_outputs` is not idempotent at the audio layer. Handing Roon the
       * membership it already has still tears the zone down and builds it again,
       * and every room in it restarts the track — which is heard as the first
       * second playing twice. The set is the same, so the only honest answer is
       * to do nothing and say so.
       *
       * ORDER MATTERS, so this compares the head separately: Roon keeps the FIRST
       * output's queue, so [study, kitchen] and [kitchen, study] are different
       * requests even though they name the same two rooms.
       */
      const already = (snapshot === null ? [] : snapshot.zones).find(
        (z) => z.outputs.length === wanted.length
          && z.outputs[0].id === wanted[0]
          && z.outputs.every((o) => wanted.includes(o.id)));
      if (already !== undefined) {
        log('group ' + already.name + ' — already exactly this, not re-formed');
        json(response, 200, { ok: true, unchanged: true });
        return;
      }
      await commands.groupOutputs(wanted);
      log('group ' + found.map((o) => (o as { name: string }).name).join(' + '));
      json(response, 200, { ok: true });
      return;
    }

    /**
     * ⚖️ ONE GESTURE, ONE REGROUPING (Peter, 08-28: "don't trigger group with each
     * addition or removal — wait until all done").
     *
     * The picker lets someone add three rooms and drop one before they are done
     * deciding. Sending that as it is typed is four re-forms and four restarts;
     * `regroup` takes the membership they SETTLED ON and works out the smallest
     * set of calls that gets there — nothing at all when they land back where
     * they started, which is the common case after a change of mind.
     *
     * At most one ungroup and one group, in that order, because a room cannot
     * join a group it is still a member of somewhere else.
     */
    if (action === 'regroup') {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      const wanted = Array.isArray(body.outputs)
        ? body.outputs.filter((v): v is string => typeof v === 'string') : [];
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }
      if (wanted.length === 0) { json(response, 400, { error: 'a regroup needs the rooms to keep' }); return; }
      const all = (snapshot === null ? [] : snapshot.zones).flatMap((z) => z.outputs);
      const unknown = wanted.find((id) => all.every((o) => o.id !== id));
      if (unknown !== undefined) { json(response, 404, { error: 'unknown output' }); return; }

      // The head is pinned: it owns the queue, and moving it would mean choosing
      // whose music survives. The picker never offers it, and this refuses it.
      if (wanted[0] !== zone.outputs[0].id) {
        json(response, 409, { error: zone.outputs[0].name + ' leads this group and cannot be dropped from it' });
        return;
      }
      const head = zone.outputs[0];
      const stranger = wanted.find((id) => id !== head.id && !head.groupableWith.includes(id));
      if (stranger !== undefined) {
        const name = all.find((o) => o.id === stranger);
        json(response, 409, { error: (name === undefined ? 'that room' : name.name) + ' cannot be grouped with ' + head.name });
        return;
      }

      const remove = zone.outputs.filter((o) => !wanted.includes(o.id)).map((o) => o.id);
      const add = wanted.filter((id) => zone.outputs.every((o) => o.id !== id));
      if (remove.length === 0 && add.length === 0) {
        log('regroup ' + zone.name + ' — already exactly this, nothing sent');
        json(response, 200, { ok: true, unchanged: true });
        return;
      }
      // Everything out in ONE call: Roon tears a Squeezebox grouped zone down on
      // every ungroup, so a second call is a second injury, not a tidier job.
      if (remove.length > 0) await commands.ungroupOutputs(remove);
      if (add.length > 0 || remove.length > 0) {
        // Rebuilding from the settled list, head first, keeps the queue with the
        // room whose music it is. A group of one is just a room: nothing to form.
        if (wanted.length > 1) await commands.groupOutputs(wanted);
      }
      log('regroup ' + zone.name + ' \u2192 ' + String(wanted.length) + ' rooms'
        + (remove.length > 0 ? ' (-' + String(remove.length) + ')' : '')
        + (add.length > 0 ? ' (+' + String(add.length) + ')' : ''));
      json(response, 200, { ok: true });
      return;
    }

    if (action === 'ungroup') {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }
      if (zone.outputs.length < 2) { json(response, 409, { error: zone.name + ' is not a group' }); return; }
      /**
       * TAKING ONE ROOM OUT — `output` names the member to remove, and exactly
       * that member is sent, in ONE call. Dissolve-and-regroup would also work,
       * but Roon tears a Squeezebox grouped zone down on every `ungroup_outputs`,
       * and rebuilding stops the music in every room that was NOT being changed —
       * the Google Home failure this UI exists to avoid. The minimum change is
       * the only change.
       *
       * THE LEADER IS PINNED (HEOS's line, chosen over BluOS's promote-the-next):
       * the group's queue lives with its first output's zone, so what "removing
       * the leader" leaves behind is not something Roon defines for us. Dissolve
       * the whole group instead — one gesture, one call, ownership stays coherent.
       */
      const outputId = typeof body.output === 'string' ? body.output : '';
      if (outputId !== '') {
        const member = zone.outputs.find((o) => o.id === outputId);
        if (member === undefined) { json(response, 404, { error: 'that room is not in ' + zone.name }); return; }
        if (zone.outputs[0].id === outputId) {
          json(response, 409, { error: member.name + ' leads this group — ungroup the whole group instead' });
          return;
        }
        await commands.ungroupOutputs([outputId]);
        log('ungroup ' + member.name + ' out of ' + zone.name);
        json(response, 200, { ok: true });
        return;
      }
      // ONE call for the whole set: Roon tears a Squeezebox grouped zone down on
      // every ungroup, so a second call is a second injury, not a tidier job.
      await commands.ungroupOutputs(zone.outputs.map((o) => o.id));
      log('ungroup ' + zone.name);
      json(response, 200, { ok: true });
      return;
    }

    if (action === 'transfer') {
      const fromId = typeof body.zone === 'string' ? body.zone : '';
      let destinationOutputId = typeof body.output === 'string' ? body.output : '';
      const legacyDestinationZoneId = typeof body.to === 'string' ? body.to : '';
      if (fromId === '' || (destinationOutputId === '' && legacyDestinationZoneId === '')) {
        json(response, 400, { error: 'zone and output required' });
        return;
      }
      const snapshot = deps.hub.snapshot();
      const from = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === fromId);
      // A TV page can remain open across a FlightDeck restart. Faces served by
      // the previous build sent `to: zoneId`; resolve that once at the boundary
      // so those screens keep working while every newly loaded page sends the
      // durable `output` directly.
      if (destinationOutputId === '' && snapshot !== null) {
        const legacy = snapshot.zones.find((zone) => zone.id === legacyDestinationZoneId);
        destinationOutputId = legacy?.outputs[0]?.id ?? '';
      }
      const owners = snapshot === null ? [] : snapshot.zones.filter(
        (zone) => zone.outputs.some((output) => output.id === destinationOutputId));
      if (from === undefined) { json(response, 404, { error: 'unknown source zone' }); return; }
      if (owners.length === 0) { json(response, 404, { error: 'unknown destination output' }); return; }
      if (owners.length !== 1) { json(response, 409, { error: 'destination output is ambiguous' }); return; }
      const to = owners[0];
      if (from.id === to.id) { json(response, 409, { error: 'that is where it is already playing' }); return; }
      if (from.nowPlaying === null) { json(response, 409, { error: 'there is nothing playing in ' + from.name }); return; }
      // An output survives Roon replacing either zone during transfer; a zone id
      // does not. Resolve it only for validation/copy and send the durable target.
      await commands.transferZone(fromId, destinationOutputId);
      log('transfer ' + from.name + ' -> ' + to.name);
      json(response, 200, { ok: true });
      return;
    }

    /**
     * PULL FROM moves a playing source onto this display's durable OUTPUT. The
     * browser's generation/revision fence is mandatory: without it, a gesture
     * made on an old room list could move the wrong queue after grouping changed.
     * The coordinator owns transfer, observation and any one-shot Play.
     */
    if (action === 'pull') {
      const pull = deps.pull;
      if (pull === undefined || pull === null) {
        json(response, 503, { error: 'pull unavailable' });
        return;
      }
      const sourceZoneId = typeof body.from === 'string' ? body.from : '';
      const destinationOutputId = typeof body.output === 'string' ? body.output : '';
      const generation = typeof body.generation === 'string' ? body.generation : '';
      const revision = typeof body.revision === 'number' && Number.isInteger(body.revision)
        ? body.revision : -1;
      if (sourceZoneId === '' || destinationOutputId === '' || generation === '' || revision < 0) {
        json(response, 400, { error: 'from, output, generation and revision required' });
        return;
      }
      const outcome = await pull.pull({ sourceZoneId, destinationOutputId, generation, revision });
      log('pull ' + sourceZoneId + ' -> ' + destinationOutputId
        + (outcome.playIssued ? ' (Play confirmed)' : ''));
      json(response, 200, { ok: true, ...outcome });
      return;
    }

    /**
     * NAMING AN ISLAND. Roon says which outputs group together and never says
     * what they are; a person does. The name is stored against the island's own
     * identity and republished, so every screen in the house agrees at once
     * rather than each remembering its own word for the same set.
     */
    if (action === 'label-island') {
      const store = deps.islands;
      if (store === undefined) { json(response, 503, { error: 'names are not stored on this server' }); return; }
      const island = typeof body.island === 'string' ? body.island : '';
      if (island === '') { json(response, 400, { error: 'island required' }); return; }
      const snapshot = deps.hub.snapshot();
      const known = snapshot !== null && snapshot.islands.some((i) => i.id === island);
      if (!known) { json(response, 404, { error: 'unknown island' }); return; }
      if (!store.setLabel(island, typeof body.label === 'string' ? body.label : '')) {
        json(response, 404, { error: 'unknown island' }); return;
      }
      deps.onIslandLabelled?.();
      log('island named ' + island + ' -> ' + String(body.label ?? ''));
      json(response, 200, { ok: true });
      return;
    }

    /**
     * GROUP VOLUME — the one control Roon has never had.
     *
     * Its own remote gives a grouped zone per-endpoint sliders and relative nudge
     * buttons, and users have asked for a single group slider since 2018. Sonos
     * specifies the contract precisely and it is the right one, so it is adopted
     * verbatim: the group level is the AVERAGE of its members, and moving it
     * preserves the proportional offsets between them — the quiet room stays
     * quieter. A member already at an end simply stops there.
     *
     * Levels are normalised to 0..1 per output before averaging, because members
     * do not share a range: the Marantz here reports 0-80 while everything else
     * reports 0-100, and averaging raw numbers across those would drift.
     */
    if (action === 'group-volume') {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      const wanted = typeof body.level === 'number' ? body.level : -1;
      if (zoneId === '' || wanted < 0 || wanted > 1) { json(response, 400, { error: 'zone and a level of 0..1 required' }); return; }
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }

      const movable = zone.outputs.filter((o) => o.volume !== null && o.volume.value !== null
        && o.volume.max !== null && o.volume.type !== 'incremental');
      if (movable.length === 0) { json(response, 409, { error: 'no room here has a volume to set' }); return; }

      const span = (o: (typeof movable)[number]): number =>
        Math.max(1, (o.volume!.max as number) - (o.volume!.min ?? 0));
      const levelOf = (o: (typeof movable)[number]): number =>
        ((o.volume!.value as number) - (o.volume!.min ?? 0)) / span(o);

      /**
       * ⚖️ SATURATE A ROOM, NOT THE GROUP (Peter, 08-31).
       *
       * Every member receives one shared shift, which preserves its offset while
       * it has room to move. A member at 0 or 1 stays there; the remaining shift
       * is carried by members that can still move. This is the constrained value
       * whose CLAMPED member average equals the requested master level.
       *
       * The old rule clamped the shared delta to the first boundary. One room at
       * zero therefore prevented every other room being reduced, and one room at
       * maximum prevented every other room being increased. Binary search is a
       * small, deterministic water-fill over the monotonic clamped average.
       */
      const levels = movable.map(levelOf);
      const shiftedAverage = (delta: number): number => levels.reduce(
        (sum, level) => sum + Math.max(0, Math.min(1, level + delta)), 0,
      ) / levels.length;
      let low = -1;
      let high = 1;
      for (let pass = 0; pass < 40; pass += 1) {
        const middle = (low + high) / 2;
        if (shiftedAverage(middle) < wanted) low = middle;
        else high = middle;
      }
      const delta = (low + high) / 2;

      /**
       * ⚠️ AND ONE AT A TIME. Fired together against the same zone, volume sets
       * race the way two mutes did on 08-28 — one is lost, or arrives after the
       * device has already re-based on another. Sequential is slower by a few
       * milliseconds and is the only version that lands what it says.
       */
      for (let index = 0; index < movable.length; index += 1) {
        const o = movable[index];
        const target = Math.max(0, Math.min(1, levels[index] + delta));
        const value = Math.round((o.volume!.min ?? 0) + target * span(o));
        await commands.setVolume(o.id, value);
      }
      log('group volume ' + zone.name + ' -> ' + String(Math.round(wanted * 100)) + '%');
      json(response, 200, { ok: true });
      return;
    }

    /**
     * GROUP MUTE is one zone-owned decision, not a burst assembled by a browser.
     * Every output for which Roon exposes a volume object participates, including
     * incremental controls that cannot be placed on the absolute group scale.
     * A partly muted group is still sounding, so the next press mutes every member;
     * only a wholly muted group turns the same action into unmute.
     */
    if (action === 'group-mute') {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      if (zoneId === '') { json(response, 400, { error: 'zone required' }); return; }
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }
      if (zone.outputs.length < 2) { json(response, 409, { error: 'this zone is not a group' }); return; }

      const mutable = zone.outputs.filter((o) => o.volume !== null);
      if (mutable.length === 0) { json(response, 409, { error: 'no room here has mute control' }); return; }
      const wanted = !mutable.every((o) => o.volume!.muted);

      // Roon can lose same-zone control changes fired together. Preserve the
      // zone's own order and wait for each acknowledgement before sending the next.
      for (const output of mutable) await commands.mute(output.id, wanted);
      log('group mute ' + zone.name + ' -> ' + (wanted ? 'muted' : 'unmuted'));
      json(response, 200, { ok: true, muted: wanted });
      return;
    }

    if (action === 'seek') {
      const zoneId = typeof body.zone === 'string' ? body.zone : '';
      const seconds = typeof body.seconds === 'number' ? body.seconds : -1;
      if (zoneId === '' || seconds < 0) { json(response, 400, { error: 'zone and seconds required' }); return; }
      const snapshot = deps.hub.snapshot();
      const zone = snapshot === null ? undefined : snapshot.zones.find((z) => z.id === zoneId);
      if (zone === undefined) { json(response, 404, { error: 'unknown zone' }); return; }
      // Roon says whether this zone can seek at all — a live radio stream cannot.
      if (!zone.allowed.seek) { json(response, 409, { error: 'seeking is not available here' }); return; }
      const length = zone.nowPlaying === null ? null : zone.nowPlaying.lengthSec;
      if (length !== null && seconds > length) { json(response, 400, { error: 'past the end of the track' }); return; }
      // Equality is not a playable position. Sending 211 for a 211-second track
      // parked Roon on its hand-off boundary for ~25 seconds in the live receipt.
      const target = safeSeekSecond(seconds, length);
      await commands.seek(zoneId, target);
      log('seek ' + String(target) + 's -> ' + zone.name);
      json(response, 200, { ok: true, seconds: target, adjusted: target !== seconds });
      return;
    }

    if (action === 'volume' || action === 'mute') {
      const outputId = typeof body.output === 'string' ? body.output : '';
      if (outputId === '') { json(response, 400, { error: 'output required' }); return; }
      const snapshot = deps.hub.snapshot();
      const output = snapshot === null ? undefined
        : snapshot.zones.flatMap((z) => z.outputs).find((o) => o.id === outputId);
      if (output === undefined) { json(response, 404, { error: 'unknown output' }); return; }
      if (output.volume === null) { json(response, 409, { error: 'this output has no volume control' }); return; }

      if (action === 'mute') {
        if (typeof body.muted !== 'boolean') { json(response, 400, { error: 'muted boolean required' }); return; }
        await commands.mute(outputId, body.muted);
        json(response, 200, { ok: true });
        return;
      }
      // An exact level, for a scale that is pressed rather than stepped. Clamped to
      // what the device says it accepts, so a mis-scaled UI cannot shout.
      if (typeof body.value === 'number') {
        const min = output.volume.min ?? 0;
        const max = output.volume.max ?? 100;
        const value = Math.max(min, Math.min(max, Math.round(body.value)));
        await commands.setVolume(outputId, value);
        log('volume = ' + String(value) + ' -> ' + output.name);
        json(response, 200, { ok: true });
        return;
      }
      const raw = typeof body.steps === 'number' ? body.steps : 0;
      if (raw === 0) { json(response, 400, { error: 'steps required' }); return; }
      // Bounded hard: a stuck key or a repeated tap must never send the room to
      // maximum. One press is one step.
      const steps = Math.max(-4, Math.min(4, Math.round(raw)));
      await commands.changeVolume(outputId, steps, output.volume.type === 'incremental');
      log('volume ' + (steps > 0 ? '+' : '') + String(steps) + ' -> ' + output.name);
      json(response, 200, { ok: true });
      return;
    }

    json(response, 400, { error: 'unknown action' });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (error instanceof PullError) {
      json(response, pullErrorStatus(error), { error: message, code: error.code });
      return;
    }
    json(response, 502, { error: message });
  }
}

function pullErrorStatus(error: PullError): number {
  if (error.code === 'source-not-found' || error.code === 'destination-not-found') return 404;
  if (error.code === 'snapshot-unavailable' || error.code === 'closed') return 503;
  if (error.code === 'timeout') return 504;
  if (error.code === 'transfer-failed' || error.code === 'play-failed') return 502;
  return 409;
}

/**
 * A thin pass-through to Roon's Browse tree. Deliberately not opinionated: the
 * live shapes have never been captured, so this shows what the Core actually
 * returns rather than reshaping it into something we have guessed at.
 */
async function handleBrowse(
  request: IncomingMessage, response: ServerResponse, deps: ServerDeps,
): Promise<void> {
  const access = deps.browseAccess;
  if (access === null || !access.available()) {
    json(response, 503, {
      error: 'browse unavailable',
      hint: 'start with FLIGHTDECK_BROWSE=1, then re-enable FlightDeck in Roon → Settings → Extensions',
    });
    return;
  }
  const body = await readJson(request);
  if (body === null) { json(response, 400, { error: 'malformed body' }); return; }

  const call: Record<string, unknown> = {
    hierarchy: typeof body.hierarchy === 'string' ? body.hierarchy : 'browse',
    sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : 'flightdeck',
  };
  if (typeof body.itemKey === 'string') call.itemKey = body.itemKey;
  if (typeof body.input === 'string') call.input = body.input;
  if (body.popAll === true) call.popAll = true;
  if (typeof body.popLevels === 'number') call.popLevels = body.popLevels;
  if (typeof body.zoneId === 'string') call.zoneId = body.zoneId;
  if (typeof body.offset === 'number') call.offset = body.offset;
  if (typeof body.count === 'number') call.count = body.count;

  try {
    const result = await (body.load === true ? access.load(call) : access.browse(call)) as Record<string, unknown>;
    // Mint an opaque art path for every item that has one. The browser never sees
    // a Core image key here either — the same discipline as now-playing artwork.
    const items = result.items;
    if (Array.isArray(items)) {
      result.items = items.map((raw) => {
        if (raw === null || typeof raw !== 'object') return raw;
        const item = raw as Record<string, unknown>;
        const art = deps.relay.pathFor(item.imageKey, 'thumb');
        return art === null ? item : { ...item, art: art.path };
      });
    }
    json(response, 200, result);
  } catch (error) {
    json(response, 502, { error: String(error instanceof Error ? error.message : error) });
  }
}
