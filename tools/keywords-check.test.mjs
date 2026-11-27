import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findDuplicateKeywordKeys, findUnusedKeywords } from './keywords-check.mjs';

test('findDuplicateKeywordKeys flags a repeated key', () => {
  assert.deepEqual(
    findDuplicateKeywordKeys(
      'export default {\n  keyword_if: _ => 1,\n  keyword_or: _ => 2,\n  keyword_if: _ => 3,\n};\n',
    ),
    ['keyword_if'],
  );
});

test('findDuplicateKeywordKeys is silent on distinct keys', () => {
  assert.deepEqual(
    findDuplicateKeywordKeys(
      'export default {\n  keyword_if: _ => 1,\n  keyword_or: _ => 2,\n};\n',
    ),
    [],
  );
});

test('grammar/keywords.js declares no keyword key twice', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../grammar/keywords.js', import.meta.url)),
    'utf8',
  );
  assert.deepEqual(findDuplicateKeywordKeys(source), []);
});

test('findUnusedKeywords reports a keyword no rule refers to', () => {
  const keywords = '  keyword_if: _ => 1,\n  keyword_or: _ => 2,\n';
  assert.deepEqual(findUnusedKeywords(keywords, ['seq($.keyword_if)']), ['keyword_or']);
  assert.deepEqual(findUnusedKeywords(keywords, ['$.keyword_if', '$.keyword_or']), []);
});

test('every declared keyword is referenced by a grammar rule', () => {
  const root = new URL('../', import.meta.url);
  const read = (path) => readFileSync(new URL(path, root), 'utf8');
  const sources = readdirSync(new URL('grammar/', root), { recursive: true })
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(`grammar/${name}`));
  assert.deepEqual(
    findUnusedKeywords(read('grammar/keywords.js'), [read('grammar.js'), ...sources]),
    [],
  );
});
