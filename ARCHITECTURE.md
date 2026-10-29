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
`highlights.scm`, `injections.scm` (dollar-quoted bodies only, since single-quoted bodies need decoding), `locals.scm`, `structure.scm`, and `tags.scm`.

### [bindings/](bindings)
`bindings/rust` exposes `LANGUAGE`, the node-type JSON (`NODE_TYPES`), and one constant per query file (`HIGHLIGHTS_QUERY`, `INJECTIONS_QUERY`, `LOCALS_QUERY`, `STRUCTURE_QUERY`, `TAGS_QUERY`). `bindings/node` loads the native addon and adds `nodeTypeInfo` and the same query strings.

### [snowflake-handlers/](snowflake-handlers)
A separate crate that decodes handler bodies, maps offsets back to the SQL file, parses JavaScript and Python (Java and Scala behind Cargo features), and runs advisory restriction checks.

### [test/](test) and [tools/](tools)
`test/corpus` holds per-construct tree assertions, `test/fixtures` holds synthetic whole files, and `test/node-kinds.txt` snapshots the exported node kinds. `tools/` holds the checks CI runs over them (fixtures, keyword probe, node kinds, package contents) and the parse-rate harness.

## External systems and data flow

There are none at runtime; this is a library. Input is SQL text, and output is a syntax tree. A consumer that needs handler code passes the same text to `snowflake-handlers`, which returns decoded handler source, embedded trees, and advisory findings mapped to offsets in the SQL file.

## Build, test, release, and deploy

`verify.yml` runs on pull requests, on pushes to `dev` and `main`, and on manual dispatch. It checks the changed paths, secret scanning, workflow and YAML syntax, the pull request title, the unit tests for the repository's own scripts, grammar regeneration (the committed parser and node-kind snapshot must match), lint and formatting for the JavaScript, the corpus, fixtures, keyword handling, Rust format, lint and tests (also against tree-sitter 0.26, the companion's declared floor), package contents, and the Node binding. A final aggregate job named `Verify` is the required check.

Feature pull requests go to `dev`. A promotion pull request from `dev` to `main` cuts the release: `gala-release.yml` runs gala (`.gala.toml`), which computes the next version from Conventional Commits, bumps it in `Cargo.toml`, `package.json`, `tree-sitter.json`, and `snowflake-handlers`' dependency on the grammar crate, refreshes `package-lock.json`, regenerates the parser (whose metadata embeds the `tree-sitter.json` version), writes `CHANGELOG.md`, commits, tags `v<version>`, pushes with a deploy key, and fast-forwards `dev` to the release commit. The workflow then dispatches `release.yml`, which publishes the crate to crates.io and the npm package to npm and GitHub Packages from the verified commit, builds prebuilt native addons for Linux and Windows, and attaches a WASM build to the GitHub Release. `cache-cleanup.yml` deletes stale Actions caches on a daily schedule. Nothing is deployed.

## Where things live

| Path | Holds |
| --- | --- |
| `grammar.js`, `grammar/` | Grammar source |
| `src/` | Generated parser and external scanner |
| `queries/` | Highlight, injection, locals, structure, and tags queries |
| `bindings/` | Rust and Node bindings |
| `snowflake-handlers/` | Embedded handler extraction crate |
| `test/`, `tools/` | Corpus, fixtures, and verification scripts |
| `docs/` | Reference documents |
| `.github/workflows/` | Verify, release, and maintenance workflows |
| `.gala.toml` | Release configuration (gala) |
