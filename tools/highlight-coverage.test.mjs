import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { missingKeywordCaptures } from './highlight-coverage.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('missingKeywordCaptures lists keyword kinds with no capture', () => {
  const nodeTypes = [
    { type: 'keyword_select', named: true },
    { type: 'keyword_from', named: true },
    { type: 'identifier', named: true },
    { type: 'keyword_unnamed', named: false },
  ];
  assert.deepEqual(missingKeywordCaptures(nodeTypes, '[(keyword_select)] @keyword'), [
    'keyword_from',
  ]);
});

test('missingKeywordCaptures is silent when every keyword is captured', () => {
  const nodeTypes = [{ type: 'keyword_select', named: true }];
  assert.deepEqual(missingKeywordCaptures(nodeTypes, '(keyword_select) @keyword'), []);
});

test('missingKeywordCaptures ignores a keyword named only in a comment', () => {
  const nodeTypes = [{ type: 'keyword_select', named: true }];
  assert.deepEqual(missingKeywordCaptures(nodeTypes, '; (keyword_select) is colored elsewhere'), [
    'keyword_select',
  ]);
});

test('queries/highlights.scm captures every keyword the grammar exports', () => {
  const nodeTypes = JSON.parse(read('../src/node-types.json'));
  assert.deepEqual(missingKeywordCaptures(nodeTypes, read('../queries/highlights.scm')), []);
});
