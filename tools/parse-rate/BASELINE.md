# Parse-rate baseline

A committed record of the error rate over real Snowflake sources, measured by the share of bytes in `ERROR` and `MISSING` nodes. It is advisory: no script or workflow compares a run with it, so a regression shows up only when someone re-measures after a grammar change and reads the numbers.

The source corpora are private (they carry real database, schema, table and
column names), so they are provided locally and only the resulting numbers
are committed. An outside contributor cannot reproduce this check; that is
an accepted trade for a grammar written for in-house tooling.

## How to measure

```bash
node tools/parse-rate/parse-rate.mjs <path-to-corpus>   # add --json for per-file data
```

## Baseline (2026-09-08)

| Corpus | Files | Error-free | Bytes in errors |
|---|---|---|---|
| Corpus A | 823 | 821 (99.8%) | 0.0% |
| Corpus B | 162 | 162 (100%) | 0.0% |

The two failing Corpus A files contain a Streamlit `root_location='...`
string literal that is genuinely unterminated in the source; erroring on
them is correct behavior, not a grammar gap.

### Pre-fork reference (2026-09-02, `tree-sitter-sequel-tsql` 0.4.2)

| Corpus | Error-free | Bytes in errors |
|---|---|---|
| Corpus A | 0.1% | 59.3% |
| Corpus B | 17.4% | 23.4% |
