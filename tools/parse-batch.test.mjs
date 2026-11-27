import assert from 'node:assert/strict';
import test from 'node:test';
import { batchParse, byteOffset, lineStarts, treeSitterEnv } from './lib/parse-batch.mjs';

test('lineStarts and byteOffset accurately compute UTF-8 byte positions', () => {
  const text = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
  const starts = lineStarts(text);
  assert.deepEqual(starts, [0, 10, 20]);
  assert.equal(byteOffset(starts, 0, 0), 0);
  assert.equal(byteOffset(starts, 1, 7), 17);

  // Multi-byte character (3 bytes in UTF-8)
  const nonAscii = 'SELECT "★";\nSELECT 1;';
  const nonAsciiStarts = lineStarts(nonAscii);
  // 'SELECT "★";\n' length in bytes: 7 + 1 + 3 + 1 + 1 + 1 = 14 bytes
  assert.deepEqual(nonAsciiStarts, [0, 14]);
  assert.equal(byteOffset(nonAsciiStarts, 1, 0), 14);
});

test('a row past the end stays a number', () => {
  assert.equal(byteOffset([0, 10], 5, 3), 3);
});

test('only Windows forces gcc', () => {
  assert.deepEqual(treeSitterEnv('win32', { A: '1' }), { A: '1', CC: 'gcc', CXX: 'g++' });
  assert.deepEqual(treeSitterEnv('linux', { A: '1' }), { A: '1' });
});

const source = (name) => `<source name="${name}">\n<program></program>\n</source>\n`;

test('batchParse splits the items into batches and pairs each with its XML', () => {
  const items = Array.from({ length: 41 }, (_, i) => `/scratch/${i}.sql`);
  const sizes = [];
  const run = (_cli, [, , ...files]) => {
    sizes.push(files.length);
    return { stdout: files.map(source).join(''), stderr: '', status: 1 };
  };
  const parsed = batchParse({ tool: 't', cli: 'ts', cwd: '.', items, path: (f) => f, run });
  const first = parsed.next().value;
  assert.deepEqual(sizes, [40], 'the next batch runs only when it is reached');
  const results = [first, ...parsed];
  assert.deepEqual(sizes, [40, 1]);
  assert.deepEqual(
    results.map(({ item }) => item),
    items,
  );
  assert(results.every(({ body }) => body.includes('<program>')));
});

const partialRun = () => ({ stdout: source('/a.sql'), stderr: 'no compiler', status: 1 });

const parsePartial = (items) => [
  ...batchParse({ tool: 't', cli: 'ts', cwd: '.', items, path: (f) => f, run: partialRun }),
];

test('batchParse refuses a batch the CLI did not fully report', () => {
  assert.throws(() => parsePartial(['/a.sql', '/b.sql']), /parsed only 1\/2.*no compiler/s);
  assert.throws(() => parsePartial(['/b.sql']), /could not match/);
  const missing = batchParse({
    tool: 't',
    cli: 'ts',
    cwd: '.',
    items: ['/a.sql'],
    path: (f) => f,
    run: () => ({ error: new Error('ENOENT') }),
  });
  assert.throws(() => missing.next(), /could not run ts: ENOENT/);
});
