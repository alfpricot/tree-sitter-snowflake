// This is the reference copy shared with other tree-sitter grammar repositories.
// A fix made here should be carried over to them.

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Strips ANSI color codes from `tree-sitter parse`'s terminal output.
export function stripAnsi(text) {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

// Finds the locally installed tree-sitter CLI binary, checked under each
// given directory in turn, falling back to a bare `tree-sitter` lookup on
// PATH if none has one. Shared by every tool here that shells out to the
// CLI, so there is one place that knows the Windows/POSIX binary names.
export function resolveTreeSitterCli(...dirs) {
  for (const dir of dirs) {
    for (const name of ['tree-sitter.exe', 'tree-sitter']) {
      const path = join(dir, 'node_modules/tree-sitter-cli', name);
      if (statSync(path, { throwIfNoEntry: false })?.isFile()) return path;
    }
  }
  return 'tree-sitter';
}

// The grammar's start rule, which tree-sitter takes to be the first rule.
export function rootNodeName(repo) {
  const grammar = JSON.parse(readFileSync(join(repo, 'src/grammar.json'), 'utf8'));
  const [root] = Object.keys(grammar.rules);
  assert(root, 'src/grammar.json lists no rules');
  return root;
}

export function fixtureResult(proc, root) {
  assert(!proc.error, `Could not run parser: ${proc.error?.message}`);
  assert.equal(proc.signal, null, `Parser terminated by ${proc.signal}`);
  assert.equal(proc.status, 0, `Parser exited ${proc.status}: ${proc.stderr}`);
  const tree = stripAnsi(proc.stdout);
  assert(new RegExp(`^\\(${root}\\s`, 'm').test(tree), `Parser did not return a ${root} tree`);
  return {
    errors: (tree.match(/ERROR|MISSING/g) || []).length,
    zeroWidth: (tree.match(/\[([0-9]+), ([0-9]+)\] - \[\1, \2\]/g) || []).length,
  };
}
