# Syntax coverage

What the grammar parses today. The grammar covers Snowflake SQL only; T-SQL and PostgreSQL syntax are out of scope, and a file it cannot parse produces `ERROR` nodes for a consumer to measure and act on.

**Status: Tier 1 and Tier 2 coverage complete, plus most of Tier 3.** `SELECT` in full (CTEs incl.
recursive, set operators, joins incl. `LATERAL`, `QUALIFY`, `GROUP BY GROUPING SETS`/`CUBE`/
`ROLLUP`, window functions, `MATCH_RECOGNIZE`, `PIVOT`/`UNPIVOT`), `MERGE`, `CREATE`/`ALTER`/`DROP`
for supported object families (table, view, materialized and dynamic table, stage, file
format, stream, pipe, task, warehouse, database, schema, role, user, sequence, tag, integration,
streamlit, Cortex search service and agent, semantic view), `GRANT`/`REVOKE` incl. future grants,
`COPY INTO` both directions, `PUT`/`GET`/`LIST`/`REMOVE`, `CALL`/`USE`/`SET`/`UNSET`/`SHOW`/
`DESCRIBE`/`COMMENT ON`, transactions, procedure and function definitions with Snowflake Scripting
control flow complete through cursors, `RESULTSET`, `EXECUTE IMMEDIATE`, and `EXCEPTION ... WHEN`,
and the semi-structured `:` path operator, `LATERAL FLATTEN`, `IDENTIFIER(...)`, `* EXCLUDE`/
`RENAME`, session variables (`$var`), positional/named binds, `ARRAY`/`OBJECT` constructors, and
`=>` named arguments.

See [Consumer integration](CONSUMER_INTEGRATION.md) for how to apply the node names, and the repository's `test/corpus/` and `test/fixtures/` for the constructs under test.

The repository includes synthetic fixtures and a parse-rate harness (`tools/parse-rate/`) for evaluating a local Snowflake SQL corpus.
