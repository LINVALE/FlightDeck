import type { ServerResponse } from 'node:http';
import type { SeekFrame, Snapshot } from '../model/types.ts';

export type SnapshotObserver = (snapshot: Snapshot) => void;

/**
 * The SSE hub. Protocol proven in the RHEOS console: `id` carries the revision,
 * events are snapshot | update | resync, and Last-Event-ID decides which a
 * reconnecting client gets. Seek rides its own frame and never bumps the revision.
 */

interface Client {
  readonly response: ServerResponse;
  readonly ip: string;
  /** `write() === false` means accepted but buffered, not disconnected. */
  blocked: boolean;
  /** A slow screen needs only the newest full truth, never an unbounded queue. */
  pendingSnapshot: Snapshot | null;
  /** Seek is disposable and coalesces to the newest frame while blocked. */
  pendingSeek: SeekFrame | null;
  /** Last structural revision accepted by Node's response buffer. */
  lastRevision: number | null;
}

const MAX_CLIENTS = 64;
const MAX_PER_IP = 8;

export class EventHub {
  private readonly clients = new Set<Client>();
  private readonly observers = new Set<SnapshotObserver>();
  private current: Snapshot | null = null;

  get clientCount(): number { return this.clients.size; }

  publish(snapshot: Snapshot): void {
    const previous = this.current;
    this.current = snapshot;
    const structural = previous === null || snapshot.generation !== previous.generation
      || snapshot.revision !== previous.revision;
    if (!structural) return;

    // Transaction observers run in the publication turn, before any later Core
    // callback can overtake this exact structural truth. One broken observer is
    // contained: it must never prevent SSE delivery or another observer seeing it.
    for (const observer of [...this.observers]) {
      try { observer(snapshot); } catch { /* observer ownership stops here */ }
    }

    if (previous === null) return;
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
    for (const client of [...this.clients]) {
      if (client.blocked) {
        client.pendingSeek = frame;
        continue;
      }
      this.writeSeek(client, frame);
    }
  }

  snapshot(): Snapshot | null { return this.current; }

  /** Observe future structural publications synchronously. Does not replay current. */
  observe(observer: SnapshotObserver): () => void {
    this.observers.add(observer);
    let listening = true;
    return (): void => {
      if (!listening) return;
      listening = false;
      this.observers.delete(observer);
    };
  }

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

    const client: Client = {
      response, ip, blocked: false, pendingSnapshot: null, pendingSeek: null, lastRevision: null,
    };
    this.clients.add(client);
    const close = (): void => this.drop(client);
    response.once('close', close);
    response.once('error', close);
    this.write(client, 'retry: 3000\n: connected revision=' + String(snapshot.revision) + '\n\n');

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
   * A named frame every 10 s. EventSource deliberately hides SSE comments from
   * JavaScript, so the old comment heartbeat could never reset the screen's
   * 25-second watchdog: an idle but healthy screen reconnected forever. A named
   * event is visible while still carrying no id and therefore no revision.
   */
  heartbeat(now: number): void {
    const payload = 'event: heartbeat\ndata: {"at":' + String(now) + '}\n\n';
    for (const client of [...this.clients]) {
      // Heartbeats are disposable. The pending structural snapshot will prove
      // liveness as soon as a slow socket drains.
      if (!client.blocked) this.write(client, payload);
    }
  }

  closeAll(): void {
    for (const client of [...this.clients]) this.drop(client);
  }

  private broadcast(event: string, revision: number, data: unknown): void {
    for (const client of [...this.clients]) this.send(client, event, revision, data);
  }

  private send(client: Client, event: string, revision: number, data: unknown): void {
    if (client.blocked) {
      this.queueCurrent(client);
      return;
    }
    const payload = 'event: ' + event + '\nid: ' + String(revision) + '\ndata: ' + JSON.stringify(data) + '\n\n';
    if (this.write(client, payload)) client.lastRevision = revision;
  }

  private writeSeek(client: Client, frame: SeekFrame): void {
    const payload = 'event: seek\ndata: ' + JSON.stringify(frame) + '\n\n';
    this.write(client, payload);
  }

  /** Keep one full snapshot and one seek frame, regardless of how long a screen is slow. */
  private queueCurrent(client: Client): void {
    if (this.current === null) return;
    client.pendingSnapshot = this.current;
    if (client.pendingSeek !== null && client.pendingSeek.revision !== this.current.revision) {
      client.pendingSeek = null;
    }
  }

  /**
   * Node documents a false return from Writable.write as backpressure: the bytes
   * were accepted and `drain` says when more may follow. Ending the response at
   * that point turned a temporarily slow TV into a reconnect storm.
   */
  private write(client: Client, payload: string): boolean {
    if (!this.clients.has(client)) return false;
    try {
      const ready = client.response.write(payload);
      if (!ready && !client.blocked) {
        client.blocked = true;
        client.response.once('drain', () => this.flush(client));
      }
      return true;
    } catch {
      this.drop(client);
      return false;
    }
  }

  private flush(client: Client): void {
    if (!this.clients.has(client)) return;
    client.blocked = false;

    const snapshot = client.pendingSnapshot;
    client.pendingSnapshot = null;
    if (snapshot !== null) {
      const fromRevision = client.lastRevision;
      const payload = 'event: resync\nid: ' + String(snapshot.revision) + '\ndata: ' + JSON.stringify({
        reason: 'client-backpressure', fromRevision, toRevision: snapshot.revision, snapshot,
      }) + '\n\n';
      if (this.write(client, payload)) client.lastRevision = snapshot.revision;
      if (client.blocked || !this.clients.has(client)) return;
    }

    const seek = client.pendingSeek;
    client.pendingSeek = null;
    if (seek !== null && seek.revision === client.lastRevision) this.writeSeek(client, seek);
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
