//! The grammar's injection query, run against the embedded-language parsers
//! this crate links.

use snowflake_handlers::{
    Language,
    tree_sitter::{self, Parser, Query, QueryCursor, Range, StreamingIterator},
};
use tree_sitter_snowflake::{INJECTIONS_QUERY, LANGUAGE};

/// The ranges the query injects as `language`, across the whole SQL text.
fn injected(sql: &str, language: &str) -> Vec<Range> {
    let grammar = LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&grammar).unwrap();
    let tree = parser.parse(sql, None).unwrap();
    assert!(!tree.root_node().has_error(), "{sql}");
    let query = Query::new(&grammar, INJECTIONS_QUERY).unwrap();
    let content = query.capture_index_for_name("injection.content").unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), sql.as_bytes());
    let mut ranges = Vec::new();
    while let Some(matched) = matches.next() {
        let injects = query
            .property_settings(matched.pattern_index)
            .iter()
            .any(|p| {
                p.key.as_ref() == "injection.language" && p.value.as_deref() == Some(language)
            });
        if injects {
            ranges.extend(
                matched
                    .nodes_for_capture_index(content)
                    .map(|node| node.range()),
            );
        }
    }
    ranges.sort_by_key(|r| r.start_byte);
    ranges
}

fn text(sql: &str, ranges: &[Range]) -> String {
    ranges
        .iter()
        .map(|r| &sql[r.start_byte..r.end_byte])
        .collect()
}

#[test]
fn single_quoted_bodies_inject_their_content_and_escapes() {
    for (name, body, expected) in [
        (
            "JAVASCRIPT",
            r"var a = ''x''; return a + \'y\';",
            r"var a = x; return a + \'y\';",
        ),
        (
            "PYTHON",
            r"def run(a):\n    return a",
            r"def run(a):\n    return a",
        ),
    ] {
        let sql = format!("CREATE PROCEDURE p() RETURNS STRING LANGUAGE {name} AS '{body}';");
        let ranges = injected(&sql, &name.to_lowercase());
        assert_eq!(text(&sql, &ranges), expected, "{name}");
    }
}

#[test]
fn a_plain_single_quoted_body_parses_as_its_language() {
    let sql = "CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS '
  var total = 1;
  return total;
';";
    let ranges = injected(sql, "javascript");
    let mut parser = Parser::new();
    parser
        .set_language(&Language::JavaScript.grammar().unwrap())
        .unwrap();
    parser.set_included_ranges(&ranges).unwrap();
    let tree: tree_sitter::Tree = parser.parse(sql, None).unwrap();
    assert!(
        tree.root_node().to_sexp().contains("variable_declaration"),
        "{}",
        tree.root_node().to_sexp()
    );
}

#[test]
fn only_javascript_and_python_single_quoted_bodies_are_injected() {
    let sql = "CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVA AS 'class A {}';";
    let ranges = injected(sql, "java");
    assert!(ranges.is_empty(), "{ranges:?}");
}
