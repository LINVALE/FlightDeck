import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlightDeckExtension } from '../src/roon/extension.ts';

/**
 * CAPTURE FIRST. The Roon Browse API's live shapes were never recorded anywhere
 * in the RHEOS tree — the archived adapter never ran. Two candidate ways to
 * submit a search were both guesses. This probes the real Core and writes down
 * what actually comes back, so the browse feature is built on evidence.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const OUT = resolve(HERE, '..', 'test', 'fixtures', 'browse-capture.json');
const DATA = resolve(HERE, '..', 'data');
const KEY = 'flightdeck-capture';

const record: Record<string, unknown> = {};
function note(label: string, value: unknown): void {
  record[label] = value;
  const text = JSON.stringify(value);
  process.stdout.write('\n--- ' + label + '\n' + (text.length > 1400 ? text.slice(0, 1400) + '…' : text) + '\n');
}

let zoneId: string | null = null;
const extension = new FlightDeckExtension(
  { dataDir: DATA, displayVersion: '0.1.0-capture', browse: true, log: (m) => process.stdout.write(m + '\n') },
  {
    onZones: (zones) => {
      if (zoneId !== null) return;
      const first = zones.find((z) => z !== null && typeof z === 'object'
        && typeof (z as Record<string, unknown>).zone_id === 'string');
      zoneId = first === undefined ? null : String((first as Record<string, unknown>).zone_id);
    },
    onCore: (paired) => { process.stdout.write('  core event: paired=' + String(paired)
      + ' browse=' + String(extension.browseService() !== null) + '\n'); },
  },
);

function call(method: 'browse' | 'load', options: Record<string, unknown>): Promise<unknown> {
  return new Promise((done) => {
    const service = extension.browseService();
    if (service === null) { done({ error: 'browse service not granted' }); return; }
    const timer = setTimeout(() => done({ error: 'timeout' }), 8000);
    service[method](options, (error: unknown, body: unknown) => {
      clearTimeout(timer);
      done(error !== false && error !== undefined && error !== null ? { error: String(error) } : body);
    });
  });
}

extension.start();

setTimeout(async () => {
  if (extension.browseService() === null) {
    process.stdout.write('\nBrowse service was NOT granted by the Core — re-enable FlightDeck in Roon Settings.\n');
    process.exit(1);
  }
  note('zone_used', zoneId);

  // 1. The root of the `browse` hierarchy — what are the top-level entries?
  const root = await call('browse', { hierarchy: 'browse', multi_session_key: KEY, pop_all: true, zone_or_output_id: zoneId });
  note('browse_root', root);
  const rootList = await call('load', { hierarchy: 'browse', multi_session_key: KEY, offset: 0, count: 30 });
  note('browse_root_items', rootList);

  // 2. Candidate A: input submitted directly on the `search` hierarchy.
  const searchA = await call('browse', {
    hierarchy: 'search', multi_session_key: KEY + '-a', pop_all: true,
    zone_or_output_id: zoneId, input: 'Miles Davis',
  });
  note('search_input_on_hierarchy', searchA);
  const searchAItems = await call('load', { hierarchy: 'search', multi_session_key: KEY + '-a', offset: 0, count: 20 });
  note('search_input_on_hierarchy_items', searchAItems);

  // 3. The genre hierarchy — the vision's "genre pick".
  const genres = await call('browse', { hierarchy: 'genres', multi_session_key: KEY + '-g', pop_all: true, zone_or_output_id: zoneId });
  note('genres_root', genres);
  const genreItems = await call('load', { hierarchy: 'genres', multi_session_key: KEY + '-g', offset: 0, count: 20 });
  note('genres_items', genreItems);

  // 4. Walking into the first genre: does it give albums, and do items carry image_key?
  const list = (genreItems as { items?: { item_key?: string; title?: string }[] }).items;
  if (Array.isArray(list) && list.length > 0 && typeof list[0].item_key === 'string') {
    const into = await call('browse', { hierarchy: 'genres', multi_session_key: KEY + '-g', item_key: list[0].item_key, zone_or_output_id: zoneId });
    note('genre_first_level', into);
    note('genre_first_level_items', await call('load', { hierarchy: 'genres', multi_session_key: KEY + '-g', offset: 0, count: 10 }));
  }

  writeFileSync(OUT, JSON.stringify(record, null, 2));
  process.stdout.write('\nwrote ' + OUT + '\n');
  process.exit(0);
}, 20000);
