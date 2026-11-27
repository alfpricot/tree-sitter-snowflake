// Checks on the `keyword_*` rules in grammar/keywords.js.

// Finds repeated `keyword_*` object keys. JavaScript
// silently keeps the later declaration, so a duplicate key is a correctness
// bug: an edit to the earlier copy has no effect on the grammar.
export function findDuplicateKeywordKeys(source) {
  const seen = new Set();
  const duplicates = new Set();
  for (const match of source.matchAll(/^\s*(keyword_[A-Za-z0-9_]*)\s*:/gm)) {
    const key = match[1];
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

// The `keyword_*` rules declared in keywords.js that no rule refers to.
// tree-sitter drops an unreferenced rule without a word, so a leftover
// declaration reads as accepted syntax when it is not.
export function findUnusedKeywords(keywordSource, grammarSources) {
  const used = new Set();
  for (const source of [keywordSource, ...grammarSources]) {
    for (const match of source.matchAll(/\$\.(keyword_[A-Za-z0-9_]*)/g)) used.add(match[1]);
  }
  const declared = keywordSource.matchAll(/^\s*(keyword_[A-Za-z0-9_]*)\s*:/gm);
  return [...declared].map((match) => match[1]).filter((key) => !used.has(key));
}
