//! Integration tests for extraction, offset mapping, and the restriction checks.

use snowflake_handlers::{
    AnalysisFailure, Analyzer, Error, ExecutionRights, HandlerStatus, Language, Limits, Severity,
    source_point,
};
use std::time::Duration;

fn sql(language: &str, content: &str) -> String {
    format!("CREATE PROCEDURE p() RETURNS STRING LANGUAGE {language} AS $${content}$$;")
}

fn ids(analysis: &snowflake_handlers::Analysis) -> Vec<&str> {
    analysis
        .handlers
        .iter()
        .flat_map(|b| b.findings.iter().map(|f| f.rule_id))
        .collect()
}

#[test]
fn decodes_quotes_escapes_unicode_and_maps_ranges() {
    let sql = "-- é\r\nCREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS 'let x = ''é'';\\n\\u0065val(''a'');';";
    let result = Analyzer::new().unwrap().analyze(sql).unwrap();
    assert!(result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    let body = &result.handlers[0];
    assert_eq!(body.status, HandlerStatus::Parsed);
    let source = body.source.as_ref().unwrap();
    assert_eq!(source.text(), "let x = 'é';\neval('a');");
    let f = &body.findings[0];
    assert_eq!(f.rule_id, "js-eval");
    assert_eq!(&sql[f.range.clone()], "\\u0065val(''a'')");
    assert_eq!(source_point(sql, f.range.start).unwrap().row, 1);
    let quote = source.text().find('\'').unwrap();
    assert_eq!(&sql[source.source_range(quote..quote + 1).unwrap()], "''");
    let eof = sql.rfind("';").unwrap();
    assert_eq!(source.source_offset(source.text().len()), Some(eof));
    assert_eq!(
        source.source_range(source.text().len()..source.text().len()),
        Some(eof..eof)
    );
    assert_eq!(source.source_offset(source.text().len() + 1), None);
    assert_eq!(source.source_range(5..usize::MAX), None);
}

#[test]
fn numeric_and_unknown_escapes_and_empty_bodies() {
    let input = r#"CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS 'return "\041\x21\u26c4\z\0";';"#;
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    let source = result.handlers[0].source.as_ref().unwrap();
    assert_eq!(source.text(), "return \"!!⛄z\0\";");
    let snowman = source.text().find('⛄').unwrap();
    for offset in snowman..snowman + 3 {
        assert_eq!(source.source_offset(offset), input.find(r"\u26c4"));
    }
    assert_eq!(
        &input[source.source_range(snowman..snowman + 3).unwrap()],
        r"\u26c4"
    );
    for quoted in ["''", "$$ $$"] {
        let input = format!("CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS {quoted};");
        let analysis = Analyzer::new().unwrap().analyze(&input).unwrap();
        assert!(
            analysis.sql_errors.is_empty(),
            "{}",
            analysis.sql_tree.root_node().to_sexp()
        );
        assert_eq!(
            analysis.handlers[0].source.as_ref().unwrap().text().trim(),
            ""
        );
        assert_eq!(analysis.handlers[0].status, HandlerStatus::Parsed);
    }

    // A three-digit octal escape and a two-digit hex escape both decode to
    // 'A' (0o101 == 0x41 == 65), each mapping back to its own source range.
    let input = r"CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS '\101\x41';";
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    let source = result.handlers[0].source.as_ref().unwrap();
    assert_eq!(source.text(), "AA");
    assert_eq!(&input[source.source_range(0..1).unwrap()], r"\101");
    assert_eq!(&input[source.source_range(1..2).unwrap()], r"\x41");

    // A completely empty dollar body, with nothing between the delimiters,
    // is a handler with empty source.
    let input = "CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS $$$$;";
    let analysis = Analyzer::new().unwrap().analyze(input).unwrap();
    assert!(analysis.sql_errors.is_empty(), "{:?}", analysis.sql_errors);
    assert_eq!(analysis.handlers[0].source.as_ref().unwrap().text(), "");
}

#[test]
fn preserves_dollar_body_and_reports_javascript_rules() {
    let text = "// eval('ignored')\nconst s = 'require(1)';\neval('1'); require('x'); import('x'); fetch('x');";
    let input = sql("JAVASCRIPT", text);
    let result = Analyzer::new().unwrap().analyze(&input).unwrap();
    assert_eq!(result.handlers[0].source.as_ref().unwrap().text(), text);
    assert_eq!(
        ids(&result),
        ["js-eval", "js-import", "js-import", "js-host-api"]
    );
    let result = Analyzer::new()
        .unwrap()
        .analyze(&sql("JAVASCRIPT", "import x from 'x';"))
        .unwrap();
    assert_eq!(ids(&result), ["js-import"]);
}

#[test]
fn distinguishes_syntax_failure_unavailable_and_invalid_encoding() {
    let mut analyzer = Analyzer::new().unwrap();
    let result = analyzer.analyze(&sql("JAVASCRIPT", "let = ;")).unwrap();
    assert_eq!(result.handlers[0].status, HandlerStatus::InvalidBody);
    assert!(
        !result.handlers[0].parse_errors.is_empty(),
        "{:?}",
        result.handlers[0].parse_errors
    );
    assert!(
        result.handlers[0].findings.is_empty(),
        "{:?}",
        result.handlers[0].findings
    );
    for (name, language) in [("JAVA", Language::Java), ("SCALA", Language::Scala)] {
        let result = analyzer.analyze(&sql(name, "class Handler {} ")).unwrap();
        if language.grammar().is_none() {
            assert_eq!(
                result.handlers[0].status,
                HandlerStatus::UnavailableLanguage
            );
            assert!(result.handlers[0].tree.is_none());
            assert!(result.handlers[0].source.is_some());
        } else {
            assert_eq!(result.handlers[0].status, HandlerStatus::Parsed);
        }
    }
    let result = analyzer
        .analyze(r"CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS '\uD800';")
        .unwrap();
    assert!(matches!(
        result.handlers[0].status,
        HandlerStatus::InvalidEncoding(_)
    ));
    assert!(result.handlers[0].source.is_none());
    let result = analyzer
        .analyze("CREATE PROCEDURE p( RETURNS STRING LANGUAGE JAVASCRIPT AS 'eval(1)';")
        .unwrap();
    assert!(!result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    assert!(
        result
            .handlers
            .iter()
            .all(|b| b.status != HandlerStatus::Parsed)
    );
}

#[test]
fn python_restrictions_are_scoped_to_procedures_and_literal_calls() {
    let content = "import subprocess\nimport threading\nsubprocess.run(['x'])\nthreading.Thread(target=run)\nsession.sql('PUT file:///x @s')\nsession.file.get('@s/*.csv', '/tmp')\nsession.sql('CREATE TEMPORARY TABLE t (x INT)')\n";
    let mut analyzer = Analyzer::new().unwrap();
    let result = analyzer.analyze(&sql("PYTHON", content)).unwrap();
    assert_eq!(result.handlers[0].status, HandlerStatus::Parsed);
    assert_eq!(
        ids(&result),
        [
            "python-process",
            "concurrency",
            "python-put-get",
            "python-get-pattern",
            "owner-temp-object"
        ]
    );
    assert_eq!(result.handlers[0].rights, ExecutionRights::Owner);
    assert_eq!(result.handlers[0].findings[1].severity, Severity::Advisory);
    let caller = sql("PYTHON", content).replace(" AS $$", " EXECUTE AS CALLER AS $$");
    let result = analyzer.analyze(&caller).unwrap();
    assert_eq!(result.handlers[0].rights, ExecutionRights::Caller);
    assert!(!ids(&result).contains(&"owner-temp-object"));
    let udf = sql("PYTHON", content).replace("PROCEDURE", "FUNCTION");
    let found = analyzer.analyze(&udf).unwrap();
    assert!(ids(&found).is_empty(), "{:?}", ids(&found));
    let safe = "# subprocess.run()\ns = 'PUT file:///x @s'\nsession.sql(f'GET {stage} file:///x')\nsession.sql(query)\nsession.file.get('@s/exact.csv', '/tmp')\nsession.sql('CREATE TABLE t (x INT)')\n";
    let found = analyzer.analyze(&sql("PYTHON", safe)).unwrap();
    assert!(ids(&found).is_empty(), "{:?}", ids(&found));
}

#[test]
fn does_not_extract_sql_bodies_or_body_like_text_in_comments() {
    let input = "-- CREATE PROCEDURE fake() RETURNS STRING LANGUAGE JAVASCRIPT AS 'eval(1)';\nCREATE PROCEDURE p() RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN 1; END $$;";
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    assert!(result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    assert!(result.handlers.is_empty(), "{:?}", result.handlers);
}

#[test]
fn all_escape_boundaries_and_invalid_encodings_are_explicit() {
    let mut analyzer = Analyzer::new().unwrap();
    for escaped in [
        r"\x", r"\xGG", r"\xFF", r"\u12", r"\uZZZZ", r"\uDFFF", r"\777", r"\12",
    ] {
        let input =
            format!("CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS '{escaped}';");
        let result = analyzer.analyze(&input).unwrap();
        assert!(
            matches!(result.handlers[0].status, HandlerStatus::InvalidEncoding(_)),
            "{escaped}"
        );
    }
    let content = r#"return "\b\f\n\r\t\0\\\"\'";"#;
    let input = format!("CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS '{content}';");
    let result = analyzer.analyze(&input).unwrap();
    let source = result.handlers[0].source.as_ref().unwrap();
    assert_eq!(source.text(), "return \"\u{8}\u{c}\n\r\t\0\\\"'\";");
    let offsets: Vec<_> = (0..=source.text().len())
        .map(|i| source.source_offset(i).unwrap())
        .collect();
    assert!(offsets.windows(2).all(|w| w[0] <= w[1]));
    assert_eq!(
        source_point("é\r\n雪", 7).unwrap(),
        snowflake_handlers::tree_sitter::Point::new(1, 3)
    );
    assert_eq!(source_point("x", 2), None);
    let invalid_range = std::ops::Range { start: 5, end: 2 };
    assert_eq!(source.source_range(invalid_range), None);
}

#[test]
fn multiple_routines_and_feature_independent_task_context() {
    let mut analyzer = Analyzer::new().unwrap();
    let input = format!(
        "{} {} CREATE TASK t AS CALL p();",
        sql("SCALA", "object Handler {}"),
        sql("JAVASCRIPT", "return 1;").replace("p()", "other()")
    );
    let result = analyzer.analyze(&input).unwrap();
    assert_eq!(result.handlers.len(), 2);
    assert_eq!(result.findings.len(), 1);
    let overloaded = format!(
        "{input} CREATE PROCEDURE p(x INT) RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN x; END $$;"
    );
    let found = analyzer.analyze(&overloaded).unwrap().findings;
    assert!(found.is_empty(), "{found:?}");
    let warehouse = input.replace("TASK t AS", "TASK t WAREHOUSE=w AS");
    let found = analyzer.analyze(&warehouse).unwrap().findings;
    assert!(found.is_empty(), "{found:?}");
    let input = sql("PYTHON", "session.sql('CREATE TEMP TABLE t (x INT)')")
        .replace(" AS $$", " EXECUTE AS OWNER AS $$");
    assert_eq!(
        ids(&analyzer.analyze(&input).unwrap()),
        ["owner-temp-object"]
    );
}

#[cfg(feature = "java")]
#[test]
fn java_queries_and_literal_destination_checks() {
    let content = r#"class Handler { String run() {
        new Thread(); Session.builder(); session.jdbcConnection();
        session.sql("GET @s file:///outside");
        session.sql("GET @s file:///tmp/../outside");
        session.sql("GET @s file:///tmp/safe");
        session.sql("PUT file:///outside @s");
        session.file().get("@s", "/outside");
        session.sql("CREATE TEMP TABLE t (x INT)");
        return "ok";
    }}"#;
    let result = Analyzer::new()
        .unwrap()
        .analyze(&sql("JAVA", content))
        .unwrap();
    assert_eq!(result.handlers[0].status, HandlerStatus::Parsed);
    assert_eq!(
        ids(&result),
        [
            "concurrency",
            "session-builder",
            "jdbc-connection",
            "local-write-path",
            "local-write-path",
            "local-write-path",
            "owner-temp-object"
        ]
    );
}

#[cfg(feature = "scala")]
#[test]
fn scala_queries_and_tasks() {
    let content = r#"object Handler { def run(): String = {
        new Thread(); Session.builder(); session.jdbcConnection
        val x = List(1).par
        session.sql("GET @s file:///outside")
        session.file.get("@s", "/outside")
        "ok"
    }}"#;
    let input = format!(
        "{} CREATE TASK t AS CALL p(); CREATE TASK t2 WAREHOUSE=w AS CALL p(); CREATE TASK t3 AS CALL \"P\"();",
        sql("SCALA", content)
    );
    let result = Analyzer::new().unwrap().analyze(&input).unwrap();
    assert!(result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    assert_eq!(result.handlers[0].status, HandlerStatus::Parsed);
    assert_eq!(
        ids(&result),
        [
            "concurrency",
            "session-builder",
            "jdbc-connection",
            "concurrency",
            "local-write-path",
            "local-write-path"
        ]
    );
    let calls: Vec<_> = result
        .findings
        .iter()
        .map(|f| (f.rule_id, &input[f.range.clone()]))
        .collect();
    assert_eq!(
        calls,
        [
            ("scala-task-warehouse", "CALL p()"),
            ("scala-task-warehouse", "CALL \"P\"()")
        ]
    );
}

