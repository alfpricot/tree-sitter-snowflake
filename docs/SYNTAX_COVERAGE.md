# Syntax coverage

What the grammar parses today. It covers Snowflake SQL only, so T-SQL and PostgreSQL syntax are out of scope. Input it cannot parse produces `ERROR` or `MISSING` nodes for a consumer to measure and act on.

## Queries and DML

- `SELECT` with CTEs (including recursive), set operators, `QUALIFY`, window functions and named windows, `CONNECT BY`, `MATCH_RECOGNIZE`, `PIVOT`, `UNPIVOT`, and time travel
- inner, outer, cross, and natural joins, with or without `ON` or `USING`, and `LATERAL` sources such as `FLATTEN`
- `GROUP BY ALL`, `GROUPING SETS`, `CUBE`, and `ROLLUP`
- `INSERT` (including multi-table), `UPDATE`, `DELETE`, `TRUNCATE`, and `MERGE`

## Expressions

The semi-structured `:` path operator, lambdas, `[...]` array literals, `{...}` object constants (including wildcards), `IDENTIFIER(...)`, `* EXCLUDE` and `* RENAME`, session variables (`$var`), positional and named binds, and `=>` named arguments.

## DDL

| Statement | Object families |
| --- | --- |
| `CREATE` | table (including external, Iceberg, event, and hybrid), view, materialized view, dynamic table, semantic view, stage, file format, stream, pipe, task, alert, policy (masking, row access, aggregation, projection, network, password, session, authentication), warehouse, database, schema, role, user, sequence, tag, integration, Streamlit, Cortex search service, agent, procedure, function |
| `ALTER` | table, view, task, warehouse, database, schema, stage, stream, sequence, role, user, pipe, integration, session, account, policy, alert, procedure, function |
| `DROP`, `UNDROP` | single-word object kinds, materialized view, file format, policies, dynamic, external, and Iceberg tables, semantic view, Cortex search service, integrations, database role (`DROP` only), and network rule; `DROP PROCEDURE` and `DROP FUNCTION` also take an argument signature |

## Administration and data transfer

`GRANT` and `REVOKE` (including future grants), `COPY INTO` in both directions, `PUT`, `GET`, `LIST`, `REMOVE`, `CALL`, `USE`, `SET`, `UNSET`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `COMMENT ON`, and transactions.

## Snowflake Scripting

Blocks, branches, loops, cursors, `RESULTSET`, `EXECUTE IMMEDIATE`, and `EXCEPTION ... WHEN`, in procedure and function definitions or as scripts.

## Known gaps

These Snowflake forms produce `ERROR` or `MISSING` nodes:

- `IGNORE NULLS` and `RESPECT NULLS`
- `SAMPLE` and `TABLESAMPLE`
- `ASOF ... MATCH_CONDITION` joins
- `LIKE ... ESCAPE`
- structured `ARRAY(INT)` and `OBJECT(a INT)` types
- `DROP` with other multi-word kinds, such as `EXTERNAL VOLUME`
- `GRANT` and `REVOKE` on one object of other multi-word kinds, such as `GIT REPOSITORY` (the plural forms parse)

Two more forms parse without errors but not as what they are. `LIKE ANY (...)` reads as `LIKE` applied to a call of a function named `ANY`, and a structured `MAP(VARCHAR, INT)` type reads as a `custom_type`.

## Related

See [Consumer integration](CONSUMER_INTEGRATION.md) for how to apply the node names, and `test/corpus/` and `test/fixtures/` for the constructs under test. The parse-rate harness in `tools/parse-rate/` measures a local corpus of your own.
