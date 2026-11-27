//! Integration tests for the SQL summary.
#![cfg(feature = "summary")]

use snowflake_handlers::{
    Analyzer, Language, RoutineKind,
    summary::{Summary, summary},
};

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

fn references(sql: &str) -> Vec<String> {
    let result = summary(sql).unwrap();
    assert!(result.errors.is_empty(), "{sql}: {:?}", result.errors);
    result
        .objects
        .into_iter()
        .filter(|o| o.created_by.is_none())
        .map(|o| o.name)
        .collect()
}

#[test]
fn column_qualifiers_are_not_references() {
    assert_eq!(
        references("SELECT a.x, b.*, db.s.c.y, c:p.q FROM s.a JOIN b ON a.id = b.id;"),
        ["s.a", "b"]
    );
    assert_eq!(references("SELECT db.s.ids.NEXTVAL;"), ["db.s.ids"]);
}

#[test]
fn common_table_expression_uses_are_not_references() {
    // Later expressions and the main query see an earlier one, in any case.
    assert_eq!(
        references(
            "WITH a AS (SELECT * FROM t), b AS (SELECT * FROM A) SELECT * FROM a JOIN B ON 1;"
        ),
        ["t"]
    );
    // An expression does not see itself or a later one.
    assert_eq!(
        references("WITH a AS (SELECT * FROM a JOIN b), b AS (SELECT 1) SELECT * FROM b;"),
        ["a", "b"]
    );
    // A quoted name keeps its case, and a qualified name is always an object.
    assert_eq!(
        references("WITH \"c\" AS (SELECT 1) SELECT * FROM c JOIN \"c\" JOIN s.c;"),
        ["c", "s.c"]
    );
    // Recursion, with the keyword and without it.
    assert_eq!(
        references("WITH RECURSIVE r AS (SELECT * FROM r) SELECT * FROM r;"),
        Vec::<String>::new()
    );
    assert_eq!(
        references(
            "WITH r AS (SELECT * FROM seed UNION ALL SELECT * FROM r UNION ALL SELECT * FROM r) \
             SELECT * FROM r;"
        ),
        ["seed"]
    );
    // The scope ends with its statement or subquery, and a write target is
    // always an object.
    assert_eq!(
        references(
            "WITH w AS (SELECT 1) INSERT INTO w SELECT * FROM w; SELECT * FROM w;
SELECT * FROM x WHERE EXISTS (WITH z AS (SELECT 1) SELECT * FROM z) AND y IN (SELECT y FROM z);"
        ),
        ["w", "w", "x", "z"]
    );
    assert_eq!(
        references(
            "WITH w AS (SELECT 1) MERGE INTO w USING w AS s ON w.id = s.id \
             WHEN MATCHED THEN DELETE;"
        ),
        ["w"]
    );
    assert_eq!(
        references(
            "WITH r AS (WITH s AS (SELECT 1) SELECT * FROM s UNION ALL SELECT * FROM r) \
             SELECT * FROM r;"
        ),
        Vec::<String>::new()
    );
    assert_eq!(
        references("CREATE VIEW v AS WITH q AS (SELECT 1) SELECT q.* FROM q;"),
        Vec::<String>::new()
    );
}

#[test]
fn lists_routines_and_counts_decisions() {
    let sql = "CREATE PROCEDURE p() RETURNS INT LANGUAGE SQL AS $$
BEGIN
  IF (1 = 1) THEN RETURN 1; END IF;
  FOR i IN 1 TO 3 DO RETURN i; END FOR;
END
$$;
CREATE FUNCTION f() RETURNS INT LANGUAGE PYTHON HANDLER = 'f' AS $$x$$;
CREATE FUNCTION g() RETURNS INT AS '1';";
    let result = summary(sql).unwrap();
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    let routines: Vec<_> = result
        .routines
        .iter()
        .map(|r| (r.name.as_str(), r.kind, r.language))
        .collect();
    assert_eq!(
        routines,
        [
            ("p", RoutineKind::Procedure, None),
            ("f", RoutineKind::Function, Some(Language::Python)),
            ("g", RoutineKind::Function, None),
        ]
    );
    let kinds: Vec<_> = result.decisions.iter().map(|d| d.kind.as_str()).collect();
    assert_eq!(kinds, ["if_statement", "for_statement"]);
    let counts: Vec<_> = result.blocks.iter().map(|b| b.decisions).collect();
    assert_eq!(counts, [2, 0, 0]);
    let analysis = Analyzer::new().unwrap().analyze(sql).unwrap();
    assert_eq!(analysis.handlers[0].routine_range, result.routines[1].range);
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
