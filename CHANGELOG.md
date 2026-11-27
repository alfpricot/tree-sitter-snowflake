# Changelog

All notable changes to this project will be documented in this file.

## 1.0.0 (2026-11-27)

### Breaking Changes

* **grammar:** parse account and replication objects, quantified LIKE, and structured types (#109)
* **grammar:** parse ASOF joins, sampling and null treatment, and inject quoted bodies (#106)
* **handlers:** report handler metadata and keep failures per handler (#104)
* **grammar:** parse secrets and network rules and rename odd node names (#103)
* **bindings:** type-check the JavaScript and make node types assignable (#99)
* **handlers:** give errors and encoding failures typed values (#96)
* **bindings:** add folds and indents queries (#93)
* **grammar:** reject CHECK constraints and a misplaced IF EXISTS (#91)
* **grammar:** parse missing drop, grant, join, and constant forms (#89)

### Migration Notes

Upgrading from 0.3.1:

* A `NATURAL JOIN` with an `ON` clause, and a grant or revoke that names a bare object spelled like a kind word, are now errors (#89).
* `CHECK` constraints and `ALTER IF EXISTS ... POLICY` now produce `ERROR` nodes, and the `keyword_check` node kind is removed (#91).
* In the Node type declarations, `nodeTypeInfo` stays required, and the `fields` and `children` of its entries are no longer optional. `children` is typed as both a single child entry and an array of them (#99).
* `keyword_double` now matches `DOUBLE` and `keyword_double_prec_only` matches `DOUBLE PRECISION`, the reverse of before. `keyword_not_enforced` is gone: `keyword_not` and `keyword_enforced` are direct children of the surrounding node. The `create_stream` field `table` is now named `source` (#103).
* `asof`, `sample`, and `tablesample` are no longer accepted as bare table aliases, and an expression ending in a function call can no longer take the bare alias `ignore` or `respect`. Write `AS` before such an alias, or quote it (#106).
* `CREATE DATABASE ROLE` is `create_database_role`, no longer a database named `role`. `LIKE ANY` is a quantified `binary_expression`, no longer a call of a function named `ANY`. `MAP(...)` is `map_type`, no longer `custom_type` (#109).
* An alias spelled `escape` directly after a `LIKE` pattern now needs `AS`, and the `SHARE`, `SECRET`, and `NOTEBOOK` object kinds hold keyword nodes instead of an identifier (#109).

The `snowflake-handlers` crate keeps its own version; its breaking changes (#96, #104) are listed in [its changelog](snowflake-handlers/CHANGELOG.md).

### Features

* add Go bindings and highlight more single-quoted bodies (#108)
* **handlers:** list handler dependencies and summarize routines (#107)
* add Python bindings and a SQL summary to the handlers crate (#105)

### Bug Fixes

* parse database role grants and match quoted handler names (#110)
* **handlers:** reject a leading plus in numeric escapes (#95)

### Refactoring

* **grammar:** split create statements by object family (#97)
* **tools:** share the batched parse helpers (#94)

## 0.3.1 (2026-11-24)

### Bug Fixes

* **grammar:** accept inline REFERENCES and foreign key properties (#86) (#85)

## 0.3.0 (2026-11-04)

### Features

* **grammar:** parse every stream source and dynamic table columns (#79)
* **grammar:** parse tag, policy, contact, and managed-access clauses (#77)
* **grammar:** parse tag clauses on object ALTERs and common CREATE forms (#74)
* **grammar:** accept qualified tag names and require paired loop keywords (#73)
* **grammar:** parse user stages, table partitions, nested row patterns, and more (#71)
* **grammar:** accept documented Snowflake Scripting forms and empty bodies (#70)
* **grammar:** parse Snowflake's real routine ALTER and CREATE forms (#69)

### Bug Fixes

* **tooling:** key the leak guard needle hashes and drop a downstream name (#76)
* **queries:** highlight every keyword and prepare snowflake-handlers 0.2.0 (#75)
* **queries:** highlight numbers and test what each release ships (#72)

## 0.2.3 (2026-10-29)

### Bug Fixes

* **queries:** inject dollar-quoted bodies without their delimiters (#66)

## [0.2.2](https://github.com/alfpricot/tree-sitter-snowflake/compare/v0.2.1...v0.2.2) - 2026-10-25

### Added

- *(tooling)* add parse summary, tags and locals queries, and companion release config ([#51](https://github.com/alfpricot/tree-sitter-snowflake/pull/51))
- *(grammar)* parse governance policies, alerts, and specialized tables ([#50](https://github.com/alfpricot/tree-sitter-snowflake/pull/50))

### Other

- replace eslint and prettier with oxlint and oxfmt ([#52](https://github.com/alfpricot/tree-sitter-snowflake/pull/52))
- *(deps)* update cc requirement from ~1.5.1 to ~1.9.0 in the cargo-major group across 1 directory ([#45](https://github.com/alfpricot/tree-sitter-snowflake/pull/45))
- *(deps)* bump the github-actions group across 1 directory with 4 updates ([#46](https://github.com/alfpricot/tree-sitter-snowflake/pull/46))
- *(deps-dev)* bump undici from 8.10.2 to 8.12.3 ([#49](https://github.com/alfpricot/tree-sitter-snowflake/pull/49))
- *(deps-dev)* bump the npm-minor-and-patch group with 2 updates ([#47](https://github.com/alfpricot/tree-sitter-snowflake/pull/47))
- *(handlers)* rename snowflake-bodies to snowflake-handlers and refresh docs ([#48](https://github.com/alfpricot/tree-sitter-snowflake/pull/48))

## [0.2.1](https://github.com/alfpricot/tree-sitter-snowflake/compare/v0.2.0...v0.2.1) - 2026-10-04

### Other

- *(release)* align the release workflows with the shared grammar repository standard ([#39](https://github.com/alfpricot/tree-sitter-snowflake/pull/39))

## [0.2.0](https://github.com/alfpricot/tree-sitter-snowflake/compare/v0.1.1...v0.2.0) - 2026-10-04

### Added

- *(grammar)* parse EXPLAIN, UNDROP, and multi-table INSERT ([#35](https://github.com/alfpricot/tree-sitter-snowflake/pull/35))
- *(grammar)* parse Time Travel, CHANGES, and CONNECT BY clauses ([#34](https://github.com/alfpricot/tree-sitter-snowflake/pull/34))

### Fixed

- *(release)* point repository metadata and package scope at alfpricot ([#30](https://github.com/alfpricot/tree-sitter-snowflake/pull/30))
- *(tools)* validate batch exit status and per-file match count in parse-rate ([#26](https://github.com/alfpricot/tree-sitter-snowflake/pull/26))
- *(snowflake-bodies)* make rule IDs a compile-time check and close test gaps
- *(linguist)* mark generated grammar JSON as linguist-generated ([#24](https://github.com/alfpricot/tree-sitter-snowflake/pull/24))
- *(tooling)* hash the leak guard's needle list and fix CI cost and correctness gaps
- *(grammar)* [**breaking**] correct operator precedence, quoted stage paths, and grammar duplication
- *(release)* send a User-Agent header on the crates.io publish check ([#20](https://github.com/alfpricot/tree-sitter-snowflake/pull/20))

### Other

- *(deps)* update eslint and node-gyp ([#36](https://github.com/alfpricot/tree-sitter-snowflake/pull/36))
- *(deps)* bump cargo-bins/cargo-binstall from 1.23.0 to 1.24.0 in the github-actions group ([#33](https://github.com/alfpricot/tree-sitter-snowflake/pull/33))
- align repo configuration with the shared grammar standard ([#32](https://github.com/alfpricot/tree-sitter-snowflake/pull/32))
- sync dev from main ([#19](https://github.com/alfpricot/tree-sitter-snowflake/pull/19))
- *(deps)* bump actions/upload-artifact

## [0.1.1](https://github.com/alfpricot/tree-sitter-snowflake/compare/v0.1.0...v0.1.1) - 2026-09-26

### Fixed

- *(release)* validate release artifacts and repair Node metadata

### Other

- remove .npmrc from the tree ([#16](https://github.com/alfpricot/tree-sitter-snowflake/pull/16))
- scope gitattributes and editorconfig to tracked file types ([#15](https://github.com/alfpricot/tree-sitter-snowflake/pull/15))
- sync .gitattributes and .editorconfig with org template ([#14](https://github.com/alfpricot/tree-sitter-snowflake/pull/14))
- harden release and verification workflows ([#10](https://github.com/alfpricot/tree-sitter-snowflake/pull/10))

## 0.1.0

- Initial public release of the Snowflake SQL grammar.
