#!/usr/bin/env node
// Leak grep: asserts every tracked text file (except this tool) contains
// none of the real identifiers, names, and paths observed in the source
// repositories the fixture shapes were mined from. Run whenever a fixture
// is added or edited. A hit means the scrub failed; fix the source file,
// not this list.
//
// The repository is public, so the needle list stores keyed hashes
// (HMAC-SHA256) of each real identifier instead of the plaintext — the
// guard itself must not be the thing that discloses what it exists to
// keep out. A plain hash of a short lowercase word can be reversed by
// hashing a dictionary, so the key lives outside the repository, in the
// FIXTURE_LEAK_KEY repository secret, and CI passes it in. Without the
// key the check cannot run: it skips with a notice, unless
// FIXTURE_LEAK_REQUIRE_KEY is `true` (CI sets that wherever the secret
// is available), in which case a missing key is an error. A scanned
// file is tokenized into words, and every contiguous 1-, 2-, and 3-word
// run (joined with `_`, matching how the source identifiers are spelled)
// is hashed and checked against the needle set, so a needle spelled
// `acme_bank` in the source is caught whether a scanned file spells it
// `acme_bank` or `acme bank`; a single word out of a multi-word needle
// (a bare `acme`) is not, by itself, a hash the needle set contains.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const self = fileURLToPath(import.meta.url);

// Real names observed in the source corpora, stored as keyed hashes of
// the lowercase identifier: databases, schemas, warehouses, roles,
// integrations, storage accounts, business and vendor words. Generic
// Snowflake/system vocabulary (SYSADMIN, INFORMATION_SCHEMA,
// CURRENT_TIMESTAMP, ...) is deliberately absent.
//
// Five of the original plaintext needles were bare, everyday English
// words (live, dev, test, locally, reporting) that this file's own
// prose, and the repo's docs and workflow YAML, use constantly with no
// connection to the private corpus. A repo-wide scan against them is
// pure noise: measured against this checkout, they fired 39 times with
// zero real leaks, while every multi-word or proper-noun needle fired
// zero times outside the fixtures they were mined from. Those five stay
// scoped to `test/fixtures/*.sql`, the same narrow scope this check
// always ran in; every other needle now runs against the whole
// repository.
const fixtureOnlyNeedleHashes = new Set([
  'aa6551d61900c13443eabb8e085d3cafe5dd83e1fb6bd7b33948e9c6122e7d77', // live
  '0d4c883182134ac8a47ef11ec8431eb19b76d60dd511b7b74cb32405d9dab43d', // dev
  '5dcdf47e2f064cf8183d24250168b650a56e3e11dd70ad7b4e8eb74d7824ec43', // test
  '89446346069d06232ea2ff9ce7f9f2d14de5e32679add9238bce6656f0145c6e', // locally
  'ceeae302dcbd6f7513a74767bf5ffc0b4ec56b6c7d8619c737d6e18f5dcde5f7', // reporting
]);

