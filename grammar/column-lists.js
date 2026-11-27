import {
  comma_list,
  paren_list,
  stage_reference_or_quoted,
  wrapped_in_parenthesis,
} from './helpers.js';

// REFERENCES t [(cols)] [MATCH {FULL | SIMPLE | PARTIAL}]
//   [ON UPDATE action] [ON DELETE action] [[NOT] ENFORCED] [RELY | NORELY]
// `not_enforced` says whether the clause takes the NOT ENFORCED suffix
// itself. prec.right keeps the trailing suffixes with the clause.
function referential_clause($, not_enforced) {
  return prec.right(
    seq(
      $.keyword_references,
      $.object_reference,
      optional(paren_list($.identifier, true)),
      optional(seq($.keyword_match, choice($.keyword_full, $.keyword_simple, $.keyword_partial))),
      repeat($.referential_action),
      ...(not_enforced ? [optional($.keyword_not_enforced)] : []),
      optional(choice($.keyword_rely, seq($.keyword_no, $.keyword_rely))),
    ),
  );
}

// Column definitions, constraints and option lists, shared by CREATE
// TABLE, ALTER TABLE ... ADD, and the option-driven DDL (stages, tasks,
// warehouses, file formats, copy options, session parameters).
export default {
  _column_list: ($) => paren_list(alias($._column, $.column), true),

  _column: ($) => $.identifier,

  // ( column | constraint [, ...] ) — a table-level constraint may appear
  // anywhere in the list, between columns as well as at the end.
  column_definitions: ($) => paren_list(choice($.column_definition, $.table_constraint), true),

  // name [type] [constraint ...] — the type is optional so the same rule
  // covers a CTAS column list (`CREATE TABLE t (a, b) AS SELECT ...`),
  // where Snowflake takes the types from the query.
  column_definition: ($) =>
    prec.left(
      seq(field('name', $._column), optional(field('type', $._type)), repeat($._column_constraint)),
    ),

  _column_constraint: ($) =>
    prec.right(
      choice(
        $.keyword_null,
        $._not_null,
        seq(
          optional(seq($.keyword_constraint, field('name', $.identifier))),
          choice(
            seq($.keyword_default, $._expression),
            seq(
              choice(
                seq($.keyword_primary, $.keyword_key),
                $.keyword_unique,
                seq($.keyword_foreign, $.keyword_key),
              ),
              optional(wrapped_in_parenthesis(comma_list($.identifier, true))),
              optional($.referential_clause),
            ),
            // FOREIGN KEY is optional in an inline constraint:
            // `a INT REFERENCES u (id)`.
            alias($._inline_referential_clause, $.referential_clause),
          ),
        ),
        seq(
          $.keyword_autoincrement,
          optional(
            wrapped_in_parenthesis(
              seq(field('start', $._expression), ',', field('increment', $._expression)),
            ),
          ),
          // START 1 INCREMENT 1 NOORDER — the bare sequence-parameter
          // spelling autoincrement columns take.
          repeat(
            choice(
              seq($.keyword_start, alias($._natural_number, $.literal)),
              seq($.keyword_increment, alias($._natural_number, $.literal)),
              $.identifier,
            ),
          ),
        ),
        seq($.keyword_collate, alias($._single_quote_string, $.literal)),
        seq($.keyword_comment, alias($._single_quote_string, $.literal)),
        // AS (expr) — the virtual (computed) column, which follows the type.
        seq($.keyword_as, field('expression', wrapped_in_parenthesis($._expression))),
        $._with_column_policy,
        $._with_tag,
        // NOT ENFORCED [RELY | NORELY] after an inline REFERENCES, which
        // leaves these suffixes to the constraint list.
        seq(
          $.keyword_not_enforced,
          optional(choice($.keyword_rely, seq($.keyword_no, $.keyword_rely))),
        ),
      ),
    ),

  _not_null: ($) => seq($.keyword_not, $.keyword_null),

  keyword_not_enforced: ($) => seq($.keyword_not, $.keyword_enforced),

  // Snowflake accepts and ignores referential constraints; it never
  // enforces them, and CHECK constraints are not part of the dialect at
  // all, so they are deliberately absent. The clause's shape is in the
  // referential_clause function at the top of this file.
  referential_clause: ($) => referential_clause($, true),

  // The bare inline form (`a INT REFERENCES u (id)`) leaves a trailing
  // NOT ENFORCED to the column-constraint list, where it is a constraint of
  // its own. Inside the clause, a NOT right after the referenced columns
  // would always be read as the start of NOT ENFORCED, so the common
  // `a INT REFERENCES u (id) NOT NULL` would fail at NULL.
  _inline_referential_clause: ($) => referential_clause($, false),

  // ON UPDATE / ON DELETE, in either order, each with its action. Snowflake
  // also documents `ON UPDATE action DELETE action` under one ON, so a
  // second event may follow the first action without repeating ON.
  referential_action: ($) =>
    seq($.keyword_on, $._referential_event, optional($._referential_event)),

  _referential_event: ($) =>
    seq(choice($.keyword_update, $.keyword_delete), $._referential_action_kind),

  _referential_action_kind: ($) =>
    choice(
      $.keyword_cascade,
      $.keyword_restrict,
      seq($.keyword_set, $.keyword_null),
      seq($.keyword_set, $.keyword_default),
      seq($.keyword_no, $.keyword_action),
    ),

  // Table-level constraint, also the shape ALTER TABLE ... ADD accepts.
  table_constraint: ($) =>
    prec.right(
      seq(
        optional(seq($.keyword_constraint, field('name', $.identifier))),
        choice(
          seq(
            choice(seq($.keyword_primary, $.keyword_key), $.keyword_unique),
            paren_list($.identifier, true),
            optional($.keyword_not_enforced),
            optional(choice($.keyword_rely, seq($.keyword_no, $.keyword_rely))),
          ),
          seq(
            $.keyword_foreign,
            $.keyword_key,
            paren_list($.identifier, true),
            $.referential_clause,
          ),
        ),
      ),
    ),

  // tag = 'value' — the tag is a schema object, so its name may be
  // qualified (db.schema.tag).
  tag_assignment: ($) =>
    seq(field('name', $.object_reference), '=', alias($._single_quote_string, $.literal)),

  // The option list most Snowflake DDL takes, parenthesized:
  // `COPY_OPTIONS = (ON_ERROR = 'ABORT', PURGE = TRUE)` or a file
  // format's `(TYPE = CSV FIELD_DELIMITER = '|', SKIP_HEADER = 1)` — the
  // separator inside the parentheses is a space, a comma, or both, so the
  // comma is optional rather than the join. Option names are identifiers —
  // Snowflake has hundreds across warehouses, tasks, stages, file formats,
  // copy options and session parameters, and nothing downstream needs them
  // distinguished.
  _paren_options: ($) =>
    wrapped_in_parenthesis(seq($.option, repeat(seq(optional(','), $.option)))),

  // The bare, unparenthesized spelling the warehouse/task/stage DDL uses:
  // `WAREHOUSE_SIZE = 'XSMALL' AUTO_RESUME = TRUE`.
  with_clause: ($) => prec.right(seq(optional($.keyword_with), repeat1($.option))),

  option: ($) =>
    prec.right(
      seq(
        field('name', $.identifier),
        optional(
          choice(
            seq('=', field('value', $._option_value)),
            $._paren_options,
            seq('=', $._paren_options),
          ),
        ),
      ),
    ),

  _option_value: ($) =>
    prec.right(
      choice(
        seq(
          // object_reference covers single- and multi-part names alike; a
          // separate identifier alternative here would fork every dotted
          // option value (FILE_FORMAT = db.schema.FF1) into a reduce/shift
          // conflict.
          choice($.keyword_on, $.keyword_off, $.object_reference),
          optional($._paren_options),
        ),
        stage_reference_or_quoted($),
        $.literal,
        // ('a', 'b', ...) — a parenthesized literal list, e.g. a storage
        // integration's STORAGE_ALLOWED_LOCATIONS or a UDF's PACKAGES.
        wrapped_in_parenthesis(comma_list($.literal, true)),
      ),
    ),
};
