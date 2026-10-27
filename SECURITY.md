# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use [GitHub's private vulnerability reporting](https://github.com/alfpricot/tree-sitter-snowflake/security/advisories/new) and include what you found, how to reproduce it, and the impact you expect. A parser crash or hang on some input that could affect downstream consumers belongs here too; a plain parse failure on valid Snowflake SQL is an ordinary bug for a normal issue, with a minimized input.

## Scope

The grammar, its generated parser and scanner, the Rust and Node bindings, and the `snowflake-handlers` crate in this repository. Handler code is analyzed, never executed.

## Supported versions

The latest published release of each package receives fixes.

## Practices

- Don't commit credentials, and don't copy names from a real source corpus into a fixture. Fixtures are synthetic.
- Dependencies are kept current through Dependabot.
