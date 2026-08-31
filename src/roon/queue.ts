/**
 * A small, FlightDeck-owned mirror of Roon's forward play queue.
 *
 * Roon exposes a queue only as a subscription. Keeping one subscription for
 * each zone that currently exists lets HTTP/UI readers take an ordinary
 * synchronous snapshot without creating a new Core subscription per request.
 * Reconciliation is the sole lifecycle owner: a vanished zone, replacement
 * transport service, or unpair retires the old subscription exactly once.
 */

export const QUEUE_MAX_ITEMS = 50;

export type QueueItemId = number | string;

export interface QueueItem {
  readonly qid: QueueItemId;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly length: number | null;
  readonly imageKey: string | null;
}

export interface QueueSnapshot {
  readonly zoneId: string;
  readonly ready: boolean;
  /** Changes whenever this exact zone's cached forward window changes. */
  readonly revision: number;
  /** Literal only: the 50-row window is full; Roon supplies no total/paging. */
  readonly atLimit: boolean;
  /** Roon's forward window, in order. When present, index zero is current. */
  readonly items: readonly QueueItem[];
}

export type QueueErrorCode = 'unavailable' | 'stale' | 'current' | 'invalid' | 'core-rejected';

export class QueueError extends Error {
  readonly code: QueueErrorCode;
  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
  }
}

export type QueueZone = string | {
  readonly id?: unknown;
  readonly zone_id?: unknown;
};

interface QueueSubscription {
  unsubscribe(callback?: (error?: unknown) => void): void;
}

interface QueueService {
  subscribe_queue(
    zoneId: string,
    maxItemCount: number,
    callback: (event: unknown, body: unknown) => void,
  ): QueueSubscription;
  play_from_here?(
    zoneId: string,
    queueItemId: number,
    callback: (message: unknown, body: unknown) => void,
  ): void;
}

interface QueueEntry {
  readonly zoneId: string;
  readonly service: QueueService;
  readonly epoch: number;
  rawItems: unknown[];
  ready: boolean;
  revision: number;
  retired: boolean;
  unsubscribeCalled: boolean;
  subscription: QueueSubscription | null;
}

const MAX_TEXT = 400;
const MAX_IMAGE_KEY = 1024;

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT);
}

function cleanImageKey(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_IMAGE_KEY) || null;
}

function cleanQid(value: unknown): QueueItemId | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{1,32}$/.test(value)) return value;
  return null;
}

function line(raw: Record<string, unknown>, shape: 'one_line' | 'two_line' | 'three_line', key: string): string {
  const candidate = raw[shape];
  if (candidate === null || typeof candidate !== 'object') return '';
  return cleanText((candidate as Record<string, unknown>)[key]);
}

function sanitizeItem(raw: unknown): QueueItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const qid = cleanQid(item.queue_item_id);
  if (qid === null) return null;
  const length = typeof item.length === 'number' && Number.isFinite(item.length) && item.length >= 0
    ? item.length : null;
  return {
    qid,
    title: line(item, 'three_line', 'line1')
      || line(item, 'two_line', 'line1')
      || line(item, 'one_line', 'line1'),
    artist: line(item, 'three_line', 'line2'),
    album: line(item, 'three_line', 'line3'),
    length,
    imageKey: cleanImageKey(item.image_key),
  };
}

function zoneIdOf(zone: QueueZone): string | null {
  if (typeof zone === 'string') return zone === '' ? null : zone;
  const id = typeof zone.id === 'string' ? zone.id
    : (typeof zone.zone_id === 'string' ? zone.zone_id : '');
  return id === '' ? null : id;
}

function asService(value: unknown): QueueService | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { subscribe_queue?: unknown };
  return typeof candidate.subscribe_queue === 'function' ? value as QueueService : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Apply Roon's operations in wire order; every later index sees earlier edits. */
