/**
 * Vendor a small set of Lucide icons (MIT) into assets/icons/lucide.json.
 *
 * Run once, then committed — the product NEVER fetches at runtime: the CSP is
 * `default-src 'none'` and nothing is allowed to leave the LAN. This exists so the
 * next person can see exactly where each path came from and refresh it.
 *
 * Lucide is ISC — permissive, equivalent in effect to MIT — which unlike CC BY
 * imposes no visible attribution on the running UI, only that the licence text
 * travels with the source. See THIRD-PARTY-NOTICES.md.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WANTED = [
  'guitar', 'piano', 'drum', 'mic-vocal', 'disc-3', 'radio', 'music', 'headphones',
  'audio-lines', 'boombox', 'speaker', 'church', 'globe', 'sparkles', 'theater',
  'clapperboard', 'baby', 'heart', 'sun', 'zap', 'wind', 'flame', 'snowflake', 'ship',
  'music-4', 'venetian-mask', 'shapes', 'file-music', 'library-big', 'waves',
];

const OUT = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets', 'icons', 'lucide.json');
const base = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/';
const icons = {};

for (const name of WANTED) {
  const response = await fetch(base + name + '.svg');
  if (!response.ok) { process.stdout.write('  MISSING ' + name + '\n'); continue; }
  const svg = await response.text();
  // Keep only the drawable children; the wrapper is rebuilt by the client so every
  // icon inherits our own sizing and currentColor.
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').trim()
    .replace(/\s+/g, ' ');
  icons[name] = inner;
  process.stdout.write('  ' + name.padEnd(14) + inner.length + ' bytes\n');
}

writeFileSync(OUT, JSON.stringify(icons, null, 1), 'utf8');
process.stdout.write('\nwrote assets/icons/lucide.json (' + Object.keys(icons).length + ' icons)\n');
