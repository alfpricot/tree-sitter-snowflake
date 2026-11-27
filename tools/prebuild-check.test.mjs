import assert from 'node:assert/strict';
import test from 'node:test';
import { missingPrebuilds } from './prebuild-check.mjs';

const pack = (...paths) => JSON.stringify([{ files: paths.map((path) => ({ path })) }]);
const linux = 'prebuilds/linux-x64/tree-sitter-snowflake.node';
const windows = 'prebuilds/win32-x64/tree-sitter-snowflake.node';

test('a tarball with both addons is complete', () => {
  assert.deepEqual(missingPrebuilds(pack('package.json', linux, windows)), []);
});

test('each platform without an addon file is reported', () => {
  assert.deepEqual(missingPrebuilds(pack(linux)), ['win32-x64']);
  assert.deepEqual(missingPrebuilds(pack('prebuilds/linux-x64/README.md', windows)), ['linux-x64']);
  assert.deepEqual(missingPrebuilds(pack('package.json')), ['linux-x64', 'win32-x64']);
});

test('the keyed output of newer npm releases is read too', () => {
  const keyed = JSON.stringify({ pkg: { files: [{ path: linux }, { path: windows }] } });
  assert.deepEqual(missingPrebuilds(keyed), []);
});
