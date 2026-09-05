/**
 * A thin, honest wrapper over Roon's Browse service.
 *
 * Search and the other hierarchies keep Roon's own server-side stack semantics.
 * Their live shapes are recorded in docs/browse-shapes.md; this layer simply
 * passes those structures through, sanitised and bounded.
 */

export interface BrowseItem {
  readonly title: string;
  readonly subtitle: string | null;
  readonly imageKey: string | null;
  readonly itemKey: string | null;
  readonly hint: string | null;
  readonly input: { readonly prompt: string; readonly action: string } | null;
}

export interface BrowseList {
  readonly title: string;
  readonly subtitle: string | null;
  readonly count: number;
  readonly level: number;
  readonly hint: string | null;
  readonly imageKey: string | null;
}

export interface BrowseResult {
  readonly action: string;
  readonly list: BrowseList | null;
  readonly message: string | null;
  readonly isError: boolean;
  readonly items: readonly BrowseItem[];
  readonly offset: number;
}

const MAX_ITEMS = 200;
const MAX_TEXT = 400;
/** Session keys come from a browser; keep them to a shape we choose. */
export const SESSION_KEY = /^[A-Za-z0-9_-]{4,64}$/;
export const HIERARCHIES = new Set([
  'browse', 'playlists', 'settings', 'internet_radio', 'albums', 'artists', 'genres', 'composers', 'search',
]);

function text(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== 'string') return fallback;
  // Roon titles are library data, not markup: drop control characters and cap.
  // The one markup Roon does send is its own link form on streaming results —
  // `[[673402|Dua Lipa]]` (measured 2026-09-05 on a TIDAL album's subtitle) —
  // which a screen must read as the name alone.
  return value
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, MAX_TEXT);
}

function sanitizeItem(raw: unknown): BrowseItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const title = text(item.title, '');
  if (title === null) return null;
  const prompt = (item.input_prompt ?? null) as Record<string, unknown> | null;
  return {
    title,
    subtitle: text(item.subtitle),
    imageKey: typeof item.image_key === 'string' ? item.image_key : null,
    itemKey: typeof item.item_key === 'string' ? item.item_key : null,
    hint: text(item.hint),
    input: prompt === null ? null : {
      prompt: text(prompt.prompt, '') ?? '',
      action: text(prompt.action, 'Go') ?? 'Go',
    },
  };
}

function sanitizeList(raw: unknown): BrowseList | null {
  if (raw === null || typeof raw !== 'object') return null;
  const list = raw as Record<string, unknown>;
  return {
    title: text(list.title, '') ?? '',
    subtitle: text(list.subtitle),
    count: typeof list.count === 'number' ? list.count : 0,
    level: typeof list.level === 'number' ? list.level : 0,
    hint: text(list.hint),
    imageKey: typeof list.image_key === 'string' ? list.image_key : null,
  };
}

export interface BrowseCall {
  readonly hierarchy: string;
  readonly sessionKey: string;
  readonly itemKey?: string;
  readonly input?: string;
  readonly popAll?: boolean;
  /** Roon keeps the browse stack server-side, so going BACK is popping levels. */
  readonly popLevels?: number;
  readonly zoneId?: string;
  readonly offset?: number;
  readonly count?: number;
}

export class BrowseGateway {
  private readonly service: () => unknown;
  private readonly timeoutMs: number;
  /** Roon keeps ONE stack per (hierarchy, multi_session_key); calls are serialised per session. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(service: () => unknown, timeoutMs = 8000) {
    this.service = service;
    this.timeoutMs = timeoutMs;
  }

  available(): boolean { return this.service() !== null; }

  async browse(call: BrowseCall): Promise<BrowseResult> {
    const body = await this.serialised(call.sessionKey, () => this.invoke('browse', {
      hierarchy: call.hierarchy,
      multi_session_key: call.sessionKey,
      ...(call.itemKey === undefined ? {} : { item_key: call.itemKey }),
      ...(call.input === undefined ? {} : { input: call.input.slice(0, MAX_TEXT) }),
      ...(call.popAll === true ? { pop_all: true } : {}),
      ...(typeof call.popLevels === 'number' && call.popLevels > 0
        ? { pop_levels: Math.min(16, Math.round(call.popLevels)) } : {}),
      // The JSDoc says this is required only for playback, but every prior
      // implementation passed it on every call; a play action fails without it.
      ...(call.zoneId === undefined ? {} : { zone_or_output_id: call.zoneId }),
    }));
    const result = (body ?? {}) as Record<string, unknown>;
    return {
      action: text(result.action, 'none') ?? 'none',
      list: sanitizeList(result.list),
      message: text(result.message),
      isError: result.is_error === true,
      items: [],
      offset: 0,
    };
  }

  async load(call: BrowseCall): Promise<BrowseResult> {
    const body = await this.serialised(call.sessionKey, () => this.invoke('load', {
      hierarchy: call.hierarchy,
      multi_session_key: call.sessionKey,
      offset: Math.max(0, call.offset ?? 0),
      count: Math.min(MAX_ITEMS, Math.max(1, call.count ?? 100)),
    }));
    const result = (body ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(result.items) ? result.items : [];
    const items: BrowseItem[] = [];
    for (const raw of rawItems.slice(0, MAX_ITEMS)) {
      const item = sanitizeItem(raw);
      if (item !== null) items.push(item);
    }
    return {
      action: 'list',
      list: sanitizeList(result.list),
      message: null,
      isError: false,
      items,
      offset: typeof result.offset === 'number' ? result.offset : 0,
    };
  }

  /** Roon keeps one stack per session; parallel calls corrupt the level. */
  private serialised(sessionKey: string, work: () => Promise<unknown>): Promise<unknown> {
    const previous = this.chains.get(sessionKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    const settled = next.catch(() => undefined);
    this.chains.set(sessionKey, settled);
    // The key is identity, not history. Retaining every screen ever seen would
    // turn browsing over months into an unbounded Map even after all calls end.
    void settled.then(() => {
      if (this.chains.get(sessionKey) === settled) this.chains.delete(sessionKey);
    });
    return next;
  }

  private invoke(method: 'browse' | 'load', options: Record<string, unknown>): Promise<unknown> {
    const service = this.service() as Record<string, (o: unknown, cb: unknown) => void> | null;
    if (service === null) return Promise.reject(new Error('browse unavailable'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('browse timeout'));
      }, this.timeoutMs);
      service[method](options, (error: unknown, body: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error !== false && error !== undefined && error !== null) reject(new Error(String(error)));
        else resolve(body);
      });
    });
  }
}
