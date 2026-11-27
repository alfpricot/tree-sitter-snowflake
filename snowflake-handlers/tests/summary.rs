//! Integration tests for the SQL summary.
#![cfg(feature = "summary")]

use snowflake_handlers::summary::{Summary, summary};

const SQL: &str = "-- setup
CREATE ROLE r1;
CREATE TABLE db.s.t (a INT);
CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS 'return 1;';
INSERT INTO db.s.t SELECT UPPER(b) FROM src;
DROP TABLE old;";

fn created(result: &Summary) -> Vec<(&str, Option<&str>)> {
    result
        .objects
        .iter()
        .map(|o| (o.name.as_str(), o.created_by.as_deref()))
        .collect()
}

#[test]
fn lists_statement_kinds_blocks_and_names() {
    let result = summary(SQL).unwrap();
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let kinds: Vec<_> = result.statements.iter().map(|s| s.kind.as_str()).collect();
    assert_eq!(
        kinds,
        [
            "create_role",
            "create_table",
            "create_procedure",
            "insert_statement",
            "keyword_drop",
        ]
    );
    let blocks: Vec<_> = result
        .blocks
        .iter()
        .map(|b| (b.kind.as_str(), b.name.as_str()))
        .collect();
    assert_eq!(blocks, [("create_procedure", "p")]);
    assert_eq!(
        created(&result),
        [
            ("r1", Some("create_role")),
            ("db.s.t", Some("create_table")),
            ("p", Some("create_procedure")),
            ("db.s.t", None),
            ("UPPER", None),
            ("src", None),
            ("old", None),
        ]
    );
    for object in &result.objects {
        assert_eq!(&SQL[object.range.clone()], object.name);
    }
}

#[test]
fn a_with_clause_does_not_name_the_statement() {
    let sql = "WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c;
WITH RECURSIVE r AS (SELECT 1), s AS (SELECT 2) SELECT * FROM r;";
    let result = summary(sql).unwrap();
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let kinds: Vec<_> = result.statements.iter().map(|s| s.kind.as_str()).collect();
    assert_eq!(kinds, ["insert_statement", "select"]);
}

#[test]
fn reports_syntax_errors() {
    let result = summary("SELECT (1 FROM t;").unwrap();
    assert!(!result.errors.is_empty(), "{result:?}");
}

#[cfg(feature = "serde")]
#[test]
fn serializes_to_json() {
    let json = serde_json::to_value(summary("CREATE ROLE r1;").unwrap()).unwrap();
    assert_eq!(json["statements"][0]["kind"], "create_role");
    assert_eq!(json["objects"][0]["created_by"], "create_role");
    assert_eq!(json["statements"][0]["range"]["start"], 0);
}
