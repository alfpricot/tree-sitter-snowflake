# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0](https://github.com/alfpricot/tree-sitter-snowflake/releases/tag/snowflake-handlers-v0.3.0) - 2026-11-26

Built against the tree-sitter-snowflake 0.4 grammar, which changes the SQL tree the analyzer returns and what it reports as a syntax error.

### Changed

- **Breaking:** `Error` is an enum (`Language`, `Query`, `Canceled`) that exposes the underlying error through `source()`, in place of an opaque message.
- **Breaking:** `HandlerStatus::InvalidEncoding` holds an `EncodingError` with the message and the SQL byte range of the offending text, in place of a `String`.
- **Breaking:** `Language`, `RoutineKind`, and `ExecutionRights` are `#[non_exhaustive]`, so a `match` on them needs a wildcard arm.
- The rule identifiers are exported from `snowflake_handlers::rules`.
- `Handler` carries the `HANDLER` and `RUNTIME_VERSION` options as `handler` and `runtime_version`.
- `Handler` lists the `PACKAGES`, `IMPORTS`, and `EXTERNAL_ACCESS_INTEGRATIONS` options as `packages`, `imports`, and `external_access_integrations`.
- **Breaking:** a routine with no inline body, such as a staged handler, is now returned with status `HandlerStatus::Staged` instead of being skipped, so handler counts rise.
- **Breaking:** a handler that cannot be analyzed reports `HandlerStatus::AnalysisFailed` and no longer fails the whole `analyze` call.
- The `summary` feature adds `summary::summary`, which lists a SQL text's statement kinds, structure-query definitions with their decision counts, routines with their languages, decision points, object names (without column qualifiers or common table expression uses), and syntax errors; the `serde` feature makes the result serializable.
- `Analyzer::with_limits` sets an optional maximum body size and parse timeout.
- A decoded body's offset map stores only its escapes and doubled quotes, in place of a range for every byte.
- **Breaking:** requires tree-sitter-snowflake 0.4. `Analysis::sql_tree` is a tree from that grammar, with new node kinds such as `object_constructor` and joins that may carry no condition.
- `ALTER TABLE ... RENAME TO`, `COMMIT WORK`, object constants, `NATURAL` joins, joins without a condition, routine `DROP` signatures, and many multi-word `DROP`, `GRANT`, and `REVOKE` kinds no longer appear in `Analysis::sql_errors`.
- A `NATURAL JOIN` with an `ON` clause, an unquoted table alias spelled `natural`, and some `DROP`, `GRANT`, and `REVOKE` statements that use a kind word as an object name are now reported as syntax errors.
- Literal SQL inside a handler that uses a newly accepted form is now checked, where it was previously skipped as unparsable.

### Fixed

- A `\x` or `\u` escape with a leading `+`, such as `\x+f`, is now reported as `InvalidEncoding` in a single-quoted body, and is no longer decoded inside an embedded string literal.

## [0.2.0](https://github.com/alfpricot/tree-sitter-snowflake/releases/tag/snowflake-handlers-v0.2.0) - 2026-11-05

Built against the tree-sitter-snowflake 0.3 grammar, whose routine, Scripting, and statement rules changed what the analyzer sees.

### Changed

- `ALTER PROCEDURE` and `ALTER FUNCTION` are no longer extracted as routines. They now parse as Snowflake's real ALTER forms, which carry no body, instead of an invented re-definition.
- An empty dollar-quoted body (`AS $$$$`) is a handler with empty source instead of an SQL error.

### Fixed

- `owner-temp-object` fires for `CREATE TEMP`/`TEMPORARY` `PROCEDURE` and `FUNCTION` in literal SQL, which previously failed to parse and was skipped.
- Routines declared with `IF NOT EXISTS`, `SECURE`, `COPY GRANTS`, `RETURNS TABLE (...)`, a `NOT NULL` return, `CREATE OR ALTER`, or `EXECUTE AS RESTRICTED CALLER` are recognized. A restricted caller's routine is treated as caller's rights. A staged handler with no inline body is recognized and skipped.
- Literal `PUT` and `GET` against the user stage (`@~`, `@~/path`) parse, so the PUT/GET checks apply to them.

## [0.1.0](https://github.com/alfpricot/tree-sitter-snowflake/releases/tag/snowflake-handlers-v0.1.0) - 2026-09-12

### Added

- *(bodies)* add shared Snowflake handler analysis ([#2](https://github.com/alfpricot/tree-sitter-snowflake/pull/2))
