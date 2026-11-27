# snowflake-handlers

Extract and parse JavaScript, Python, Java, and Scala handlers embedded in Snowflake SQL. The grammar package remains independent: installing `tree-sitter-snowflake` does not link any embedded-language grammar. This crate is published on [crates.io](https://crates.io/crates/snowflake-handlers); install it with `cargo add snowflake-handlers`.

```rust
use snowflake_handlers::{Analyzer, HandlerStatus};

let mut analyzer = Analyzer::new()?;
let sql = "CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS 'eval(''1'');';";
let analysis = analyzer.analyze(sql)?;
assert!(analysis.sql_errors.is_empty());
let body = &analysis.handlers[0];
assert_eq!(body.status, HandlerStatus::Parsed);
let source = body.source.as_ref().unwrap();
assert_eq!(source.text(), "eval('1');");
for finding in &body.findings {
    println!("{}: {}", finding.rule_id, &sql[finding.range.clone()]);
}
# Ok::<(), snowflake_handlers::Error>(())
```

JavaScript and Python are always available. Enable `java` and/or `scala` Cargo features for the other parsers. With features disabled, extraction and position mapping still work; the body reports `UnavailableLanguage`, with no tree or findings. Queries for all languages ship regardless of features and are exposed by `Language::query()`.

This crate requires Rust 1.90 and supports tree-sitter 0.26 and 0.27. Consumers that exchange trees must resolve the same tree-sitter version; `snowflake_handlers::tree_sitter` re-exports this crate's resolved API. The grammar package retains its separate Rust 1.85 library floor.

## Source and measurement contract

`Analyzer` reuses its compiled parsers and queries across files. `analyze(&str)` returns the SQL tree, SQL syntax-error ranges, extracted foreign-language bodies, and advisory findings. Each body includes its name, routine kind, execution rights, SQL ranges, decoded source, parse status, optional embedded tree, and mapped syntax errors. SQL-language bodies remain in the SQL tree and are not returned a second time. A routine with no inline body, such as one with a staged handler, is returned with status `Staged`, an empty `body_range` at the end of its statement, and no source or tree. A routine with syntax errors and no readable body is skipped. `handler` and `runtime_version` hold the `HANDLER` and `RUNTIME_VERSION` options without their quotes. `packages`, `imports`, and `external_access_integrations` list the items of the `PACKAGES`, `IMPORTS`, and `EXTERNAL_ACCESS_INTEGRATIONS` options: strings without their quotes, names as written. No handler code is executed.

`Error` says why construction or analysis failed: a grammar that would not load, a query that would not compile, or a canceled parse of the SQL text. A failure confined to one handler is its status instead, `AnalysisFailed`, and the other handlers are still analyzed. `Error`, `AnalysisFailure`, `HandlerStatus`, `Language`, `RoutineKind`, and `ExecutionRights` can gain variants, so a `match` on any of them needs a wildcard arm.

`HandlerSource::text()` excludes delimiters. Dollar bodies preserve every byte. Single-quoted bodies decode doubled quotes and Snowflake backslash escapes, including `\0`, three-digit ASCII octal, two-digit ASCII hexadecimal, and four-digit Unicode escapes. Numeric escapes can cross the SQL grammar's child-node boundaries, so the decoder consumes the complete content of the validated body node. Malformed numeric escapes, non-ASCII byte escapes, and non-scalar Unicode values produce `InvalidEncoding` rather than guessed text, with the message and the SQL byte range of the offending text. Unknown nonnumeric escapes discard the backslash. Details are based on [Snowflake's string specification](https://docs.snowflake.com/en/sql-reference/data-types-text).

Embedded tree offsets refer to decoded UTF-8 text. Map them with `source_offset` or `source_range`; ranges are half-open and expand to include each original escape in full. EOF maps immediately before the closing SQL delimiter.

`included_ranges(sql)` gives the ranges of the SQL text that spell the decoded body, which an embedded parser accepts through `set_included_ranges`; its tree then has SQL offsets, so an editor can highlight a single-quoted body that doubles its apostrophes. It returns `None` for an empty body and for one with an escape such as `\n` or `\u0041`, whose text the SQL does not contain; parse `text()` and map the results for those. Invalid offsets/ranges return `None`. `source_point` returns zero-based rows and UTF-8 byte columns, including CRLF and Unicode. Call it on the original SQL text. Input must already be decoded to UTF-8: these offsets do not refer to the original encoded bytes of a UTF-16 file.

`Parsed` bodies parsed cleanly and were checked. `AnalysisFailed` keeps what was built before the failure: nothing for `BodyTooLarge`, the source alone when the body's own parse timed out, and the source with a cleanly parsed tree when a check failed. `InvalidBody` retains the partial tree and mapped errors but skips restriction checking. `Staged`, `InvalidSql`, and `InvalidEncoding` have no reconstructed source; `UnavailableLanguage` has source but no tree. Inspect `sql_errors` too: a malformed SQL header may prevent a routine from being recognized. An empty body in either form (`$$$$` or `''`) is a handler with empty source. None of these states means zero measured complexity. Consumers apply the appropriate language profile and attribute the result to the enclosing SQL file exactly once. Vocabulary consumers mask the decoded source with its language's own masking mode, then map findings back.

## Limits

`Analyzer::with_limits` bounds the work spent on untrusted or very large input. Both limits are off by default.

```rust
use snowflake_handlers::{Analyzer, Limits};
use std::time::Duration;

let limits = Limits::default()
    .with_max_body_bytes(1024 * 1024)
    .with_parse_timeout(Duration::from_secs(5));
let analyzer = Analyzer::new()?.with_limits(limits);
# let _ = analyzer;
# Ok::<(), snowflake_handlers::Error>(())
```

`max_body_bytes` counts the SQL bytes between a body's delimiters; a longer body is not decoded and reports `AnalysisFailed(BodyTooLarge)`. It does not bound the SQL text itself, which is parsed before any body is measured. `parse_timeout` applies to each parse separately: a body, or SQL text inside it, that runs longer reports `AnalysisFailed(TimedOut)`, while a SQL text that runs longer fails the call with `Error::Canceled`. The parser checks the clock periodically, so a parse can run somewhat past the timeout. A restriction query that overflows the match limit reports `AnalysisFailed(MatchLimitExceeded)`. A failed handler has no findings, which does not mean it has none to find.

## SQL summary

With the `summary` feature, `snowflake_handlers::summary::summary(sql)` returns what a SQL text contains: the kind and range of each top-level statement, the definitions the grammar's structure query captures (procedures, functions, policies, and alerts), every procedure and function with its language, the Snowflake Scripting decision points with a count for each definition, every name the SQL creates or refers to, and the syntax error ranges. A created name carries the kind of its `CREATE` node; references include the names of called functions, and leave out column qualifiers and the uses of a `WITH` clause's common table expressions. A routine's range matches its handler's `routine_range` from `Analyzer`. Foreign-language handler bodies are not read, and SQL inside a single-quoted body is not parsed. The `serde` feature, which turns `summary` on, derives `Serialize` for these types.

## Restriction catalog

These are bounded syntax checks, not an execution validator. `RULES` provides stable IDs, messages, and severities, and `rules` names each ID as a constant. Warnings identify documented restrictions through literal syntax; advisories identify proxies. All name-based matches require review because there is no symbol resolution, alias tracking, type inference, interprocedural analysis, or constant propagation. For example, a locally defined `eval` or `session.sql` can match, while an aliased API can escape detection. A result with no findings is not a guarantee of runtime validity.

| Rules | Checked forms |
|---|---|
| `js-eval`, `js-import` | Direct `eval`/`require` calls, static and dynamic imports |
| `js-host-api` | Direct calls/construction of selected browser/network APIs; advisory |
| `python-process` | Literal `subprocess`, `multiprocessing`, and `os` process-creation calls |
| `concurrency` | Selected thread/executor/future constructors, Java parallel streams, Scala `.par`; advisory |
| `session-builder`, `jdbc-connection` | Java/Scala `Session.builder` and JDBC access; builder use is advisory |
| `python-put-get` | PUT/GET statements in a literal passed directly to `.sql(...)` |
| `python-get-pattern` | Glob metacharacters in a literal first argument to `.file.get(...)` |
| `local-write-path` | Java/Scala literal GET destinations and direct file-download destinations outside `/tmp` |
| `owner-temp-object` | Temporary-object DDL in literal `.sql(...)` under explicit/default owner rights |
| `scala-task-warehouse` | A task without a warehouse calling a uniquely named, equally qualified Scala procedure in the same file; advisory |

The embedded `.scm` files select syntax and name predicates. Literal SQL is parsed with the Snowflake grammar for transfer and temporary-object checks; it is not searched as text. Those findings cover the containing string literal in the original SQL file. Unsupported embedded string escapes, interpolation, concatenation, variable SQL, malformed literal SQL, external files, and indirect calls are not followed. Path checks normalize `.` and `..` but cannot resolve symbolic links. PUT reads a local source; its source path is not treated as a local write. Task checks do not resolve session database/schema context or external declarations.

Snowpark restrictions apply to procedures, not UDFs; the JavaScript rules run on both. The temporary-object rule is scoped to Python/Java/Scala procedures, where the referenced documentation states it, rather than applying it to SQL scripting indiscriminately. Runtime resource limits, memory exhaustion, general network/disk behavior, arbitrary concurrency, and server configuration cannot be established by these checks. See the official [JavaScript](https://docs.snowflake.com/en/developer-guide/stored-procedure/stored-procedures-javascript), [Python](https://docs.snowflake.com/en/developer-guide/stored-procedure/python/procedure-python-limitations), [Java](https://docs.snowflake.com/en/developer-guide/stored-procedure/java/procedure-java-limitations), and [Scala](https://docs.snowflake.com/en/developer-guide/stored-procedure/scala/procedure-scala-limitations) references (checked 2026-09-11).

## Verification

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo test -p snowflake-handlers --all-features
cargo run -p snowflake-handlers --example summary -- /path/to/local/sql
```

The example prints counts only. Add `--routines` before the path to also list each foreign-language routine with its entry point, which prints names from your files.

CI also builds and tests both workspace members with tree-sitter pinned to 0.26. Synthetic tests cover decoding and location mapping, parse failures, disabled features, positive and negative rule cases, caller/owner rights, functions, and task context.

The grammar crate must be published before this companion can resolve its registry dependency, so the release workflow publishes the grammar first and then this crate when its version is new.
