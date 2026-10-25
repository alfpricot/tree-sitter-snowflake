# tree-sitter-snowflake architecture

tree-sitter-snowflake is a tree-sitter grammar for Snowflake SQL with Rust and Node bindings, plus a companion crate that extracts the JavaScript, Python, Java, and Scala handlers embedded in procedure and function definitions. The grammar is written in JavaScript, and the generated C parser is committed so consumers never need the tree-sitter CLI.

The main design choice is that the grammar parses Snowflake only and reports what it cannot parse as `ERROR` nodes. Embedded handler code is not parsed by the grammar. It is exposed as nodes so a second parser can take over.

## What tree-sitter-snowflake is not

- Not a multi-dialect SQL grammar and not a validator: it makes no claim that accepted SQL runs.
- Not a dependency that pulls in embedded-language grammars: the grammar package does not link any of them.
- Not an executor: no handler code is run.

## Major components

### [grammar.js](grammar.js) and [grammar/](grammar)
The grammar source: shared rules, expressions, clauses, scripting, types, keywords, and one module per statement family under `grammar/statements/`.

### [src/](src)
The generated parser (`parser.c`, `grammar.json`, `node-types.json`) and the hand-written `scanner.c`, which lexes `$$`-delimited bodies. The scanner must be compiled alongside the parser; vendoring one without the other produces a link error or a parser that cannot lex a dollar-quoted body.

### [queries/](queries)
`highlights.scm`, `injections.scm` (dollar-quoted bodies only, since single-quoted bodies need decoding), and `structure.scm`.

### [bindings/](bindings)
`bindings/rust` exposes `LANGUAGE`, the node-type JSON, and the query strings. `bindings/node` exposes `name`, `language`, and `nodeTypeInfo`.

### [snowflake-handlers/](snowflake-handlers)
A separate crate that decodes handler bodies, maps offsets back to the SQL file, parses JavaScript and Python (Java and Scala behind Cargo features), and runs advisory restriction checks.

### [test/](test) and [tools/](tools)
`test/corpus` holds per-construct tree assertions, `test/fixtures` holds synthetic whole files, and `test/node-kinds.txt` snapshots the exported node kinds. `tools/` holds the checks CI runs over them (fixtures, keyword probe, node kinds, package contents) and the parse-rate harness.

## External systems and data flow

There are none at runtime; this is a library. Input is SQL text, and output is a syntax tree. A consumer that needs handler code passes the same text to `snowflake-handlers`, which returns decoded handler source, embedded trees, and advisory findings mapped to offsets in the SQL file.

## Build, test, release, and deploy

`verify.yml` runs on pull requests and on pushes to `dev` and `main`. It checks the changed paths, secret scanning, workflow and YAML syntax, the pull request title, grammar regeneration (the committed parser must match), the corpus, fixtures, Rust format, lint and tests (also against tree-sitter 0.26, the companion's declared floor), package contents, and the Node binding. A final aggregate job named `Verify` is the required check.

Feature pull requests go to `dev`. A release pull request from release-plz (`release-plz.toml`, git-only, tags `v<version>`) is promoted to `main`; `release-tag.yml` checks the tag, and `release.yml` publishes the crate to crates.io and the npm package to npm and GitHub Packages from the verified commit. `sync-dev-from-main.yml` brings `dev` back in line after a release. Nothing is deployed.

## Where things live

| Path | Holds |
| --- | --- |
| `grammar.js`, `grammar/` | Grammar source |
| `src/` | Generated parser and external scanner |
| `queries/` | Highlight, injection, and structure queries |
| `bindings/` | Rust and Node bindings |
| `snowflake-handlers/` | Embedded handler extraction crate |
| `test/`, `tools/` | Corpus, fixtures, and verification scripts |
| `docs/` | Reference documents |
| `.github/workflows/` | Verify, release, and maintenance workflows |
