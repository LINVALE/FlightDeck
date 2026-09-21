import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { QueueGateway } from '../src/roon/queue.ts';

/*
 * 2026-09-13 and 2026-09-20: FlightDeck died when the Core connection closed.
 * The SDK's Transport.close() runs Moo.clean_up(), which calls every pending
 * request's callback. Two of those led back into the dying connection: the
 * pairing callback (-> core_unpaired -> reconcile(null)) and each queue
 * subscription's callback (-> 'NetworkError' -> retire). Both sent an
 * unsubscribe; send() on the closed socket re-entered close(), a second
 * clean_up() emptied the request table, and the first loop read a missing key
 * (moo.js:206). This drives the SDK's own Moo and Transport code, not a fake.
 */
const require = createRequire(import.meta.url);
const Moo = require('node-roon-api/moo.js');
const Transport = require('node-roon-api/transport-websocket.js');

function liveConnection() {
  const sent: string[] = [];
  const transport = Object.create(Transport.prototype);
  transport.ws = { close() {}, send(buf: Buffer) { sent.push(buf.toString('utf8').split('\n')[0]); } };
  transport.interval = null;
  transport._isonopencalled = true;
  const moo = new Moo(transport);
  moo.logger = { log() {} };
  transport.moo = moo;
  // lib.js wires onclose to clean up the moo; the transport then cleans it again.
  transport.onclose = () => { moo.clean_up(); };
  // The shape node-roon-api-transport hands FlightDeck.
  const service = {
    subscribe_queue(zoneId: string, max: number, cb: (event: unknown, body: unknown) => void) {
      return moo._subscribe_helper('com.roonlabs.transport:2', 'queue', { zone_or_output_id: zoneId, max_item_count: max }, cb);
    },
  };
  return { transport, moo, service, sent };
}

test('a Core connection that closes under live queue subscriptions does not crash, and sends nothing to it', () => {
  const { transport, moo, service, sent } = liveConnection();
  const gateway = new QueueGateway();
  gateway.reconcile(service, [{ zone_id: 'study' }, { zone_id: 'garden' }, { zone_id: 'porch' }]);
  // The pairing request is pending too; its callback is how core_unpaired arrives.
  moo.send_request('com.roonlabs.registry:1/register', {}, () => { gateway.reconcile(null, []); });
  const sentBeforeClose = sent.length;

  transport.ws = undefined;          // the socket is already gone, as in ws.onclose
  assert.doesNotThrow(() => transport.close());

  assert.equal(sent.length, sentBeforeClose, 'nothing may be sent down a connection that has closed');
  assert.equal(gateway.available(), false);
  assert.equal(gateway.snapshot('study'), null);
});

test('a queue subscription the Core ends with a network error is forgotten without an unsubscribe', () => {
  const calls: { unsubscribes: number; cb: (event: unknown, body: unknown) => void }[] = [];
  const service = {
    subscribe_queue(_zoneId: string, _max: number, cb: (event: unknown, body: unknown) => void) {
      const call = { unsubscribes: 0, cb };
      calls.push(call);
      return { unsubscribe: () => { call.unsubscribes += 1; } };
    },
  };
  const gateway = new QueueGateway();
  gateway.reconcile(service, [{ zone_id: 'study' }]);
  calls[0].cb('NetworkError', undefined);
  assert.equal(calls[0].unsubscribes, 0, 'a dead connection has no subscription left to end');
  assert.equal(gateway.snapshot('study'), null);
  // A later reconcile on the same service may subscribe the zone again.
  gateway.reconcile(service, [{ zone_id: 'study' }]);
  assert.equal(calls.length, 2);
});

test('any other subscription error, on a live connection, still ends the subscription once', () => {
  let unsubscribes = 0;
  let cb: (event: unknown, body: unknown) => void = () => {};
  const service = {
    subscribe_queue(_zoneId: string, _max: number, callback: (event: unknown, body: unknown) => void) {
      cb = callback;
      return { unsubscribe: () => { unsubscribes += 1; } };
    },
  };
  const gateway = new QueueGateway();
  gateway.reconcile(service, [{ zone_id: 'study' }]);
  cb('InvalidRequest', undefined);
  cb('InvalidRequest', undefined);
  assert.equal(unsubscribes, 1);
  assert.equal(gateway.snapshot('study'), null);
});

test('changing to a different live Core still ends the old Core\'s subscriptions', () => {
  const make = () => {
    const call = { unsubscribes: 0 };
    return { call, service: { subscribe_queue: () => ({ unsubscribe: () => { call.unsubscribes += 1; } }) } };
  };
  const first = make();
  const second = make();
  const gateway = new QueueGateway();
  gateway.reconcile(first.service, [{ zone_id: 'study' }]);
  gateway.reconcile(second.service, [{ zone_id: 'study' }]);
  assert.equal(first.call.unsubscribes, 1);
});
