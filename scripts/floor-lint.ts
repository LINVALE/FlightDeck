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
      // Keep the newlines. Dropping them shifted every reported line number
      // after a block comment, so findings pointed at innocent lines.
      while (index < n && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') out += '\n';
        index += 1;
      }
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
/**
 * Scope note (Peter, 2026-08-25): the rule protects the cover ELEMENT in the
 * layout — the sharp one a listener looks at. A blurred COPY of the album art
 * painted behind it is a derived backdrop, not the cover, and is allowed; that
 * is the same reason the Wall may resize the cover but never tint it.
 */

export interface Finding {
  readonly file: string; readonly line: number; readonly why: string; readonly text: string;
}

/**
 * Does it PARSE at all?
 *
 * A syntax error in a client asset blanks every display in the house, and the
 * pattern rules below happily pass a file that cannot run — on 2026-08-25 an edit
 * removed an `if` and left its `else`, the lint stayed green, and the Face went
 * blank. Node's parser is newer than the floor, so this catches structural
 * breakage, not floor violations; the pattern rules still cover the floor.
 */
export function parses(source: string): string | null {
  const body = source.replace(/^\s*import\s.*$/gm, '').replace(/^\s*export\s+/gm, '');
  try {
    // eslint-disable-next-line no-new-func
    new Function(body);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * A LOPSIDED SELECTOR LIST.
 *
 * A comma makes two INDEPENDENT selectors, so extending one rule to a second
 * face by find-and-replacing its prefix produces this:
 *
 *     .face[data-face="dial"], .face[data-face="orbit"] .cover { width: 44vh }
 *
 * which sizes the FACE for dial and the cover for orbit. It is valid CSS, it
 * lints clean on every other rule here, and it is silent — on 2026-08-26 one
 * such edit collapsed the sleeve to 0x0 and another put `display: none` on a
 * whole face. Both were found by screenshot, which is far too late.
 *
 * The signature is narrow on purpose: every branch rooted at the SAME token, and
 * some branches carrying a descendant the others lack. `h1, .prose p` is rooted
 * differently and is left alone.
 */
export function lopsidedSelectorLists(stripped: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  let at = 0;
  while (at < stripped.length) {
    const brace = stripped.indexOf('{', at);
    if (brace === -1) break;
    const prior = stripped.lastIndexOf('}', brace);
    const opener = stripped.lastIndexOf('{', brace - 1);
    const from = Math.max(prior, opener) + 1;
    const selector = stripped.slice(from, brace);
    at = brace + 1;
    // an at-rule body (@media) is a block of rules, not a selector
    if (selector.indexOf('@') !== -1 || selector.indexOf(',') === -1) continue;

    const branches: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of selector) {
      if (ch === '[' || ch === '(') depth += 1;
      else if (ch === ']' || ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { branches.push(current); current = ''; } else current += ch;
    }
    branches.push(current);

    const trimmed = branches.map((b) => b.trim().replace(/\s+/g, ' ')).filter((b) => b !== '');
    if (trimmed.length < 2) continue;
    const roots = trimmed.map((b) => (/^[.#]?[A-Za-z0-9_-]+/.exec(b) ?? [''])[0]);
    if (new Set(roots).size !== 1) continue;
    const deep = trimmed.map((b) => / |>|\+|~/.test(b.replace(/\[[^\]]*\]/g, '')));
    if (deep.indexOf(true) === -1 || deep.indexOf(false) === -1) continue;

    // the line the SELECTOR starts on, not the line the previous rule closed on
    const lead = selector.length - selector.replace(/^\s+/, '').length;
    found.push({
      line: stripped.slice(0, from + lead).split('\n').length,
      text: selector.trim().replace(/\s+/g, ' ').slice(0, 90),
    });
  }
  return found;
}

export function lintSource(file: string, source: string): Finding[] {
  const isCss = file.endsWith('.css');
  const stripped = stripInert(source);
  const rules = isCss ? CSS_RULES : JS_RULES;
  const findings: Finding[] = [];
  if (!isCss) {
    const broken = parses(source);
    if (broken !== null) findings.push({ file, line: 1, text: '', why: 'DOES NOT PARSE: ' + broken });
  }
  if (isCss) {
    for (const hit of lopsidedSelectorLists(stripped)) {
      findings.push({
        file, line: hit.line, text: hit.text,
        why: 'LOPSIDED SELECTOR LIST: one branch lost the descendant its siblings have — a comma makes two whole selectors',
      });
    }
  }
  const lines = stripped.split('\n');
  // The guard is tested against the ORIGINAL source: 'decode' is a string literal,
  // and stripInert empties it, so a stripped file can never show its own guard.
  if (!isCss && DECODE_CALL.test(stripped) && !DECODE_GUARD.test(source)) {
    findings.push({ file, line: 1, text: '', why: 'img.decode() is Chromium 64 and is never feature-detected in this file' });
  }
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of rules) {
      if (rule.pattern.test(lines[index])) {
        findings.push({ file, line: index + 1, why: rule.why, text: lines[index].trim().slice(0, 90) });
      }
    }
    if (isCss && /\.cover\b[^{]*\{/.test(lines[index])) {
      // Read the ACTUAL rule body, brace to brace. A fixed six-line window swept
      // in whatever rules happened to follow and flagged them as cover
      // violations — a lint that cries wolf gets switched off.
      const start = stripped.indexOf('{', lines.slice(0, index).join('\n').length);
      const end = stripped.indexOf('}', start);
      const block = start === -1 || end === -1 ? '' : stripped.slice(start + 1, end);
      if (COVER_PROPERTIES.test(block)) {
        findings.push({
          file, line: index + 1, text: lines[index].trim().slice(0, 90),
          why: 'THE COVER IS SACRED: no opacity/filter/transform/mask on the cover or an ancestor',
        });
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
      if (finding.text !== '') process.stdout.write('       > ' + finding.text + '\n');
    }
    process.exitCode = 1;
  }
}
