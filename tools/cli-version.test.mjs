import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// The devDependencies entry in package.json is the only place the
// tree-sitter-cli version may be written by hand: Dependabot bumps that
// entry and the lockfile, and nothing else follows automatically. A second
// copy that goes stale is not cosmetic — a stale allowScripts key makes
// npm 12 block the CLI's install script, so a fresh clone ends up with no
// binary, and a stale script or workflow pin runs a different CLI than the
// one that generated the committed parser. These checks fail CI on the
// bump itself instead of after merge.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.devDependencies['tree-sitter-cli'];
const versionLiteral = /tree-sitter-cli@(\d+\.\d+\.\d+)/g;

test('allowScripts allows exactly the devDependency tree-sitter-cli version', () => {
  const keys = Object.keys(pkg.allowScripts ?? {}).filter((key) =>
    key.startsWith('tree-sitter-cli@'),
  );
  assert.deepEqual(keys, [`tree-sitter-cli@${version}`]);
});

test('no npm script or workflow pins a literal tree-sitter-cli version', () => {
  const texts = [readFileSync(new URL('../package.json', import.meta.url), 'utf8')];
  const workflows = new URL('../.github/workflows/', import.meta.url);
  for (const name of readdirSync(workflows)) {
    if (/\.ya?ml$/.test(name)) texts.push(readFileSync(new URL(name, workflows), 'utf8'));
  }
  for (const text of texts) {
    for (const match of text.matchAll(versionLiteral)) {
      assert.equal(
        match[1],
        version,
        `literal tree-sitter-cli@${match[1]} lags devDependencies (${version}); read the version from package.json instead`,
      );
    }
  }
});
