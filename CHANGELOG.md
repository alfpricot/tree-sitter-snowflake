# Changelog

All notable changes to this project will be documented in this file.

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

## [0.1.1](https://github.com/meloncholic/tree-sitter-snowflake/compare/v0.1.0...v0.1.1) - 2026-09-26

### Fixed

- *(release)* validate release artifacts and repair Node metadata

### Other

- remove .npmrc from the tree ([#16](https://github.com/meloncholic/tree-sitter-snowflake/pull/16))
- scope gitattributes and editorconfig to tracked file types ([#15](https://github.com/meloncholic/tree-sitter-snowflake/pull/15))
- sync .gitattributes and .editorconfig with org template ([#14](https://github.com/meloncholic/tree-sitter-snowflake/pull/14))
- harden release and verification workflows ([#10](https://github.com/meloncholic/tree-sitter-snowflake/pull/10))

## 0.1.0

- Initial public release of the Snowflake SQL grammar.
