import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const fixtures = new URL('../test/fixtures/', import.meta.url);

test('the fixture table lists exactly the fixtures in the directory', () => {
  const readme = readFileSync(new URL('README.md', fixtures), 'utf8');
  const listed = [...readme.matchAll(/^\| `([^`]+\.sql)` \|/gm)].map((match) => match[1]);
  const present = readdirSync(fixtures).filter((name) => name.endsWith('.sql'));
  assert.deepEqual(listed.sort(), present.sort());
});