function applyChanges(items: unknown[], raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object') return false;
    const change = candidate as Record<string, unknown>;
    const index = integer(change.index);
    if (index === null) return false;
    const operation = change.operation;
    const replacements = Array.isArray(change.items)
      ? change.items.slice(0, QUEUE_MAX_ITEMS) : [];

    if (operation === 'insert') {
      if (!Array.isArray(change.items) || index > items.length) return false;
      items.splice(index, 0, ...replacements);
    } else if (operation === 'remove') {
      if (index >= items.length) return false;
      const stated = integer(change.count);
      if (stated === null && !Array.isArray(change.items)) return false;
      const count = stated ?? (Array.isArray(change.items) ? change.items.length : 1);
      if (count <= 0 || index + count > items.length) return false;
      if (count > 0) items.splice(index, count);
    } else if (operation === 'replace') {
      if (!Array.isArray(change.items) || index + replacements.length > items.length) return false;
      items.splice(index, replacements.length, ...replacements);
    } else return false;

    if (items.length > QUEUE_MAX_ITEMS) items.length = QUEUE_MAX_ITEMS;
  }
  return true;
}

export class QueueGateway {
  private service: QueueService | null = null;
  private epoch = 0;
  private readonly entries = new Map<string, QueueEntry>();

  available(): boolean { return this.service !== null; }

  /**
   * Make subscriptions match the Core's current zone list.
   *
   * Calling this repeatedly with the same service and zones is inert. Service
   * identity is an epoch boundary even when zone ids happen to be unchanged.
   */
  reconcile(serviceValue: unknown, zones: readonly QueueZone[]): void {
    const nextService = asService(serviceValue);
    if (nextService !== this.service) {
      this.epoch += 1;
      for (const entry of this.entries.values()) this.retire(entry);
      this.entries.clear();
      this.service = nextService;
    }

    const wanted = new Set<string>();
    for (const zone of zones) {
      const id = zoneIdOf(zone);
      if (id !== null) wanted.add(id);
    }

    for (const [zoneId, entry] of this.entries) {
      if (wanted.has(zoneId)) continue;
      this.entries.delete(zoneId);
      this.retire(entry);
    }

    if (this.service === null) return;
    for (const zoneId of wanted) {
      if (!this.entries.has(zoneId)) this.subscribe(this.service, zoneId);
    }
  }

  /** A detached projection: callers cannot mutate the cached wire mirror. */
  snapshot(zoneId: string): QueueSnapshot | null {
    const entry = this.entries.get(zoneId);
    if (entry === undefined || entry.retired) return null;
    const items: QueueItem[] = [];
    for (const raw of entry.rawItems) {
      const item = sanitizeItem(raw);
      if (item !== null) items.push(item);
    }
    return {
      zoneId,
      ready: entry.ready,
      revision: entry.revision,
      atLimit: entry.rawItems.length === QUEUE_MAX_ITEMS,
      items,
    };
  }

