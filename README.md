# tree-sitter-snowflake

[![Verify](https://github.com/meloncholera/tree-sitter-snowflake/actions/workflows/verify.yml/badge.svg?branch=dev)](https://github.com/meloncholera/tree-sitter-snowflake/actions/workflows/verify.yml)
[![crates.io](https://img.shields.io/crates/v/tree-sitter-snowflake)](https://crates.io/crates/tree-sitter-snowflake)
[![npm](https://img.shields.io/npm/v/tree-sitter-snowflake)](https://www.npmjs.com/package/tree-sitter-snowflake)

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for Snowflake SQL, written from scratch (see `NOTICE`). It covers Snowflake only: no other SQL dialect and no fallback. A file it cannot parse produces `ERROR` nodes for the consumer to measure, never a best-effort tree. See [Syntax coverage](docs/SYNTAX_COVERAGE.md) for the supported statements.

## Installation

```sh
cargo add tree-sitter-snowflake
npm install tree-sitter-snowflake
```

### Requirements

The Rust crate compiles the committed C parser through `cc`, so it needs a C compiler and Rust 1.85 or later. The Node package declares `tree-sitter` ^0.25 as an optional peer dependency.

## Usage

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_snowflake::LANGUAGE.into())?;
let tree = parser.parse("SELECT 1;", None);
```

```js
import Snowflake from 'tree-sitter-snowflake';

const program = Snowflake.nodeTypeInfo.find((node) => node.type === 'program');
console.log(program?.children?.types);
```

`nodeTypeInfo` holds the entries from `src/node-types.json`; an entry's optional `children` property is an object with `multiple`, `required`, and `types` properties, not an array, and leaf entries can omit both `fields` and `children`.

Procedure and function bodies in JavaScript, Python, Java, and Scala are exposed as nodes; the companion [`snowflake-handlers`](snowflake-handlers/README.md) crate extracts and parses them. See [Embedded bodies](docs/EMBEDDED_BODIES.md) and [Consumer integration](docs/CONSUMER_INTEGRATION.md).

## How to contribute

Branch from `dev`. Build with `npm ci --ignore-scripts && npm rebuild tree-sitter-cli && npx --no-install tree-sitter generate && cargo build`, run the checks listed in [CONTRIBUTING.md](CONTRIBUTING.md), and open a pull request against `dev`. For how the pieces fit together, see [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
