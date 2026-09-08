import { createHmac, randomBytes } from 'node:crypto';
import type { ArtRef } from '../model/types.ts';

/**
 * Parent-owned artwork relay (the shape RHEOS proved, 2026-08-14 Codex ruling):
 * the browser never sees a Roon Core URL, handle or image key — only an opaque
 * same-origin path. Bounded on MIME, size, count, TTL and concurrency; a failure
 * is simply "no artwork" (R5: the face keeps its previous art).
 */

export const ART_PATH = '/api/v1/art/';
export const ART_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
// Captured Live Radio keys are currently 224 characters. Keep accepting only
// Roon's opaque alphanumeric shape, but leave bounded room for larger keys so
// browse artwork is not silently discarded before it reaches the relay.
const IMAGE_KEY = /^[A-Za-z0-9]{1,512}$/;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Two size classes. `bg` is deliberately small: Roon's native artist images are
 * 1024x448 banners and the backdrop is blurred, so resolution is irrelevant —
 * asking for 1920 wide only makes the Core upscale (measured 08-25).
 */
export const SIZES = {
  cover: { width: 640, height: 640, scale: 'fit' },
  bg: { width: 1024, height: 576, scale: 'fit' },
  // Foreground artist: `fill` returns an exact crop at the asked size (measured
  // 2026-08-25), which is what a full-bleed 16:9 hero needs. Never used for the
  // cover — cropping a cover is exactly what "sacred" forbids.
  hero: { width: 1920, height: 1080, scale: 'fill' },
  // Browse rows: small, many at once, and scrolled — the Core scales them, so a
  // list of two thousand albums never sends a full-size sleeve down the wire.
  thumb: { width: 160, height: 160, scale: 'fit' },
  // ⚖️ The puck's own sleeve (09-08). The knob is a 360px circle and decodes
  // the JPEG itself on an ESP32, so the size it is SENT is the size it shows:
  // asking for `cover` would make a microcontroller decode four times the
  // pixels it can draw, into memory it would rather not spend.
  knob: { width: 320, height: 320, scale: 'fit' },
} as const;

export type SizeClass = keyof typeof SIZES;

export interface ArtResource { readonly contentType: string; readonly bytes: Buffer }

export interface RelayOptions {
  /** Core artwork URL for a key and size; '' while unpaired. Read per use, never latched. */
  readonly artworkUrl: (imageKey: string, size: SizeClass) => string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly maxKeys?: number;
  readonly ttlMs?: number;
  readonly maxConcurrent?: number;
  readonly timeoutMs?: number;
}

interface CacheEntry { resource: ArtResource; storedAt: number }

function bounded(value: number | undefined, fallback: number, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, Math.round(value)));
}

export class ArtRelay {
  private readonly secret = randomBytes(32);
  private readonly keys = new Map<string, { key: string; size: SizeClass }>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<ArtResource | null>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly opts: Required<Omit<RelayOptions, 'fetchImpl' | 'now'>> & { fetchImpl: typeof fetch; now: () => number };

  constructor(options: RelayOptions) {
    this.opts = {
      artworkUrl: options.artworkUrl,
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? ((): number => Date.now()),
      maxBytes: bounded(options.maxBytes, 1_048_576, 1024, 8_388_608),
      maxEntries: bounded(options.maxEntries, 96, 1, 512),
      maxKeys: bounded(options.maxKeys, 512, 1, 4096),
      ttlMs: bounded(options.ttlMs, 30 * 60_000, 1000, 24 * 60 * 60_000),
      maxConcurrent: bounded(options.maxConcurrent, 4, 1, 16),
      timeoutMs: bounded(options.timeoutMs, 6000, 250, 60_000),
    };
  }

  /** Implements ArtMinter for the projection. */
  pathFor(imageKey: unknown, size: SizeClass): ArtRef | null {
    if (typeof imageKey !== 'string' || !IMAGE_KEY.test(imageKey)) return null;
    const token = this.tokenFor(imageKey, size);
    this.keys.delete(token);
    this.keys.set(token, { key: imageKey, size });
    while (this.keys.size > this.opts.maxKeys) {
      const oldest = this.keys.keys().next().value;
      if (oldest === undefined) break;
      this.keys.delete(oldest);
    }
    return { path: ART_PATH + token, key: imageKey };
  }

  static tokenFromPath(path: string): string | null {
    if (!path.startsWith(ART_PATH)) return null;
    const token = path.slice(ART_PATH.length);
    return ART_TOKEN.test(token) ? token : null;
  }

  async resolve(token: string): Promise<ArtResource | null> {
    if (typeof token !== 'string' || !ART_TOKEN.test(token)) return null;
    const entry = this.keys.get(token);
    if (entry === undefined) return null;

    const cached = this.cache.get(token);
    if (cached !== undefined && this.opts.now() - cached.storedAt < this.opts.ttlMs) {
      this.cache.delete(token);
      this.cache.set(token, cached);
      return cached.resource;
    }
    const existing = this.inflight.get(token);
    if (existing !== undefined) return existing;

    // Wait for a slot rather than dropping the request. The first version
    // returned null the moment the cap was reached, so a wall of 22 zones asking
    // at once left the losers with a permanent hole — the cap is there to be
    // gentle with the Core, not to refuse work.
    const pending = this.acquire()
      .then(() => this.fetchOne(entry.key, entry.size))
      .then((resource) => {
      if (resource !== null) {
        this.cache.delete(token);
        this.cache.set(token, { resource, storedAt: this.opts.now() });
        while (this.cache.size > this.opts.maxEntries) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
      }
      return resource;
    }).finally(() => {
      this.release();
      this.inflight.delete(token);
    });
    this.inflight.set(token, pending);
    return pending;
  }

  /** A slot in the concurrency window; queued FIFO, bounded by the caller's timeout. */
  private acquire(): Promise<void> {
    if (this.active < this.opts.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => { this.active += 1; resolve(); });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next !== undefined) next();
  }

  private async fetchOne(imageKey: string, size: SizeClass): Promise<ArtResource | null> {
    const url = this.opts.artworkUrl(imageKey, size);
    if (url === '') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const response = await this.opts.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) return null;
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!TYPES.has(contentType)) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > this.opts.maxBytes) return null;
      return { contentType, bytes: buffer };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private tokenFor(imageKey: string, size: SizeClass): string {
    return createHmac('sha256', this.secret).update(size + ':' + imageKey).digest('base64url').slice(0, 32);
  }
}
