import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// The devDependencies entry in package.json is the only place the
// tree-sitter-cli version may be written by hand: Dependabot bumps that
// entry and the lockfile, and nothing else follows automatically. A second
// copy that goes stale is not cosmetic: a stale script or workflow pin runs a
// different CLI than the one that generated the committed parser. The
// allowScripts keys therefore name packages without a version, so a bump
// needs no second edit; the lockfile still fixes which version is installed.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.devDependencies['tree-sitter-cli'];
const versionLiteral = /tree-sitter-cli@(\d+\.\d+\.\d+)/g;

test('allowScripts allows the tree-sitter packages at any locked version', () => {
  assert.deepEqual(pkg.allowScripts, { 'tree-sitter-cli': true, 'tree-sitter': true });
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
