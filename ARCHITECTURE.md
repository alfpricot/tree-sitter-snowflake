# tree-sitter-snowflake architecture

tree-sitter-snowflake is a tree-sitter grammar for Snowflake SQL with Rust and Node bindings, plus a companion crate that extracts the JavaScript, Python, Java, and Scala handlers embedded in procedure and function definitions. The grammar is written in JavaScript, and the generated C parser is committed so consumers never need the tree-sitter CLI.

The main design choice is that the grammar parses Snowflake only and reports what it cannot parse as `ERROR` or `MISSING` nodes. It is not a validator, so a clean tree makes no claim that the SQL runs.

Embedded handler code is exposed as nodes so a second parser can take over. The grammar package links no embedded-language grammar, and nothing here runs handler code.

## Major components

### [grammar.js](grammar.js) and [grammar/](grammar)
The grammar source: shared rules, expressions, column lists, scripting, types, keywords, and one module per statement family under `grammar/statements/`.

### [src/](src)
The generated parser (`parser.c`, `grammar.json`, `node-types.json`) and the hand-written `scanner.c`, which lexes `$$`-delimited bodies. The scanner must be compiled alongside the parser; vendoring one without the other produces a link error or a parser that cannot lex a dollar-quoted body.

### [queries/](queries)
`highlights.scm`, `injections.scm` (dollar-quoted bodies only, since single-quoted bodies need decoding), `locals.scm`, `structure.scm`, `tags.scm`, `folds.scm`, and `indents.scm` (nvim-treesitter capture names). `tree-sitter.json` has no key for the last two, so consumers load them directly or through the bindings.

### [bindings/](bindings)
`bindings/rust` exposes `LANGUAGE`, the node-type JSON (`NODE_TYPES`), and one constant per query file (`HIGHLIGHTS_QUERY`, `INJECTIONS_QUERY`, `LOCALS_QUERY`, `STRUCTURE_QUERY`, `TAGS_QUERY`, `FOLDS_QUERY`, `INDENTS_QUERY`). `bindings/node` loads the native addon and adds `nodeTypeInfo` and the same query strings.

### [snowflake-handlers/](snowflake-handlers)
A separate crate that decodes handler bodies, maps offsets back to the SQL file, parses JavaScript and Python (Java and Scala behind Cargo features), and runs advisory restriction checks.

### [test/](test) and [tools/](tools)
`test/corpus` holds per-construct tree assertions, `test/highlight` holds highlight assertions, `test/fixtures` holds synthetic whole files, and `test/node-kinds.txt` snapshots the exported node kinds and their fields. `tools/` holds the CI and release policy scripts, the checks CI runs (fixtures, source-identifier leaks, keyword probe, node kinds, package contents), and the parse summary and parse-rate tools.

## External systems and data flow

There are none at runtime; this is a library. Input is SQL text, and output is a syntax tree. A consumer that needs handler code passes the same text to `snowflake-handlers`, which returns decoded handler source, embedded trees, and advisory findings mapped to offsets in the SQL file.

## Build, test, release, and deploy

### Verify

`verify.yml` runs on pull requests, on pushes to `dev` and `main`, and on manual dispatch. It checks:

- the changed paths, the pull request title, and workflow and YAML syntax
- the working tree and Git history for secrets, and tracked files for source-corpus identifiers
- the unit tests for the repository's own scripts, and version agreement across the three manifests
- grammar regeneration (the committed parser and node-kind snapshot must match)
- JavaScript lint and formatting, corpus and highlight tests, fixtures, and keyword handling
- the scanner compiled with warnings as errors, and a fuzz run when the scanner or `verify.yml` changes
- Rust format, lint, and tests
- each crate's minimum Rust version and a run against tree-sitter 0.26, the companion's declared floor, when a path a crate builds from changes
- package contents and the Node binding

A pull request that changes only docs, `NOTICE`, `CODEOWNERS`, or the Dependabot config skips the build jobs, and a draft fails the final check. That aggregate job, named `Verify`, is the required check on `dev` and `main`.

### Release

Feature pull requests go to `dev`. A promotion pull request from `dev` to `main` cuts the release. `gala-release.yml` runs gala (`.gala.toml`), which:

1. Computes the next version from Conventional Commits.
2. Bumps it in `Cargo.toml`, `package.json`, `tree-sitter.json`, and `snowflake-handlers`' dependency on the grammar crate.
3. Refreshes the lockfiles and regenerates the parser, whose metadata embeds the `tree-sitter.json` version.
4. Writes `CHANGELOG.md`, commits, tags `v<version>`, and pushes with a deploy key.
5. Fast-forwards `dev` to the release commit.

The workflow then dispatches `release.yml`. From the verified commit, it publishes the crate to crates.io and the npm package to npm and GitHub Packages, with prebuilt native addons for Linux and Windows. It also attaches a WASM build and the node-kind snapshot to the GitHub Release.

crates.io and npm are published through trusted publishing (OIDC), so the repository stores no registry token. Each crate and the npm package name `release.yml` and the `publish` environment as their trusted publisher on the registry; update those settings if the file, environment, or repository is renamed. A new package needs its first version published by hand before a trusted publisher can be set. GitHub Packages uses the job's `GITHUB_TOKEN`.

`snowflake-handlers` keeps its own version. Bump it by hand in `snowflake-handlers/Cargo.toml` and add its `CHANGELOG.md` section, headed `## [<version>](<release URL>) - <date>`, in the pull request that changes it. `release.yml` publishes it with the grammar when that version is not on crates.io yet. It then tags `snowflake-handlers-v<version>` at the release commit and creates its GitHub Release from that section. A missing or empty section fails that job, and so does a heading still marked `Unreleased`. Verify rejects an `Unreleased` heading on every pull request to `main`, because by the time the release job runs the crate is already published.

### Maintenance

`cache-cleanup.yml` deletes stale Actions caches on a daily schedule. Nothing is deployed.

## Where things live

| Path | Holds |
| --- | --- |
| `grammar.js`, `grammar/` | Grammar source |
| `src/` | Generated parser and external scanner |
| `queries/` | Highlight, injection, locals, structure, tags, folds, and indents queries |
| `bindings/` | Rust and Node bindings |
| `snowflake-handlers/` | Embedded handler extraction crate |
| `test/`, `tools/` | Corpus, fixtures, and verification scripts |
| `docs/` | Reference documents |
| `.github/workflows/` | Verify, release, and maintenance workflows |
| `.gala.toml` | Release configuration (gala) |
