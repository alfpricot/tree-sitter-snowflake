# Contributing to tree-sitter-snowflake

A tree-sitter grammar for Snowflake SQL, with Rust and Node bindings and the `snowflake-handlers` companion crate.

## Before you start

1. Branch from **`dev`**; `main` is the production branch, updated by release pull request.
2. Read [ARCHITECTURE.md](ARCHITECTURE.md).

## Local setup

```sh
npm ci --ignore-scripts
npm rebuild tree-sitter-cli
npx --no-install tree-sitter generate
cargo build
```

The CLI version is pinned in `package.json` and resolved by `package-lock.json`; CI uses the same lockfile. When changing it, update its `allowScripts` entry before installing, then regenerate the lockfile; `tools/cli-version.test.mjs` fails CI when that entry, an npm script, or a workflow pins a `tree-sitter-cli` version that lags the devDependency. The generated parser (`src/parser.c`, `src/grammar.json`, `src/node-types.json`) is committed: regenerate and commit its diff after every `grammar.js` change. `.gitattributes` marks `src/parser.c` with `-diff` — a grammar change renumbers the parse states, so its diff is a whole-file rewrite that carries no reviewable information. Review `grammar.js`, `src/grammar.json`, and the corpus tests instead, and resolve a merge conflict in `src/parser.c` by regenerating rather than by hand. A failed `generate` writes nothing, so check `src/parser.c`'s modification time before trusting a test run. On a machine without MSVC, set `CC=gcc CXX=g++`.

## Validation before a pull request

```sh
npx --no-install tree-sitter test
node tools/node-kinds.mjs --check
node tools/fixture-check.mjs
node tools/fixture-leak-grep.mjs
node tools/keyword-probe.mjs
node tools/package-check.mjs
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
cargo test -p snowflake-handlers --all-features
npm run lint
npm run format:check
```

These cover corpus trees, the node-kind snapshot, whole-file fixtures, source-identifier leaks, keyword handling, package contents, and Rust and JavaScript style. CI also builds against tree-sitter 0.26 and runs the Node binding tests (`npm test`), which need MSVC on Windows. `npm run format` applies formatting.

## Pull requests

- Open pull requests against **`dev`**, with a Conventional Commit title (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, ...).
- Keep each pull request to one change and link the issue in the body.
- Add a corpus case or extend a fixture for every newly supported construct.
- Keep node-kind renames for a breaking release: consumers match these names at runtime.

## Documentation

| Document | Covers |
| --- | --- |
| [docs/CONSUMER_INTEGRATION.md](docs/CONSUMER_INTEGRATION.md) | Node mappings, dialect selection, masking, version compatibility |
| [docs/SYNTAX_COVERAGE.md](docs/SYNTAX_COVERAGE.md) | Supported statements and expressions |
| [docs/EMBEDDED_BODIES.md](docs/EMBEDDED_BODIES.md) | Foreign-language handler bodies |
