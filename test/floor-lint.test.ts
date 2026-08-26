import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lopsidedSelectorLists, lintSource } from '../scripts/floor-lint.ts';

/**
 * These are the two real edits that got through on 2026-08-26. Both were valid
 * CSS, both lint-clean under every pattern rule, and both were only found by
 * looking at a screenshot: one collapsed the sleeve to 0x0, the other put
 * `display: none` on a whole face.
 */
test('catches the comma that sizes the face instead of the cover', () => {
  const css = '.face[data-face="dial"], .face[data-face="orbit"] .cover { width: 44vh; }';
  const hits = lopsidedSelectorLists(css);
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /data-face="orbit"/);
});

test('catches the comma that blanks a whole face', () => {
  const css = '.face[data-face="dial"][data-view="artist"], .face[data-face="orbit"][data-view="artist"] .dial-reading { display: none; }';
  assert.equal(lopsidedSelectorLists(css).length, 1);
});

test('reports it through lintSource, with the line', () => {
  const css = '.a { color: red; }\n\n.face[data-face="dial"], .face[data-face="orbit"] .cover { width: 44vh; }\n';
  const findings = lintSource('face.css', css);
  const hit = findings.find((f) => f.why.indexOf('LOPSIDED') === 0);
  assert.ok(hit, 'the lopsided list should be reported');
  assert.equal(hit.line, 3);
});

test('leaves honest selector lists alone', () => {
  for (const css of [
    'h1, .prose p { margin: 0; }',                       // different roots: ordinary CSS
    '.face .zone, .face .cog { opacity: 0; }',           // every branch equally deep
    '.dial-remain,\n.dial-ends { display: none; }',      // no branch has a descendant
    '.zone, .status, .cog { transition: opacity .35s; }',
    '.face[data-ring] .title,\n.face[data-ring] .line2 { margin-left: auto; }',
    '@media (max-width: 900px) { .a, .b { color: red; } }',
  ]) {
    assert.deepEqual(lopsidedSelectorLists(css), [], css);
  }
});

test('the shipped stylesheet is free of them', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../assets/face.css', import.meta.url), 'utf8');
  assert.deepEqual(lopsidedSelectorLists(css), []);
});
