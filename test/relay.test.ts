import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtRelay } from '../src/art/relay.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

function slowFetch(delayMs: number, seen: string[], peak: { value: number }, active: { value: number }) {
  return async (input: string | URL | Request): Promise<Response> => {
    seen.push(String(input));
    active.value += 1;
    peak.value = Math.max(peak.value, active.value);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    active.value -= 1;
    return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
}

test('a wall of zones asking at once all get their artwork', async () => {
  // The regression this exists for: the relay used to return null the moment its
  // concurrency cap was reached, so a 22-zone wall left ~7 tiles permanently blank.
  const seen: string[] = [];
  const peak = { value: 0 };
  const active = { value: 0 };
  const relay = new ArtRelay({
    artworkUrl: (key) => 'http://core/api/image/' + key,
    fetchImpl: slowFetch(20, seen, peak, active) as unknown as typeof fetch,
    maxConcurrent: 4,
  });

  const tokens: string[] = [];
  for (let index = 0; index < 22; index += 1) {
    const ref = relay.pathFor('key' + String(index).padStart(4, '0'), 'cover');
    assert.ok(ref);
    tokens.push(ArtRelay.tokenFromPath(ref.path)!);
  }
  const results = await Promise.all(tokens.map((token) => relay.resolve(token)));
  assert.equal(results.filter((r) => r !== null).length, 22, 'every zone must get its art');
  assert.ok(peak.value <= 4, 'the concurrency cap must still hold, saw peak ' + String(peak.value));
  assert.equal(seen.length, 22);
});

test('the same token in flight is shared, not fetched twice', async () => {
  const seen: string[] = [];
  const relay = new ArtRelay({
    artworkUrl: (key) => 'http://core/api/image/' + key,
    fetchImpl: slowFetch(10, seen, { value: 0 }, { value: 0 }) as unknown as typeof fetch,
  });
  const ref = relay.pathFor('shared', 'cover');
  const token = ArtRelay.tokenFromPath(ref!.path)!;
  const [a, b, c] = await Promise.all([relay.resolve(token), relay.resolve(token), relay.resolve(token)]);
  assert.ok(a && b && c);
  assert.equal(seen.length, 1, 'three simultaneous asks must share one fetch');
});

test('cover and bg are separate tokens against separate size classes', () => {
  const relay = new ArtRelay({ artworkUrl: () => '' });
  const cover = relay.pathFor('samekey', 'cover');
  const bg = relay.pathFor('samekey', 'bg');
  assert.ok(cover && bg);
  assert.notEqual(cover.path, bg.path, 'the same image at two sizes must not share a token');
  assert.equal(cover.key, bg.key);
});

test('a non-image, an oversize body and a bad status are all just "no artwork"', async () => {
  const relay = new ArtRelay({
    artworkUrl: (key) => 'http://core/api/image/' + key,
    maxBytes: 1024,
    fetchImpl: (async (input: string) => {
      if (input.includes('html')) return new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      if (input.includes('huge')) return new Response(Buffer.alloc(4096), { status: 200, headers: { 'Content-Type': 'image/png' } });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch,
  });
  for (const key of ['htmlkey', 'hugekey', 'missingkey']) {
    const ref = relay.pathFor(key, 'cover');
    const resource = await relay.resolve(ArtRelay.tokenFromPath(ref!.path)!);
    assert.equal(resource, null, key + ' must resolve to no artwork, not an exception');
  }
});

test('an unminted or malformed token is refused', async () => {
  const relay = new ArtRelay({ artworkUrl: () => 'http://core/x' });
  assert.equal(await relay.resolve('z'.repeat(20)), null);
  assert.equal(await relay.resolve('!!'), null);
  assert.equal(ArtRelay.tokenFromPath('/api/v1/art/' + '!'.repeat(20)), null);
  assert.equal(ArtRelay.tokenFromPath('/elsewhere/abc'), null);
});
