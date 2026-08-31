import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The shipped browser module is intentionally plain ES2018 JavaScript.
import { createStream } from '../assets/stream.js';

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly url: string;
  closed = false;

  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(kind: string, listener: Listener): void {
    const found = this.listeners.get(kind) ?? [];
    found.push(listener);
    this.listeners.set(kind, found);
  }
  fire(kind: string, data = '{}'): void {
    for (const listener of this.listeners.get(kind) ?? []) listener({ data });
  }
  close(): void { this.closed = true; }
}

function runtime() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const original = {
    EventSource: globals.EventSource, document: globals.document, fetch: globals.fetch,
    setTimeout: globals.setTimeout, clearTimeout: globals.clearTimeout,
  };
  let nextTimer = 0;
  const timers = new Map<number, { handler: () => void; delay: number }>();
  const documentListeners = new Map<string, (() => void)[]>();
  const fakeDocument = {
    hidden: false,
    addEventListener(kind: string, listener: () => void): void {
      const found = documentListeners.get(kind) ?? [];
      found.push(listener);
      documentListeners.set(kind, found);
    },
    fire(kind: string): void { for (const listener of documentListeners.get(kind) ?? []) listener(); },
  };

  FakeEventSource.instances = [];
  globals.EventSource = FakeEventSource;
  globals.document = fakeDocument;
  globals.fetch = () => new Promise(() => { /* deliberately pending */ });
  globals.setTimeout = (handler: () => void, delay = 0) => {
    nextTimer += 1;
    timers.set(nextTimer, { handler, delay });
    return nextTimer;
  };
  globals.clearTimeout = (id: number) => { timers.delete(id); };

  return {
    document: fakeDocument,
    timers,
    run(delay: number): void {
      const due = [...timers.entries()].filter((entry) => entry[1].delay === delay);
      for (const [id, timer] of due) { timers.delete(id); timer.handler(); }
    },
    restore(): void {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete globals[key]; else globals[key] = value;
      }
    },
  };
}

function store() {
  return { accept(): void {}, acceptSeek(): void {} };
}

test('the first structural event on every connection is a baseline even when named update', () => {
  const env = runtime();
  try {
    const accepted: { revision: number; authoritative: boolean | undefined }[] = [];
    const fakeStore = {
      accept(data: { revision: number }, authoritative?: boolean): void {
        accepted.push({ revision: data.revision, authoritative });
      },
      acceptSeek(): void {},
    };
    const stream = createStream(fakeStore, () => {});
    const first = FakeEventSource.instances[0];
    first.fire('update', '{"revision":1}');
    first.fire('update', '{"revision":2}');
    assert.deepEqual(accepted, [
      { revision: 1, authoritative: true },
      { revision: 2, authoritative: false },
    ]);

    first.fire('error');
    env.run(1000);
    const second = FakeEventSource.instances[1];
    second.fire('update', '{"revision":5}');
    assert.deepEqual(accepted.at(-1), { revision: 5, authoritative: true });
    stream.stop();
  } finally { env.restore(); }
});

test('a named heartbeat resets the watchdog on an otherwise idle screen', () => {
  const env = runtime();
  try {
    const stream = createStream(store(), () => {});
    const source = FakeEventSource.instances[0];
    assert.equal(source.url, '/api/v1/events');
    assert.equal([...env.timers.values()].filter((t) => t.delay === 25000).length, 1);
    const firstWatchdog = [...env.timers.keys()][0];
    source.fire('heartbeat', '{"at":1234}');
    assert.equal(env.timers.has(firstWatchdog), false, 'heartbeat replaces the old watchdog');
    assert.equal([...env.timers.values()].filter((t) => t.delay === 25000).length, 1);
    stream.stop();
    assert.equal(env.timers.size, 0);
  } finally { env.restore(); }
});

test('error, wake and stale callbacks still produce exactly one replacement stream', () => {
  const env = runtime();
  try {
    const stream = createStream(store(), () => {});
    const first = FakeEventSource.instances[0];
    first.fire('error');                    // schedules a backed-off reconnect
    env.document.fire('visibilitychange'); // supersedes it with an immediate one
    assert.equal([...env.timers.values()].filter((t) => t.delay === 0).length, 1);
    assert.equal([...env.timers.values()].filter((t) => t.delay === 1000).length, 0);

    env.run(0);
    assert.equal(FakeEventSource.instances.length, 2, 'one recovery trigger, one replacement');
    const second = FakeEventSource.instances[1];
    assert.equal(first.closed, true);
    first.fire('error');                    // stale socket cannot schedule another
    assert.equal(FakeEventSource.instances.length, 2);
    assert.equal([...env.timers.values()].filter((t) => t.delay < 25000).length, 0);
    second.fire('heartbeat');
    assert.equal([...env.timers.values()].filter((t) => t.delay === 25000).length, 1);
    stream.stop();
  } finally { env.restore(); }
});
