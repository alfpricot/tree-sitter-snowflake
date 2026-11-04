// Finds `keyword_*` node kinds the grammar exports (src/node-types.json)
// that queries/highlights.scm never captures. highlights.scm lists keyword
// kinds by hand, so a keyword added to the grammar renders uncolored until
// someone remembers to list it; the test beside this file fails CI instead.
// A keyword named only in a `;` comment is not captured, so comments are
// stripped before matching. Query strings in this file never contain `;`.
export function missingKeywordCaptures(nodeTypes, highlights) {
  const code = highlights.replace(/;.*$/gm, '');
  const captured = new Set(code.match(/\(keyword_[A-Za-z0-9_]+\)/g)?.map((m) => m.slice(1, -1)));
  const kinds = new Set(
    nodeTypes.filter((n) => n.named && n.type.startsWith('keyword_')).map((n) => n.type),
  );
  return [...kinds].filter((k) => !captured.has(k)).sort();
}
