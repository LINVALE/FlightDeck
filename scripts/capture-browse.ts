/**
 * Capture what Roon's Browse API ACTUALLY returns.
 *
 * The 2026-08-25 scout was explicit that the search hierarchy's live shape is
 * unverified — two plausible call forms, neither ever run. Building a genre
 * picker on a guess would mean building it twice, so this records the real
 * shapes into test/fixtures/ before any UI exists.
 *
 *   node scripts/capture-browse.ts            # walk the default hierarchies
 *   node scripts/capture-browse.ts search "miles davis"
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FLIGHTDECK_URL ?? 'http://127.0.0.1';
const OUT = resolve(fileURLToPath(import.meta.url), '..', '..', 'test', 'fixtures', 'browse');

async function call(body: unknown): Promise<unknown> {
  const response = await fetch(BASE + '/api/v1/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; }
  catch { return { status: response.status, raw: text.slice(0, 400) }; }
}

function show(label: string, value: unknown): void {
  process.stdout.write('\n=== ' + label + ' ===\n');
  process.stdout.write(JSON.stringify(value, null, 1).slice(0, 2600) + '\n');
}

const captured: Record<string, unknown> = {};

async function probe(label: string, body: unknown): Promise<void> {
  const result = await call(body);
  captured[label] = { request: body, result };
  show(label, result);
}

const hierarchy = process.argv[2] ?? '';
const input = process.argv[3] ?? '';

if (hierarchy === '') {
  // The root of each hierarchy: what categories exist, and what hints they carry.
  for (const h of ['browse', 'genres', 'albums', 'artists', 'playlists', 'internet_radio']) {
    await probe('root:' + h, { hierarchy: h, popAll: true });
    await probe('load:' + h, { hierarchy: h, load: true, count: 12 });
  }
} else {
  // The unsettled question: is `input` accepted on the hierarchy itself, or only
  // through the root Search item's input_prompt?
  await probe('search:direct', { hierarchy: 'search', popAll: true, input });
  await probe('search:load', { hierarchy: 'search', load: true, count: 12 });
  await probe('root:search', { hierarchy: 'search', popAll: true });
  await probe('root:search:load', { hierarchy: 'search', load: true, count: 12 });
}

mkdirSync(OUT, { recursive: true });
const name = hierarchy === '' ? 'hierarchies.json' : 'search.json';
writeFileSync(resolve(OUT, name), JSON.stringify(captured, null, 1), 'utf8');
process.stdout.write('\nwrote test/fixtures/browse/' + name + '\n');
