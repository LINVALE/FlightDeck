/**
 * Loads assets/store.js — the real client module, not a copy — so the store's
 * behaviour is tested rather than re-described. It touches localStorage, which
 * does not exist under node:test, so a minimal stub is installed first.
 */
const globals = globalThis as unknown as { localStorage?: unknown };
if (globals.localStorage === undefined) {
  const map = new Map<string, string>();
  globals.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

const module = await import('../../assets/store.js');

export function createStore() {
  const store = module.createStore(() => { /* no renderer in the harness */ });
  return {
    accept: (snapshot: unknown, authoritative?: boolean) => store.accept(snapshot, authoritative),
    acceptSeek: (frame: unknown) => store.acceptSeek(frame),
    snapshot: () => store.snapshot(),
    /** The interpolated position the store would report for a zone, or null. */
    positionFor: (id: string) => {
      const snap = store.snapshot();
      if (snap === null) return null;
      const zone = snap.zones.find((z: { id: string }) => z.id === id);
      return zone === undefined ? null : store.positionSec(zone);
    },
  };
}
