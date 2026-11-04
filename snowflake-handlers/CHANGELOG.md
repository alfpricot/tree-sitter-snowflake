# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0](https://github.com/alfpricot/tree-sitter-snowflake/releases/tag/snowflake-handlers-v0.2.0) - Unreleased

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
