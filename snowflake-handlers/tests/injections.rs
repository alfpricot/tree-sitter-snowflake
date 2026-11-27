//! The grammar's injection query, run against the embedded-language parsers
//! this crate links.

use snowflake_handlers::{
    Language,
    tree_sitter::{self, Parser, Query, QueryCursor, Range, StreamingIterator},
};
use tree_sitter_snowflake::{INJECTIONS_QUERY, LANGUAGE};

/// The text of each match the query injects as `language`, across the whole
/// SQL text, with the ranges an injected parser would be given.
fn injected(sql: &str, language: &str) -> Vec<Vec<Range>> {
    let grammar = LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&grammar).unwrap();
    let tree = parser.parse(sql, None).unwrap();
    assert!(!tree.root_node().has_error(), "{sql}");
    let query = Query::new(&grammar, INJECTIONS_QUERY).unwrap();
    let content = query.capture_index_for_name("injection.content").unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), sql.as_bytes());
    let mut documents = Vec::new();
    while let Some(matched) = matches.next() {
        let settings = query.property_settings(matched.pattern_index);
        let injects = settings.iter().any(|p| {
            p.key.as_ref() == "injection.language" && p.value.as_deref() == Some(language)
        });
        if injects {
            assert!(
                settings
                    .iter()
                    .all(|p| p.key.as_ref() != "injection.combined"),
                "each body is its own document"
            );
            documents.push(
                matched
                    .nodes_for_capture_index(content)
                    .map(|node| node.range())
                    .collect(),
            );
        }
    }
    documents
}

fn texts<'sql>(sql: &'sql str, documents: &[Vec<Range>]) -> Vec<&'sql str> {
    documents
        .iter()
        .map(|ranges| {
            assert_eq!(ranges.len(), 1, "{ranges:?}");
            &sql[ranges[0].start_byte..ranges[0].end_byte]
        })
        .collect()
}

#[test]
fn each_plain_single_quoted_body_is_injected_on_its_own() {
    for (name, first, second) in [
        ("JAVASCRIPT", "return a", "return b"),
        ("PYTHON", "def f(a):\n  return a", "def g(b):\n  return b"),
    ] {
        let sql = format!(
            "CREATE FUNCTION f(a FLOAT) RETURNS FLOAT LANGUAGE {name} AS '{first}';
CREATE FUNCTION g(b FLOAT) RETURNS FLOAT LANGUAGE {name} AS '{second}';"
        );
        let documents = injected(&sql, &name.to_lowercase());
        assert_eq!(texts(&sql, &documents), [first, second], "{name}");
    }
}

#[test]
fn a_body_that_needs_decoding_is_not_injected() {
    for name in ["JAVASCRIPT", "PYTHON"] {
        for body in ["a = ''x''", r"a = \'x\'", r"return a\n", "x''", ""] {
            let sql = format!("CREATE PROCEDURE p() RETURNS STRING LANGUAGE {name} AS '{body}';");
            let documents = injected(&sql, &name.to_lowercase());
            assert!(documents.is_empty(), "{name} {body:?}: {documents:?}");
        }
    }
}

#[test]
fn an_injected_single_quoted_body_parses_as_its_language() {
    let sql = "CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS '
  var total = 1;
  return total;
';";
    let documents = injected(sql, "javascript");
    let mut parser = Parser::new();
    parser
        .set_language(&Language::JavaScript.grammar().unwrap())
        .unwrap();
    parser.set_included_ranges(&documents[0]).unwrap();
    let tree: tree_sitter::Tree = parser.parse(sql, None).unwrap();
    assert!(
        !tree.root_node().has_error(),
        "{}",
        tree.root_node().to_sexp()
    );
}

#[test]
fn java_single_quoted_bodies_are_not_injected() {
    let sql = "CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVA AS 'class A {}';";
    let documents = injected(sql, "java");
    assert!(documents.is_empty(), "{documents:?}");
}