#[test]
fn owner_rights_flag_temporary_routines() {
    let mut analyzer = Analyzer::new().unwrap();
    for statement in [
        "CREATE TEMPORARY FUNCTION f(x INT) RETURNS INT AS 'x + 1'",
        "CREATE OR REPLACE TEMP SECURE PROCEDURE p() RETURNS INT LANGUAGE SQL AS 'BEGIN RETURN 1; END'",
    ] {
        let content = format!("session.sql(\"{statement}\")");
        let result = analyzer.analyze(&sql("PYTHON", &content)).unwrap();
        assert_eq!(ids(&result), ["owner-temp-object"], "{statement}");
    }
}

#[test]
fn reports_the_entry_point_and_runtime_version() {
    let input = "CREATE FUNCTION f() RETURNS STRING LANGUAGE PYTHON RUNTIME_VERSION = '3.11' handler = 'mod.it''s' AS $$x = 1$$;
CREATE FUNCTION g() RETURNS STRING LANGUAGE PYTHON RUNTIME_VERSION = 3.12 AS 'x = 1';
CREATE FUNCTION h() RETURNS STRING LANGUAGE JAVASCRIPT AS 'return 1;';";
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    assert!(result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    let metadata: Vec<_> = result
        .handlers
        .iter()
        .map(|h| (h.handler.as_deref(), h.runtime_version.as_deref()))
        .collect();
    assert_eq!(
        metadata,
        [
            (Some("mod.it's"), Some("3.11")),
            (None, Some("3.12")),
            (None, None),
        ]
    );
}

#[test]
fn records_a_staged_handler() {
    let input = "CREATE PROCEDURE p() RETURNS STRING LANGUAGE PYTHON RUNTIME_VERSION = '3.11' IMPORTS = ('@s/m.py') HANDLER = 'm.run' EXECUTE AS CALLER;";
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    assert!(result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    let staged = &result.handlers[0];
    assert_eq!(staged.status, HandlerStatus::Staged);
    assert_eq!(staged.handler.as_deref(), Some("m.run"));
    assert_eq!(staged.rights, ExecutionRights::Caller);
    assert_eq!(&input[staged.body_range.clone()], "");
    assert_eq!(staged.body_range.start, staged.routine_range.end);
    assert!(
        staged.source.is_none() && staged.tree.is_none(),
        "{staged:?}"
    );
}

#[test]
fn an_oversized_body_fails_alone() {
    let input = format!(
        "{}\n{}",
        sql("JAVASCRIPT", "eval('a long body');"),
        sql("JAVASCRIPT", "eval(1);")
    );
    let mut analyzer = Analyzer::new()
        .unwrap()
        .with_limits(Limits::default().with_max_body_bytes(8));
    let result = analyzer.analyze(&input).unwrap();
    assert_eq!(
        result.handlers[0].status,
        HandlerStatus::AnalysisFailed(AnalysisFailure::BodyTooLarge)
    );
    assert!(
        result.handlers[0].source.is_none(),
        "{:?}",
        result.handlers[0]
    );
    assert_eq!(result.handlers[1].status, HandlerStatus::Parsed);
    assert_eq!(ids(&result), ["js-eval"]);
}

#[test]
fn a_timed_out_body_fails_alone_and_leaves_the_parser_usable() {
    // The parser consults the clock only every so many steps, so with no time at
    // all a short parse still completes and a long one is canceled.
    let long = "let a = [1, 2, 3];\n".repeat(2_000);
    let input = format!(
        "{}\n{}",
        sql("JAVASCRIPT", &long),
        sql("JAVASCRIPT", "eval(1);")
    );
    let mut analyzer = Analyzer::new()
        .unwrap()
        .with_limits(Limits::default().with_parse_timeout(Duration::ZERO));
    for _ in 0..2 {
        let result = analyzer.analyze(&input).unwrap();
        assert_eq!(
            result.handlers[0].status,
            HandlerStatus::AnalysisFailed(AnalysisFailure::TimedOut)
        );
        assert!(
            result.handlers[0].tree.is_none(),
            "{:?}",
            result.handlers[0]
        );
        assert_eq!(result.handlers[1].status, HandlerStatus::Parsed);
        assert_eq!(ids(&result), ["js-eval"]);
    }
    let statements = "SELECT 1;\n".repeat(2_000);
    assert!(matches!(
        analyzer.analyze(&statements),
        Err(Error::Canceled)
    ));
}

#[test]
fn a_body_lost_to_a_syntax_error_is_not_staged() {
    let header = "CREATE FUNCTION f() RETURNS INT LANGUAGE PYTHON HANDLER = 'h'";
    let mut analyzer = Analyzer::new().unwrap();
    for broken in [" AS ;", " AS ; SELECT 1;", " /* note */ AS ;"] {
        let result = analyzer.analyze(&format!("{header}{broken}")).unwrap();
        assert!(!result.sql_errors.is_empty(), "{broken}");
        assert!(
            result.handlers.is_empty(),
            "{broken}: {:?}",
            result.handlers
        );
    }
    // An error in a later statement says nothing about this one.
    for staged in ["", ";", " -- note\n;", "; SELECT FROM WHERE;"] {
        let result = analyzer.analyze(&format!("{header}{staged}")).unwrap();
        assert_eq!(result.handlers.len(), 1, "{staged}");
        assert_eq!(result.handlers[0].status, HandlerStatus::Staged, "{staged}");
    }
}

#[test]
fn lists_handler_dependencies() {
    let sql = "CREATE FUNCTION f() RETURNS INT LANGUAGE PYTHON
PACKAGES = ('old')
PACKAGES = ('numpy', 'pandas==2.0')
IMPORTS = ('@stage/it''s.py')
EXTERNAL_ACCESS_INTEGRATIONS = (web, \"Mail Gate\")
HANDLER = 'f' AS $$x = 1$$;
CREATE FUNCTION g() RETURNS INT LANGUAGE PYTHON PACKAGES = ('one') IMPORTS = () HANDLER = 'g';";
    let result = Analyzer::new().unwrap().analyze(sql).unwrap();
    assert!(result.sql_errors.is_empty(), "{:?}", result.sql_errors);
    let [f, g] = &result.handlers[..] else {
        panic!("{:?}", result.handlers);
    };
    assert_eq!(f.packages, ["numpy", "pandas==2.0"]);
    assert_eq!(f.imports, ["@stage/it's.py"]);
    assert_eq!(f.external_access_integrations, ["web", "\"Mail Gate\""]);
    assert_eq!(g.packages, ["one"]);
    assert!(g.imports.is_empty(), "{:?}", g.imports);
    assert!(
        g.external_access_integrations.is_empty(),
        "{:?}",
        g.external_access_integrations
    );
}
