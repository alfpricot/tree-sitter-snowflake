import { create_header, paren_list } from '../helpers.js';

// Tables, views, materialized views, and dynamic tables.
export default {
  // CREATE [OR REPLACE] [TRANSIENT] TABLE [IF NOT EXISTS] name
  //   { ( column_definitions ) [table options]
  //   | [CLUSTER BY (...)] AS query
  //   | LIKE other_table
  //   | CLONE other_table }
  //   [COPY GRANTS] [WITH TAG (...)] ...
  create_table: ($) => choice($._create_table_definition, $._create_bare_event_table),

  // CREATE EVENT TABLE name [options] — an event table's columns are fixed,
  // so it is usually declared without a column list.
  _create_bare_event_table: ($) =>
    prec.right(
      seq(...create_header($, [$.keyword_event, $.keyword_table]), repeat($.table_option)),
    ),

  _create_table_definition: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_table, {
          modifiers: [
            repeat(
              choice(
                $.keyword_transient,
                $.keyword_volatile,
                $.keyword_temporary,
                $.keyword_local,
                $.keyword_global,
                $.keyword_external,
                $.keyword_iceberg,
                $.keyword_event,
                $.keyword_hybrid,
              ),
            ),
          ],
        }),
        optional($.cluster_by),
        choice(
          seq(
            $.column_definitions,
            repeat($.table_option),
            optional(seq($.keyword_as, $.create_query)),
          ),
          seq(repeat($.table_option), $.keyword_as, $.create_query),
          seq($.keyword_like, $.object_reference),
          seq(
            $.keyword_clone,
            $.object_reference,
            optional($._time_travel_clause),
            repeat($.table_option),
          ),
        ),
      ),
    ),

  // The CTAS query.
  create_query: ($) => $._dml_read,

  // CLUSTER BY (expr, ...), PARTITION BY (...), COPY GRANTS, and the
  // identifier = value property tail Snowflake tables carry.
  table_option: ($) =>
    prec.left(
      choice(
        $.cluster_by,
        $.table_partition_by,
        seq($.keyword_copy, $.keyword_grants),
        $._with_tag,
        $._with_policy,
        $._with_contact,
        $.option,
      ),
    ),

  // PARTITION BY (col, ...) — a table's partition columns. Distinct from
  // the window and MATCH_RECOGNIZE `partition_by`, which takes a bare list.
  table_partition_by: ($) =>
    seq($.keyword_partition, $.keyword_by, paren_list($._expression, true)),

  cluster_by: ($) => seq($.keyword_cluster, $.keyword_by, paren_list($._expression, true)),

  // CREATE [OR REPLACE] [SECURE] VIEW [IF NOT EXISTS] name [(cols)]
  //   [COPY GRANTS] [COMMENT = '...'] AS query
  // A column list entry may carry its own COMMENT '...'.
  create_view: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_view, { modifiers: [optional($.keyword_secure)] }),
        optional(paren_list($.view_column, true)),
        repeat($.view_option),
        $.keyword_as,
        $.create_query,
      ),
    ),

  view_column: ($) =>
    seq(
      field('name', $.identifier),
      repeat(
        choice(
          seq($.keyword_comment, alias($._single_quote_string, $.literal)),
          $._with_column_policy,
          $._with_tag,
        ),
      ),
    ),

  // CREATE [OR REPLACE] MATERIALIZED VIEW name [(cols)]
  //   [COMMENT = ''] [CLUSTER BY (...)] AS query
  // The columns take the same COMMENT, policy, and tag clauses as a view's.
  create_materialized_view: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_materialized,
        $.keyword_view,
        field('name', $.object_reference),
        optional(paren_list($.view_column, true)),
        repeat(choice($.cluster_by, $.view_option)),
        $.keyword_as,
        $.create_query,
      ),
    ),

  // CREATE [OR REPLACE] DYNAMIC TABLE name [(cols)]
  //   TARGET_LAG = '..' WAREHOUSE = '..' [COMMENT = ''] AS query
  create_dynamic_table: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_dynamic,
        $.keyword_table,
        field('name', $.object_reference),
        optional(paren_list($.dynamic_table_column, true)),
        repeat1(choice($._with_tag, $._with_policy, $.option)),
        $.keyword_as,
        $.create_query,
      ),
    ),

  // A dynamic table column: a name, an optional type, then the view column
  // clauses plus WITH CONTACT.
  dynamic_table_column: ($) =>
    seq(
      field('name', $.identifier),
      optional(field('type', $._type)),
      repeat(
        choice(
          seq($.keyword_comment, alias($._single_quote_string, $.literal)),
          $._with_column_policy,
          $._with_tag,
          $._with_contact,
        ),
      ),
    ),

  view_option: ($) =>
    choice(
      seq($.keyword_copy, $.keyword_grants),
      $._with_tag,
      $._with_policy,
      $._with_contact,
      $.option,
    ),
};
