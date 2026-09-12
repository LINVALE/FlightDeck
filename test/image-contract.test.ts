import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const dockerfile = read('Dockerfile');
const ignore = read('.dockerignore').split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : [path];
  });
}

test('the image copies exactly the documents the server serves', () => {
  const served = [...read('src/http/server.ts').matchAll(/file: '([a-z-]+\.md)'/g)].map((m) => `docs/${m[1]}`).sort();
  const copied = [...dockerfile.matchAll(/docs\/([a-z-]+\.md)/g)].map((m) => `docs/${m[1]}`);
  assert.deepEqual([...new Set(copied)].sort(), served);
  assert.deepEqual(ignore.filter((line) => line.startsWith('!docs/')).map((line) => line.slice(1)).sort(), served);
});

test('.dockerignore is an allowlist that never admits pairing state, logs, tests or scripts', () => {
  assert.equal(ignore[0], '*', 'everything is excluded first');
  for (const line of ignore.slice(1)) {
    assert.ok(line.startsWith('!'), `${line} must be an explicit allow`);
    assert.doesNotMatch(line, /^!(data|logs|test|scripts|node_modules|\.git|\.claude)(\/|$)/, `${line} must never ship`);
  }
});

test('package.json lists exactly the Roon packages the code loads', () => {
  const required = new Set<string>();
  for (const file of sourceFiles('src').filter((path) => path.endsWith('.ts'))) {
    for (const m of read(file).matchAll(/(?:require\(|from )\s*['"](node-roon-api[a-z-]*)['"]/g)) required.add(m[1]!);
  }
  const declared = Object.keys((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies);
  assert.deepEqual(declared.sort(), [...required].sort());
  for (const [name, spec] of Object.entries((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies)) {
    assert.match(spec, /^https:\/\/codeload\.github\.com\/roonlabs\/[a-z-]+\/tar\.gz\/[0-9a-f]{40}$/, `${name} is pinned to an exact commit`);
  }
});

test('the image runs one fixed port, non-root, with data only in /data, from a digest-pinned base', () => {
  assert.match(dockerfile, /^ARG NODE_IMAGE=node:[0-9.]+-bookworm-slim@sha256:[0-9a-f]{64}$/m);
  assert.match(dockerfile, /FLIGHTDECK_PORT=8440/);
  assert.match(dockerfile, /FLIGHTDECK_DATA=\/data/);
  assert.match(dockerfile, /FLIGHTDECK_BROWSE=1/, 'fixed: changing it makes Roon park the extension until re-enabled');
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "\/app\/src\/main\.ts"\]$/m);
  assert.match(dockerfile, /^HEALTHCHECK .* CMD \["node", "\/app\/src\/healthcheck\.ts"\]$/m);
  assert.match(dockerfile, /rm -f \/usr\/local\/bin\/npm /, 'no package manager in the final image');
});

test('the standalone compose file runs the image read-only on the LAN, with its data on a volume', () => {
  const compose = read('release/compose.yaml');
  assert.match(compose, /image: "\$\{FLIGHTDECK_IMAGE:\?/);
  assert.match(compose, /network_mode: host/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /- \.\/data:\/data/);
  assert.doesNotMatch(compose, /ports:/, 'host networking: no port publishing to widen');
});
