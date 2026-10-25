# Foreign-language procedure and function bodies

A `LANGUAGE JAVASCRIPT`/`PYTHON`/`JAVA`/`SCALA` body is not Snowflake SQL — it is a different
language carried inside the body's delimiters. This grammar does not parse that language, but it
exposes the body so another grammar can:

- The declared language is a `language` field on the `create_procedure`/`create_function`/
  `alter_procedure`/`alter_function` node.
- The body's content — the text between the delimiters, excluding the delimiters themselves — is
  its own node, distinct for the two delimiter forms Snowflake accepts:
  `dollar_quoted_body`/`dollar_quoted_script`/`dollar_quoted_expression` for `$$ ... $$`, and
  `string_body` for the single-quoted `AS '...'` form.
- `string_body`'s doubled-apostrophe escape (`''`) and backslash escapes are their own
  `doubled_quote`/`escape` nodes inside the content, so a consumer can reconstruct the real text
  and map a position in it back to a position in the file without re-lexing the body by hand.
- `queries/injections.scm` ships with the grammar, one branch per language. It only reaches the
  dollar-quoted form — tree-sitter's injection mechanism parses a byte range of the original
  source, and the single-quoted form's `''` doubling means its byte range is not the embedded
  language's source.

The companion [`snowflake-handlers`](../snowflake-handlers/README.md) crate implements extraction,
source-position mapping, embedded parsing, and advisory restriction checks. JavaScript and Python
are included; Java and Scala are optional Cargo features. The grammar package does not depend on
the companion. See [Consumer integration](CONSUMER_INTEGRATION.md) for measurement and masking
integration.
