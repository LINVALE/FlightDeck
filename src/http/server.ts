import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ArtRelay } from '../art/relay.ts';
import type { EventHub } from './events.ts';
import type { MdnsResponder } from '../net/mdns.ts';
import type { RecentLedger } from '../ledger/recent.ts';
import { renderDocPage, renderFacePage, renderWallPage, resolveOutput, resolveZone } from './pages.ts';

export type TransportAction = 'play' | 'pause' | 'playpause' | 'next' | 'previous' | 'stop';

export interface Commands {
  control(zoneId: string, action: TransportAction): Promise<void>;
  changeVolume(outputId: string, steps: number, incremental: boolean): Promise<void>;
  mute(outputId: string, muted: boolean): Promise<void>;
}

const TRANSPORT: ReadonlySet<string> = new Set(['play', 'pause', 'playpause', 'next', 'previous', 'stop']);
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
  ['.woff2', 'font/woff2'],
  ['.webmanifest', 'application/manifest+json'],
]);

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
        // Revalidate rather than cache blind. A kiosk screen runs for weeks; a
        // long max-age means it keeps running last month's code after an update
        // (which is exactly what fooled a test here on 2026-08-25). The ETag
        // keeps repeat loads cheap without letting a screen go stale.
        const etag = '"' + createHash('sha256').update(bytes).digest('base64url').slice(0, 24) + '"';
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
          response.end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': type,
          'Content-Length': bytes.byteLength,
          'Cache-Control': 'no-cache',
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
      await commands.control(zoneId, action as TransportAction);
      log('control ' + action + ' -> ' + zone.name);
      json(response, 200, { ok: true });
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
        await commands.mute(outputId, body.muted === true);
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
    json(response, 502, { error: String(error instanceof Error ? error.message : error) });
  }
}
