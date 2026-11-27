# Syntax coverage

What the grammar parses today. It covers Snowflake SQL only, so T-SQL and PostgreSQL syntax are out of scope. Input it cannot parse produces `ERROR` or `MISSING` nodes for a consumer to measure and act on.

## Queries and DML

- `SELECT` with CTEs (including recursive), set operators, `QUALIFY`, window functions and named windows, `CONNECT BY`, `MATCH_RECOGNIZE`, `PIVOT`, `UNPIVOT`, time travel, `SAMPLE` and `TABLESAMPLE` after the alias, and `IGNORE NULLS` or `RESPECT NULLS` before `OVER`
- inner, outer, cross, natural, and `ASOF ... MATCH_CONDITION` joins, with or without `ON` or `USING`, and `LATERAL` sources such as `FLATTEN`
- `GROUP BY ALL`, `GROUPING SETS`, `CUBE`, and `ROLLUP`
- `INSERT` (including multi-table), `UPDATE`, `DELETE`, `TRUNCATE`, and `MERGE`

## Expressions

`LIKE` and `ILIKE`, including the quantified `ANY` and `ALL` forms and `ESCAPE`, structured `ARRAY(...)`, `OBJECT(...)`, and `MAP(...)` types, `NTH_VALUE(...) FROM FIRST` or `FROM LAST`, the semi-structured `:` path operator, lambdas, `[...]` array literals, `{...}` object constants (including wildcards), `IDENTIFIER(...)`, `* EXCLUDE` and `* RENAME`, session variables (`$var`), positional and named binds, and `=>` named arguments.

## DDL

| Statement | Object families |
| --- | --- |
| `CREATE` | table (including external, Iceberg, event, and hybrid, and an event table without a column list), view, materialized view, dynamic table, semantic view, stage, file format, stream, pipe, task, alert, secret, network rule, policy (masking, row access, aggregation, projection, network, password, session, authentication), warehouse, database, schema, role, database role, user, sequence, tag, integration, share, external volume, notebook, replication group, failover group, Streamlit, Cortex search service, agent, procedure, function |
| `ALTER` | table, view, task, warehouse, database, schema, stage, stream, sequence, role, database role, user, pipe, integration (typed or not), session, account, policy, alert, secret, network rule, share, external volume, notebook, replication group, failover group, procedure, function |
| `DROP`, `UNDROP` | single-word object kinds, materialized view, file format, policies, dynamic, external, and Iceberg tables, semantic view, Cortex search service, integrations, database role (`DROP` only), network rule, share, secret, notebook, external volume, event table, replication group, and failover group; `DROP PROCEDURE` and `DROP FUNCTION` also take an argument signature |

## Administration and data transfer

`GRANT` and `REVOKE` (including future grants and database roles), `COPY INTO` in both directions, `PUT`, `GET`, `LIST`, `REMOVE`, `CALL`, `USE`, `SET`, `UNSET`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `COMMENT ON`, and transactions.

## Snowflake Scripting

Blocks, branches, loops, cursors, `RESULTSET`, `EXECUTE IMMEDIATE`, and `EXCEPTION ... WHEN`, in procedure and function definitions or as scripts.

## Known gaps

These Snowflake forms produce `ERROR` or `MISSING` nodes:

- `DROP` with other multi-word kinds, such as `GIT REPOSITORY`
- `GRANT` and `REVOKE` on one object of other multi-word kinds, such as `GIT REPOSITORY` (the plural forms parse)

`ESCAPE` right after a `LIKE` pattern is always the escape clause, so an alias spelled `escape` there needs `AS`.

## Related

See [Consumer integration](CONSUMER_INTEGRATION.md) for how to apply the node names, and `test/corpus/` and `test/fixtures/` for the constructs under test. The parse-rate harness in `tools/parse-rate/` measures a local corpus of your own.
