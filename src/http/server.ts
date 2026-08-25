import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ArtRelay } from '../art/relay.ts';
import type { EventHub } from './events.ts';
import type { MdnsResponder } from '../net/mdns.ts';
import type { RecentLedger } from '../ledger/recent.ts';
import { renderFacePage, renderWallPage } from './pages.ts';

export interface ServerDeps {
  readonly hub: EventHub;
  readonly relay: ArtRelay;
  readonly ledger: RecentLedger;
  readonly assetDir: string;
  readonly mdns: () => MdnsResponder | null;
  readonly urls: () => string[];
  readonly port: () => number;
  readonly log?: (message: string) => void;
}

const ASSET_TYPES = new Map<string, string>([
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
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
        response.writeHead(200, {
          'Content-Type': type,
          'Content-Length': bytes.byteLength,
          'Cache-Control': 'public, max-age=300',
        });
        response.end(bytes);
      } catch {
        json(response, 404, { error: 'not found' });
      }
      return;
    }

    // ---- pages ----
    const nonce = randomBytes(18).toString('base64');
    if (path === '/' || path === '/wall') {
      html(response, 200, renderWallPage(nonce, deps.urls()), nonce);
      return;
    }
    if (path.startsWith('/face/')) {
      const zoneId = decodeURIComponent(path.slice('/face/'.length));
      const face = url.searchParams.get('face');
      html(response, 200, renderFacePage(nonce, zoneId, face), nonce);
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
  for (const port of preferred) {
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
      log('port ' + String(port) + ' unavailable (' + String(code) + ') — trying the next');
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no port available');
}