  /**
   * Start at one exact upcoming slot. The cache revision and slot identity are
   * both mandatory because Roon may remint queue ids after any queue action.
   */
  playFromHere(zoneId: string, itemId: string, expectedRevision: number, timeoutMs = 6000): Promise<void> {
    const entry = this.entries.get(zoneId);
    if (entry === undefined || entry.retired || !entry.ready) {
      return Promise.reject(new QueueError('unavailable', 'queue is unavailable'));
    }
    if (!Number.isInteger(expectedRevision) || entry.revision !== expectedRevision) {
      return Promise.reject(new QueueError('stale', 'queue changed — reopen Queue'));
    }
    if (!/^[1-9]\d{0,15}$/.test(itemId)) {
      return Promise.reject(new QueueError('invalid', 'invalid queue item'));
    }
    const queueItemId = Number(itemId);
    if (!Number.isSafeInteger(queueItemId) || String(queueItemId) !== itemId) {
      return Promise.reject(new QueueError('invalid', 'invalid queue item'));
    }
    const matches: { index: number; raw: Record<string, unknown> }[] = [];
    for (let index = 0; index < entry.rawItems.length; index += 1) {
      const raw = entry.rawItems[index];
      if (raw === null || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (String(item.queue_item_id ?? '') === itemId) matches.push({ index, raw: item });
    }
    if (matches.length !== 1) {
      return Promise.reject(new QueueError('stale', 'queue changed — reopen Queue'));
    }
    if (matches[0].index === 0) {
      return Promise.reject(new QueueError('current', 'that item is already current'));
    }
    const play = entry.service.play_from_here;
    if (typeof play !== 'function') {
      return Promise.reject(new QueueError('unavailable', 'play from Queue is unavailable'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new QueueError('core-rejected', 'Roon queue selection timed out'));
      }, Math.max(250, Math.min(30_000, timeoutMs)));
      const finish = (error?: QueueError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error === undefined) resolve();
        else reject(error);
      };
      try {
        play.call(entry.service, zoneId, queueItemId, (message: unknown) => {
          const name = message !== null && typeof message === 'object'
            ? (message as { name?: unknown }).name : null;
          if (name === 'Success') finish();
          else finish(new QueueError('core-rejected', 'Roon refused that queue item'));
        });
      } catch {
        finish(new QueueError('core-rejected', 'Roon refused that queue item'));
      }
    });
  }

  /** Terminal convenience for shutdown; a later reconcile may still start anew. */
  dispose(): void {
    this.reconcile(null, []);
  }

  private subscribe(service: QueueService, zoneId: string): void {
    const entry: QueueEntry = {
      zoneId,
      service,
      epoch: this.epoch,
      rawItems: [],
      ready: false,
      revision: 0,
      retired: false,
      unsubscribeCalled: false,
      subscription: null,
    };
    this.entries.set(zoneId, entry);

    try {
      const subscription = service.subscribe_queue(zoneId, QUEUE_MAX_ITEMS, (event, body) => {
        this.receive(entry, event, body);
      });
      entry.subscription = subscription;
      // A deliberately synchronous fake may replace/unpair the service from its
      // callback before subscribe_queue returns its handle.
      if (entry.retired) this.unsubscribe(entry);
    } catch {
      if (this.entries.get(zoneId) === entry) this.entries.delete(zoneId);
      this.retire(entry);
    }
  }

  private receive(entry: QueueEntry, event: unknown, body: unknown): void {
    if (entry.retired
        || entry.epoch !== this.epoch
        || entry.service !== this.service
        || this.entries.get(entry.zoneId) !== entry) return;
    const payload = body !== null && typeof body === 'object'
      ? body as Record<string, unknown> : {};

    if (event === 'Subscribed') {
      entry.rawItems = Array.isArray(payload.items)
        ? payload.items.slice(0, QUEUE_MAX_ITEMS) : [];
      entry.ready = true;
      entry.revision += 1;
      return;
    }
    if (event === 'Changed') {
      if (!entry.ready || !applyChanges(entry.rawItems, payload.changes)) {
        this.restart(entry);
        return;
      }
      entry.revision += 1;
      return;
    }
    if (event === 'Unsubscribed') {
      this.entries.delete(entry.zoneId);
      // The Core has already ended this subscription; fence its callback without
      // sending a redundant unsubscribe request back to it.
      entry.retired = true;
      return;
    }

    // Any other response is a subscription error. It cannot remain a live cache.
    this.entries.delete(entry.zoneId);
    this.retire(entry);
  }

  private retire(entry: QueueEntry): void {
    if (entry.retired) return;
    entry.retired = true;
    this.unsubscribe(entry);
  }

  /** A malformed delta has no safe partial interpretation; ask for a fresh full window. */
  private restart(entry: QueueEntry): void {
    if (this.entries.get(entry.zoneId) !== entry) return;
    this.entries.delete(entry.zoneId);
    this.retire(entry);
    if (this.service === entry.service && entry.epoch === this.epoch) {
      this.subscribe(entry.service, entry.zoneId);
    }
  }

  private unsubscribe(entry: QueueEntry): void {
    if (entry.unsubscribeCalled || entry.subscription === null) return;
    entry.unsubscribeCalled = true;
    try { entry.subscription.unsubscribe(() => {}); } catch { /* already gone */ }
  }
}
