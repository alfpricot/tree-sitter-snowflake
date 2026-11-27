import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixtureResult, rootNodeName } from './fixture-result.mjs';

const valid = { status: 0, signal: null, stdout: '(program [0, 0] - [1, 0])', stderr: '' };

test('fixture validation rejects process failures and missing output', () => {
  assert.deepEqual(fixtureResult(valid, 'program'), { errors: 0, zeroWidth: 0 });
  for (const change of [
    { error: new Error('ENOENT') },
    { status: 1, stdout: '', stderr: 'Failed to load language' },
    { status: null, signal: 'SIGTERM' },
    { stdout: '' },
    { stdout: 'No language found' },
  ])
    assert.throws(() => fixtureResult({ ...valid, ...change }, 'program'));
});

test('fixture validation retains ERROR, MISSING, and zero-width checks', () => {
  assert.deepEqual(
    fixtureResult(
      {
        ...valid,
        stdout:
          '(program [0, 0] - [1, 0]\n (ERROR [0, 0] - [0, 1])\n (MISSING identifier [0, 1] - [0, 1]))',
      },
      'program',
    ),
    { errors: 2, zeroWidth: 1 },
  );
});

test('the root node name is the start rule of the grammar', () => {
  assert.equal(rootNodeName(fileURLToPath(new URL('..', import.meta.url))), 'program');
});

test('a fixture result needs a tree under the given root', () => {
  assert.throws(() => fixtureResult(valid, 'source_file'), /source_file tree/);
});
