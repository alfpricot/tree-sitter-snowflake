import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  canSkipEditedBuild,
  changedPaths,
  docsOnly,
  handlersChangelogDated,
  needsRustFloor,
  needsScannerFuzz,
  needsWindowsBinding,
  verifyResults,
  versionsAgree,
} from './ci-policy.mjs';

test('Node packaging changes receive Windows binding verification before merge', () => {
  for (const path of [
    'bindings/node/index.js',
    'bindings/node/index.d.ts',
    'binding.gyp',
    'package.json',
    'package-lock.json',
    '.github/workflows/verify.yml',
  ])
    assert(needsWindowsBinding([path]));
  assert(!needsWindowsBinding(['README.md', 'grammar.js', 'snowflake-handlers/src/lib.rs']));
});

test('renames include the removed source path when classifying prose', () => {
  const files = changedPaths('base', 'head', (command, args) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['diff', '--no-renames', '--name-only', '-z', 'base...head']);
    return 'docs/grammar.md\0grammar.js\0';
  });
  assert(!docsOnly(files));
});

test('only explicit prose and metadata paths skip builds', () => {
  assert(docsOnly(['README.md', 'docs/CONSUMER_INTEGRATION.md']));
  assert(
    docsOnly([
      'LICENSE',
      'NOTICE',
      '.editorconfig',
      '.gitattributes',
      '.github/CODEOWNERS',
      '.github/dependabot.yml',
    ]),
  );
  for (const files of [
    [],
    ['grammar.js'],
    ['README.md', 'package.json'],
    ['snowflake-handlers/README.md'],
    ['test/fixtures/README.md'],
    ['.github/workflows/verify.yml'],
    ['bindings/node/LICENSE'],
    ['LICENSE', 'binding.gyp'],
  ])
    assert(!docsOnly(files));
});

test('the Rust floor build runs only for paths a crate builds from', () => {
  for (const path of [
    'grammar.js',
    'grammar/types.js',
    'src/parser.c',
    'queries/tags.scm',
    'Cargo.toml',
    'bindings/rust/lib.rs',
    'snowflake-handlers/src/lib.rs',
    '.github/workflows/verify.yml',
  ])
    assert(needsRustFloor([path]), path);
  assert(
    !needsRustFloor(['tools/ci-policy.mjs', 'bindings/node/index.js', 'package.json', 'README.md']),
  );
});

test('the scanner is fuzzed when it or the fuzz step changes', () => {
  assert(needsScannerFuzz(['src/scanner.c']));
  assert(needsScannerFuzz(['.github/workflows/verify.yml']));
  assert(!needsScannerFuzz(['src/parser.c', 'grammar.js']));
});

test('a promotion needs a dated section for the handlers version', () => {
  const cargo = '[package]\nversion = "0.4.0"\n';
  handlersChangelogDated(cargo, '## [Unreleased]\n\n## [0.4.0](url) - 2026-01-02\n');
  assert.throws(
    () => handlersChangelogDated(cargo, '## [0.4.0](url) - Unreleased\n'),
    /Unreleased/,
  );
  assert.throws(() => handlersChangelogDated(cargo, '## [Unreleased]\n'), /no section/);
});

function results(build = 'true', event = 'pull_request', rust = build) {
  return Object.fromEntries(
    ['changes', 'verify', 'consumer-pin', 'node-binding', 'pr-title'].map((job) => [
      job,
      {
        result:
          (job === 'pr-title' && event !== 'pull_request') ||
          (['verify', 'consumer-pin', 'node-binding'].includes(job) && build === 'false') ||
          (job === 'consumer-pin' && rust === 'false')
            ? 'skipped'
            : 'success',
        ...(job === 'changes' ? { outputs: { build, rust } } : {}),
      },
    ]),
  );
}

test('aggregate accepts only deliberate skips', () => {
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    for (const [build, rust] of [
      ['true', 'true'],
      ['true', 'false'],
      ['false', 'false'],
    ]) {
      const valid = results(build, event, rust);
      verifyResults(valid, event, false);
      assert.throws(() => verifyResults(valid, event, true));
      for (const job of Object.keys(valid)) {
        for (const result of ['failure', 'cancelled', 'skipped']) {
          if (valid[job].result === result) continue;
          assert.throws(() =>
            verifyResults({ ...valid, [job]: { ...valid[job], result } }, event, false),
          );
        }
      }
    }
  }
});

test('canSkipEditedBuild only skips a title/body edit whose prior run already verified this head SHA', () => {
  assert(canSkipEditedBuild({ action: 'edited', changes: {} }, true));
  assert(
    !canSkipEditedBuild({ action: 'edited', changes: {} }, false),
    'must not skip when the prior run for this SHA did not succeed or does not exist',
  );
  assert(
    !canSkipEditedBuild({ action: 'edited', changes: { base: { from: 'main' } } }, true),
    'a base-branch retarget always needs a full run',
  );
  assert(
    !canSkipEditedBuild({ action: 'synchronize', changes: {} }, true),
    'only an edited action is eligible at all',
  );
});

test('versionsAgree passes when all three manifests match', () => {
  versionsAgree(
    '[package]\nversion = "0.1.1"\n',
    '{"version":"0.1.1"}',
    '{"metadata":{"version":"0.1.1"}}',
  );
});

test('versionsAgree rejects a package.json or tree-sitter.json version drift', () => {
  assert.throws(() =>
    versionsAgree(
      '[package]\nversion = "0.1.1"\n',
      '{"version":"0.1.0"}',
      '{"metadata":{"version":"0.1.1"}}',
    ),
  );
  assert.throws(() =>
    versionsAgree(
      '[package]\nversion = "0.1.1"\n',
      '{"version":"0.1.1"}',
      '{"metadata":{"version":"0.1.0"}}',
    ),
  );
});

test('Cargo.toml, package.json, and tree-sitter.json agree on the current version', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  versionsAgree(
    readFileSync(join(root, 'Cargo.toml'), 'utf8'),
    readFileSync(join(root, 'package.json'), 'utf8'),
    readFileSync(join(root, 'tree-sitter.json'), 'utf8'),
  );
});
