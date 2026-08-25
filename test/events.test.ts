import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventHub, parseLastEventId } from '../src/http/events.ts';
import type { Snapshot } from '../src/model/types.ts';

function fakeResponse() {
  const written: string[] = [];
  let headers: Record<string, string> = {};
  let status = 0;
  const handlers: Record<string, (() => void)[]> = {};
  return {
    written, get status() { return status; }, get headers() { return headers; },
    writeHead(code: number, head?: Record<string, string>) { status = code; headers = head ?? {}; return this; },
    flushHeaders() { /* noop */ },
    write(chunk: string) { written.push(chunk); return true; },
    end(chunk?: string) { if (chunk !== undefined) written.push(chunk); return this; },
    once(event: string, handler: () => void) { (handlers[event] ??= []).push(handler); return this; },
    fire(event: string) { for (const handler of handlers[event] ?? []) handler(); },
    text() { return written.join(''); },
  };
}

function snapshot(revision: number): Snapshot {
  return {
    revision, generatedAt: new Date(revision * 1000).toISOString(),
    core: { state: 'paired', name: 'ROCK', sinceAt: '2026-08-25T20:00:00.000Z' },
    zones: [],
  };
}

test('a fresh client gets a full snapshot', () => {
  const hub = new EventHub();
  hub.publish(snapshot(5));
  const response = fakeResponse();
  hub.open(response as never, '10.0.0.1', undefined);
  assert.equal(response.status, 200);
  assert.match(response.text(), /event: snapshot\nid: 5\n/);
});

test('Last-Event-ID exactly one behind gets an update, a gap gets a resync', () => {
  const hub = new EventHub();
  hub.publish(snapshot(5));
  const near = fakeResponse();
  hub.open(near as never, '10.0.0.1', '4');
  assert.match(near.text(), /event: update\nid: 5\n/);

  const far = fakeResponse();
  hub.open(far as never, '10.0.0.2', '2');
  assert.match(far.text(), /event: resync/);
  assert.match(far.text(), /"reason":"history-gap"/);
});

test('a client ahead of the server resyncs rather than being trusted', () => {
  const hub = new EventHub();
  hub.publish(snapshot(3));
  const ahead = fakeResponse();
  hub.open(ahead as never, '10.0.0.3', '9');
  assert.match(ahead.text(), /"reason":"revision-ahead"/);
});

test('a consecutive revision broadcasts update; a jump broadcasts resync', () => {
  const hub = new EventHub();
  hub.publish(snapshot(1));
  const client = fakeResponse();
  hub.open(client as never, '10.0.0.4', undefined);
  hub.publish(snapshot(2));
  assert.match(client.text(), /event: update\nid: 2\n/);
  hub.publish(snapshot(7));
  assert.match(client.text(), /event: resync\nid: 7\n/);
  assert.match(client.text(), /"reason":"source-gap"/);
});

test('a seek frame carries no id, so it never moves a client revision', () => {
  const hub = new EventHub();
  hub.publish(snapshot(4));
  const client = fakeResponse();
  hub.open(client as never, '10.0.0.5', undefined);
  const before = client.written.length;
  hub.publishSeek({ revision: 4, at: '2026-08-25T21:00:00.000Z', zones: [{ id: 'a', positionSec: 12 }] });
  const frame = client.written.slice(before).join('');
  assert.match(frame, /event: seek/);
  assert.ok(!/\nid: /.test(frame), 'a seek frame must not carry an id');
});

test('an empty seek frame is not sent at all', () => {
  const hub = new EventHub();
  hub.publish(snapshot(4));
  const client = fakeResponse();
  hub.open(client as never, '10.0.0.6', undefined);
  const before = client.written.length;
  hub.publishSeek({ revision: 4, at: '2026-08-25T21:00:00.000Z', zones: [] });
  assert.equal(client.written.length, before);
});

test('per-IP and total client caps refuse rather than exhaust', () => {
  const hub = new EventHub();
  hub.publish(snapshot(1));
  const accepted = [];
  for (let index = 0; index < 8; index += 1) {
    const response = fakeResponse();
    hub.open(response as never, '10.0.0.7', undefined);
    accepted.push(response);
  }
  assert.equal(hub.clientCount, 8);
  const refused = fakeResponse();
  hub.open(refused as never, '10.0.0.7', undefined);
  assert.equal(refused.status, 503);
  // A different screen in the house is still welcome.
  const other = fakeResponse();
  hub.open(other as never, '10.0.0.8', undefined);
  assert.equal(other.status, 200);
});

test('a closed socket is dropped from the client set', () => {
  const hub = new EventHub();
  hub.publish(snapshot(1));
  const client = fakeResponse();
  hub.open(client as never, '10.0.0.9', undefined);
  assert.equal(hub.clientCount, 1);
  client.fire('close');
  assert.equal(hub.clientCount, 0);
});

test('opening before any snapshot exists says so instead of hanging', () => {
  const hub = new EventHub();
  const client = fakeResponse();
  hub.open(client as never, '10.0.0.10', undefined);
  assert.equal(client.status, 503);
});

test('a malformed Last-Event-ID is treated as absent', () => {
  assert.equal(parseLastEventId(undefined), null);
  assert.equal(parseLastEventId(''), null);
  assert.equal(parseLastEventId('nonsense'), null);
  assert.equal(parseLastEventId('-3'), null);
  assert.equal(parseLastEventId('7'), 7);
});