const broadNeedleHashes = new Set([
  '6d831ace4fe4abc407e4391996ce2e5997b324655d1e7d9499b1f3a3ff8598ed',
  '469107e7c2402cde06ea3d9354fa8774b4db4b05891c0c324c4d48f373abd728',
  '9780c550e63a53d2a7ffab2e27d9c4f336c4317983c9e66c6542917d310f7a6f',
  'f9e7fd177bcc3f012ef4c980b746cbaf0b11bd46ec0bd02cfa9e409a346d09a2',
  'f7af79f8af1e0a7ed553fe9acdef009f97b02250909941d266137c9141e71fab',
  '16496dd34de1a5d428a72e16ef5b0077dde8cc4738bd56a386f7406a742d13d2',
  'cab351ac40c149539fbd215912a0bc7f8eb6ab10e9cb983d23a6e8a9c0d49112',
  'cfd5ad4dc79867d1c5dbf460a0d481d95c53054a1e84038fb49ad665a830cc50',
  '1282046d39742cf9bab4ea0eede631350cbc465b90654ff32f7645d69d3e3cc3',
  '748dfd245d070017f73f8c62230a7d6c7b4b8868e466c2c2df7df8b4c47ef6fb',
  'e4cbd27e482e610bfd4243b41b2ab38af0ead9cc8ebd3630a9ef105de3fa23ce',
  '8937a98b9d87360a15734bce9696d6074181c50e51ee536ae6ed3abdc72b303c',
  'da96d6101f44cc3c5f02247ab521ea321f5bdb0cb21b862cce7e1b2e32e02a35',
  '121e2757663d676a840cd3e318903f109ddff759fed4c8f7015d548bbe022c1c',
  '03870078d6aa441c11776f3a585c6f824a046c0712ee3a3a8775af3b015dbff7',
  '9f6e462fa4c4d087eb8af7f312b18035614661b55bd64b383517babfccc068c5',
  '6628b87bda7ca4fd57fe59e2d8c37da51dd946d8bda3b2f76a78a2cc50ceaca8',
  'd814430e9517de5d4b8e89595ea4e1529fab880f15e2d2a693162be887997350',
  '36ee9b09d558e610479823bc8e0b7e8adc63c525e5da828afa6bf7172edcb6ea',
  'c3a6ad894269e5fa8d634f8ddf42927edc9f161d44da56076abd841693b39ac3',
  '6724751faf3c3baa98d276bb76a75394960967fba4093336356837014a2327d8',
  '9aaf772d92e62065982d6f97f92456d117da6fc1d3f1f9b53a1685e3cd4fd74d',
  '396f4b0f9131d31901da1c21c046b89cf6a3bbb9bcfe1f9538ac14807d73a693',
  'f7dc9deb4d7b7490e34609767a154c0385d3ea2d51b515d21a7189d1e35a1a46',
  '37a00afa496f0e477ba449d67240d8d7e7329bfdbaf76b76e3922a405d88e56d',
  'ca381b662d04bc7737f11ce7e6b7926ac95a58ca8c0c976ad340b012725752d5',
  '89fc9487d31aa66f464cc0f66f8a4ea5170d2dcb74a0e55f2fc5b790eed1961a',
  '5fef556de974ca2be5e3606219b53d3550e9fc3de30edab48819a775720c74d5',
  '2f11bf83c9225af873e9218d6ca8c35412a295671257eb4aaab7e48d5a52f79c',
  '7359db15f39dc7774125e6c3e38e761808c0e302c7f272d758d9a913fb58366d',
  'd57f2c9888a4bf471b109be1341d803bf9060f40a2c2c2b0550423a64374d463',
  '915bb7d3991aaf719130953710f67bf2a954aa3c070d27071ed3e47b05834433',
  '9e2b3a9e886166fb87fb8913f6a4739cade05eca9c50ebd658d40e68f06122f1',
  '2f9329cbeb8670551a9dd462783493c6621ee19464b6f850a113f19883db3b7c',
  '74dbff3e39677ccc3bc90428f235180547c6d65fc38689bf02e91e4536dc8b20',
]);

// Generated files (regenerated wholesale from grammar/ source on every
// `tree-sitter generate`) and dependency lockfiles carry no authored
// content of their own, so scanning them only spends time re-checking
// text this tool already covers via its source, or vendored dependency
// metadata that was never derived from the private corpus.
const skip = new Set([
  'src/parser.c',
  'src/grammar.json',
  'src/node-types.json',
  'package-lock.json',
  'Cargo.lock',
]);

const key = process.env.FIXTURE_LEAK_KEY;
if (!key) {
  if (process.env.FIXTURE_LEAK_REQUIRE_KEY === 'true') {
    console.error('FIXTURE_LEAK_KEY is not set, so the leak check cannot run.');
    process.exit(1);
  }
  console.log('skipped: FIXTURE_LEAK_KEY is not set (fork pull requests and local runs)');
  process.exit(0);
}

function keyedHash(text) {
  return createHmac('sha256', key).update(text).digest('hex');
}

// The keyed hash of a fixed public string under the key the needles were
// computed with. A wrong key (a rotated secret, a stray newline, a
// placeholder) would make every needle miss and the scan report clean, so
// the check refuses to run unless the key reproduces this value. Rotating
// the key means recomputing every needle and this line together.
const CANARY_HASH = 'bab0c17a72479dd627d21381c4dab9d2d1008aa15f0dde38e516d3b25c53eef9';
if (keyedHash('fixture-leak-key-check') !== CANARY_HASH) {
  console.error(
    'FIXTURE_LEAK_KEY is not the key the needles were computed with, so the leak check cannot run.',
  );
  process.exit(1);
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function ngramHashes(text) {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const hashes = new Set();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      hashes.add(keyedHash(words.slice(i, i + n).join('_')));
    }
  }
  return hashes;
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let hits = 0;
let scanned = 0;
for (const relPath of tracked) {
  if (skip.has(relPath)) continue;
  const fullPath = join(repo, relPath);
  if (fullPath === self) continue;
  const stat = statSync(fullPath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) continue;
  const buffer = readFileSync(fullPath);
  if (isBinary(buffer)) continue;
  scanned++;
  const found = ngramHashes(buffer.toString('utf8'));
  const applicable =
    relPath.startsWith('test/fixtures/') && relPath.endsWith('.sql')
      ? [...broadNeedleHashes, ...fixtureOnlyNeedleHashes]
      : broadNeedleHashes;
  for (const hash of applicable) {
    if (found.has(hash)) {
      console.log(`LEAK ${relPath}: matches needle hash ${hash.slice(0, 12)}...`);
      hits++;
    }
  }
}

console.log(
  hits
    ? `${hits} leak(s) found`
    : `clean: ${scanned} tracked files scanned, no source-corpus identifiers`,
);
process.exit(hits ? 1 : 0);
