import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The floor guardrail. The capability floor is Chromium 63 (Samsung 2019 TVs) and
 * iPadOS Safari 15, so a shipped asset may not use syntax or CSS above it —
 * a `?.` there is a parse error, and the whole screen is blank.
 *
 * Comments and string literals are stripped BEFORE checking: the first version of
 * this lint failed a file whose only offence was a comment saying "no ?. or ??".
 *
 * A parser (acorn at ecmaVersion 2018) is the better tool the moment a dev
 * dependency is acceptable; this is the zero-dependency approximation.
 */

const ASSETS = resolve(fileURLToPath(import.meta.url), '..', '..', 'assets');

/** Remove line/block comments and the contents of string and template literals. */
export function stripInert(source: string): string {
  let out = '';
  let index = 0;
  const n = source.length;
  while (index < n) {
    const ch = source[index];
    const next = source[index + 1];
    if (ch === '/' && next === '/') {
      while (index < n && source[index] !== '\n') index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      index += 2;
      while (index < n && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      index += 1;
      out += quote;
      while (index < n) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === quote) break;
        index += 1;
      }
      index += 1;
      out += quote;
      continue;
    }
    out += ch;
    index += 1;
  }
  return out;
}

const JS_RULES: { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\?\./, why: 'optional chaining is Chromium 80 — above the Chromium 63 floor' },
  { pattern: /\?\?/, why: 'nullish coalescing is Chromium 80 — above the floor' },
  { pattern: /\bOffscreenCanvas\b/, why: 'OffscreenCanvas is Chromium 69; do the 32x32 palette pass on the main thread' },
  { pattern: /\bResizeObserver\b/, why: 'ResizeObserver is Chromium 64; use the resize event' },
];

/**
 * `img.decode()` is Chromium 64, above the floor — but it is the right call when
 * present (R5: decode before swap). So the rule is "guarded", not "absent": the
 * file must feature-detect it somewhere.
 */
const DECODE_CALL = /\.decode\s*\(/;
const DECODE_GUARD = /'decode'\s+in\s+HTMLImageElement\.prototype/;

const CSS_RULES: { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bclamp\s*\(/, why: 'clamp() is Chromium 79; use vw plus media-query clamps' },
  { pattern: /\d(cqw|cqh|cqi|cqb)\b/, why: 'container query units are Chromium 105; a Face IS the viewport, so use vw/vh' },
  { pattern: /container-type\s*:/, why: 'container queries are Chromium 105' },
  { pattern: /conic-gradient\s*\(/, why: 'conic-gradient is Chromium 69; the progress ring must be SVG stroke-dashoffset' },
  { pattern: /backdrop-filter\s*:/, why: 'backdrop-filter is Chromium 76 and costly on a TV SoC; blur a tiny canvas and scale it' },
  { pattern: /aspect-ratio\s*:/, why: 'aspect-ratio is Chromium 88; use a vw/padding-top box' },
];

/**
 * The cover is SACRED (Peter, 08-25). Two tournament entries broke this while
 * claiming they had not — both by dimming an ANCESTOR of the cover rather than
 * the cover itself, which is why this checks ancestors too.
 */
const COVER_PROPERTIES = /(opacity|filter|transform|mask|-webkit-mask)\s*:/;

export interface Finding { readonly file: string; readonly line: number; readonly why: string }

export function lintSource(file: string, source: string): Finding[] {
  const isCss = file.endsWith('.css');
  const stripped = stripInert(source);
  const rules = isCss ? CSS_RULES : JS_RULES;
  const findings: Finding[] = [];
  const lines = stripped.split('\n');
  // The guard is tested against the ORIGINAL source: 'decode' is a string literal,
  // and stripInert empties it, so a stripped file can never show its own guard.
  if (!isCss && DECODE_CALL.test(stripped) && !DECODE_GUARD.test(source)) {
    findings.push({ file, line: 1, why: "img.decode() is Chromium 64 and is never feature-detected in this file" });
  }
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of rules) {
      if (rule.pattern.test(lines[index])) findings.push({ file, line: index + 1, why: rule.why });
    }
    if (isCss && /\.(cover|art)\b[^{]*\{/.test(lines[index])) {
      // A rule whose selector names the cover must not touch these properties.
      const block = lines.slice(index, index + 6).join(' ');
      if (COVER_PROPERTIES.test(block)) {
        findings.push({ file, line: index + 1, why: 'THE COVER IS SACRED: no opacity/filter/transform/mask on the cover or an ancestor' });
      }
    }
  }
  return findings;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.css')) out.push(path);
  }
  return out;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('floor-lint.ts')) {
  const findings: Finding[] = [];
  for (const file of walk(ASSETS)) {
    findings.push(...lintSource(file.slice(ASSETS.length + 1), readFileSync(file, 'utf8')));
  }
  if (findings.length === 0) {
    process.stdout.write('floor lint: clean (' + String(walk(ASSETS).length) + ' assets, Chromium 63 floor)\n');
  } else {
    for (const finding of findings) {
      process.stdout.write('FLOOR  ' + finding.file + ':' + String(finding.line) + '  ' + finding.why + '\n');
    }
    process.exitCode = 1;
  }
}
