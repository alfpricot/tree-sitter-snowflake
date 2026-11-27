// The batched `tree-sitter parse -x` run shared by the parse summary, the
// parse-rate harness, and the keyword probe: one process for many files,
// because a process per file dominates the run time of all three.

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { stripAnsi } from '../fixture-result.mjs';

const BATCH = 40;

// The CLI compiles the parser with the platform's own C compiler. Windows
// machines without MSVC need gcc; elsewhere the default stays, so a machine
// with only clang works.
export function treeSitterEnv(platform = process.platform, env = process.env) {
  return platform === 'win32' ? { ...env, CC: 'gcc', CXX: 'g++' } : env;
}

// tree-sitter's row/column positions are byte offsets, but a JS string
// index is a UTF-16 code-unit offset, and the two only agree on pure ASCII
// text. Line starts are therefore computed from each line's UTF-8 byte
// length, not from the character index the `\n` was found at.
export function lineStarts(text) {
  const lines = text.split('\n');
  const starts = [0];
  let offset = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    offset += Buffer.byteLength(lines[i], 'utf8') + 1;
    starts.push(offset);
  }
  return starts;
}

// A row past the last line start counts from the beginning of the text, so
// one odd position cannot turn a byte total into NaN.
export function byteOffset(starts, row, col) {
  return (starts[row] ?? 0) + col;
}

// Parses `items` in batches and returns one { item, body } per item, where
// `body` is that file's slice of the XML. A parse error exits non-zero and
// is expected; a batch that reports fewer files than it was given means the
// CLI or the grammar failed to load, so it throws rather than passing.
export function batchParse({ tool, cli, cwd, items, path, run = spawnSync }) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const proc = run(cli, ['parse', '-x', ...batch.map(path)], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      env: treeSitterEnv(),
    });
    if (proc.error) {
      throw new Error(`${tool}: could not run ${cli}: ${proc.error.message}`);
    }
    const chunks = stripAnsi(proc.stdout).split('<source name="');
    const matched = new Set();
    for (let c = 1; c < chunks.length; c++) {
      const nl = chunks[c].indexOf('\n');
      const name = chunks[c].slice(0, nl).replace(/"?>?$/, '');
      const item =
        batch.find((f) => path(f) === name) ||
        batch.find((f) => name.replace(/\\/g, '/').endsWith(path(f).replace(/\\/g, '/')));
      if (!item) {
        throw new Error(`${tool}: could not match XML <source name="${name}"> to this batch`);
      }
      matched.add(item);
      results.push({ item, body: chunks[c].slice(nl) });
    }
    if (matched.size !== batch.length) {
      throw new Error(
        `${tool}: parsed only ${matched.size}/${batch.length} files in the batch starting at index ${i} (exit code ${proc.status}); check the C compiler and the grammar build: ${proc.stderr}`,
      );
    }
  }
  return results;
}
