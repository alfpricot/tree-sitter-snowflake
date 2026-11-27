# Foreign-language procedure and function bodies

A `LANGUAGE JAVASCRIPT`/`PYTHON`/`JAVA`/`SCALA` body is not Snowflake SQL — it is a different language carried inside the body's delimiters. This grammar does not parse that language, but it exposes the body so another grammar can:

- The declared language is a `language` field on the `create_procedure`/`create_function` node. A staged handler (`IMPORTS` and `HANDLER` with no `AS` clause) has a `language` field and no `body` field.
- The body's content — the text between the delimiters, excluding the delimiters themselves — is its own node, distinct for the two delimiter forms Snowflake accepts: `dollar_quoted_body` for `$$ ... $$`, and `string_body` for the single-quoted `AS '...'` form. SQL-language bodies use `dollar_quoted_script` or `dollar_quoted_expression` instead of `dollar_quoted_body`.
- `string_body`'s doubled-apostrophe escape (`''`) and backslash escapes are their own `doubled_quote`/`escape` nodes inside the content, so a consumer can reconstruct the real text and map a position in it back to a position in the file without re-lexing the body by hand.
- `queries/injections.scm` ships with the grammar, one branch per language. Tree-sitter's injection mechanism parses byte ranges of the original source, so it reaches every dollar-quoted body, and a single-quoted JavaScript or Python body only when that body holds no `''` and no backslash escape. Any other single-quoted body differs from its source text and is not injected.

The companion [`snowflake-handlers`](../snowflake-handlers/README.md) crate implements extraction, source-position mapping, embedded parsing, and advisory restriction checks. JavaScript and Python are included; Java and Scala are optional Cargo features. The grammar package does not depend on the companion. See [Consumer integration](CONSUMER_INTEGRATION.md) for measurement and masking integration.
