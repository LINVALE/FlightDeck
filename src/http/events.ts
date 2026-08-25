import type { ServerResponse } from 'node:http';
import type { SeekFrame, Snapshot } from '../model/types.ts';

/**
 * The SSE hub. Protocol proven in the RHEOS console: `id` carries the revision,
 * events are snapshot | update | resync, and Last-Event-ID decides which a
 * reconnecting client gets. Seek rides its own frame and never bumps the revision.
 */

interface Client {
  readonly response: ServerResponse;
  readonly ip: string;
}

const MAX_CLIENTS = 64;
const MAX_PER_IP = 8;

export class EventHub {
  private readonly clients = new Set<Client>();
  private current: Snapshot | null = null;

  get clientCount(): number { return this.clients.size; }

  publish(snapshot: Snapshot): void {
    const previous = this.current;
    this.current = snapshot;
    if (previous === null) return;
    if (snapshot.revision === previous.revision) return;
    if (snapshot.revision === previous.revision + 1) {
      this.broadcast('update', snapshot.revision, snapshot);
      return;
    }
    this.broadcast('resync', snapshot.revision, {
      reason: 'source-gap',
      fromRevision: previous.revision,
      toRevision: snapshot.revision,
      snapshot,
    });
  }

  /** Seek is a separate, cheap frame: playing zones only, no revision bump. */
  publishSeek(frame: SeekFrame): void {
    if (frame.zones.length === 0) return;
    const payload = 'event: seek\ndata: ' + JSON.stringify(frame) + '\n\n';
    for (const client of [...this.clients]) {
      if (!client.response.write(payload)) this.drop(client);
    }
  }

  snapshot(): Snapshot | null { return this.current; }

  open(response: ServerResponse, ip: string, lastEventId: string | undefined): void {
    const snapshot = this.current;
    if (snapshot === null) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      response.end(JSON.stringify({ error: 'no snapshot yet' }));
      return;
    }
    let perIp = 0;
    for (const client of this.clients) if (client.ip === ip) perIp += 1;
    if (this.clients.size >= MAX_CLIENTS || perIp >= MAX_PER_IP) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' });
      response.end(JSON.stringify({ error: 'event client limit reached' }));
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 3000\n: connected revision=' + String(snapshot.revision) + '\n\n');

    const client: Client = { response, ip };
    this.clients.add(client);
    const close = (): void => this.drop(client);
    response.once('close', close);
    response.once('error', close);

    const previous = parseLastEventId(lastEventId);
    if (previous === null) this.send(client, 'snapshot', snapshot.revision, snapshot);
    else if (previous === snapshot.revision) this.send(client, 'snapshot', snapshot.revision, snapshot);
    else if (previous + 1 === snapshot.revision) this.send(client, 'update', snapshot.revision, snapshot);
    else {
      this.send(client, 'resync', snapshot.revision, {
        reason: previous > snapshot.revision ? 'revision-ahead' : 'history-gap',
        fromRevision: previous, toRevision: snapshot.revision, snapshot,
      });
    }
  }

  /**
   * A comment frame every 10 s. It is also how a half-open TCP socket is
   * eventually noticed on the server side; the client runs its own 25 s
   * no-frame watchdog because EventSource never notices one on its own (R2).
   */
  heartbeat(now: number): void {
    const payload = ': heartbeat ' + String(now) + '\n\n';
    for (const client of [...this.clients]) {
      if (!client.response.write(payload)) this.drop(client);
    }
  }

  closeAll(): void {
    for (const client of [...this.clients]) this.drop(client);
  }

  private broadcast(event: string, revision: number, data: unknown): void {
    for (const client of [...this.clients]) this.send(client, event, revision, data);
  }

  private send(client: Client, event: string, revision: number, data: unknown): void {
    const payload = 'event: ' + event + '\nid: ' + String(revision) + '\ndata: ' + JSON.stringify(data) + '\n\n';
    if (!client.response.write(payload)) this.drop(client);
  }

  private drop(client: Client): void {
    if (!this.clients.delete(client)) return;
    try { client.response.end(); } catch { /* already gone */ }
  }
}

export function parseLastEventId(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
