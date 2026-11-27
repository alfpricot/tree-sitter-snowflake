import assert from 'node:assert';
import { test } from 'node:test';
import Parser from 'tree-sitter';

test('can load grammar', async () => {
  const parser = new Parser();
  await assert.doesNotReject(async () => {
    const { default: language } = await import('./index.js');
    parser.setLanguage(language);
  });
});

test('exports node type metadata', async () => {
  const { default: language } = await import('./index.js');
  assert(Array.isArray(language.nodeTypeInfo));
  assert(language.nodeTypeInfo.some((node) => node.type === 'program'));
});

test('every exported query compiles against the grammar', async () => {
  const { default: language } = await import('./index.js');
  for (const name of [
    'HIGHLIGHTS_QUERY',
    'INJECTIONS_QUERY',
    'LOCALS_QUERY',
    'STRUCTURE_QUERY',
    'TAGS_QUERY',
    'FOLDS_QUERY',
    'INDENTS_QUERY',
  ]) {
    assert.equal(typeof language[name], 'string', `${name} is not exported`);
    assert.doesNotThrow(() => new Parser.Query(language, language[name]), name);
  }
});

test('the folds query covers scripting blocks, CTEs, and dollar-quoted bodies', async () => {
  const { default: language } = await import('./index.js');
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`EXECUTE IMMEDIATE $$
BEGIN
  WITH c AS (SELECT 1) SELECT * FROM c;
END
$$;`);
  assert.equal(tree.rootNode.hasError, false);
  const folded = new Parser.Query(language, language.FOLDS_QUERY)
    .captures(tree.rootNode)
    .map(({ node }) => node.type);
  assert.deepEqual(folded.sort(), ['block', 'cte', 'dollar_quoted_script']);
});

test('exports the snowflake language name', async () => {
  const { default: language } = await import('./index.js');
  assert.equal(language.name, 'snowflake');
});

test('parses a dollar-quoted body without error', async () => {
  const { default: language } = await import('./index.js');
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(
    'CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS $$return 1;$$;',
  );
  assert.equal(tree.rootNode.hasError, false);
});
