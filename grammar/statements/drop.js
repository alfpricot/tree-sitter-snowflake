import { comma_list, typed_integration } from '../helpers.js';

// Snowflake DROP — one shape for most object kinds, with CASCADE and
// RESTRICT accepted (and ignored by Snowflake) on tables. A procedure or
// function is identified by its argument types, and some kinds are spelled
// with more than one word.
export default {
  _drop_statement: ($) =>
    seq(
      $.keyword_drop,
      choice(
        seq(
          choice(
            $.object_kind,
            alias($._multi_word_object_kind, $.object_kind),
            alias($._database_role_kind, $.object_kind),
          ),
          optional($._if_exists_clause),
          comma_list(field('name', $.object_reference), true),
        ),
        // DROP DATABASE role — a database that happens to be named `role`,
        // which the DATABASE ROLE kind would otherwise swallow.
        seq(
          alias($._database_kind, $.object_kind),
          field('name', alias($._role_as_name, $.object_reference)),
        ),
        // DROP {PROCEDURE | FUNCTION} name (argtypes)
        seq(
          alias($._routine_object_kind, $.object_kind),
          optional($._if_exists_clause),
          field('name', $.object_reference),
          $.function_argument_types,
        ),
      ),
      optional(choice($.keyword_cascade, $.keyword_restrict)),
    ),

  _routine_object_kind: ($) => choice($.keyword_procedure, $.keyword_function),

  _database_kind: ($) => $.keyword_database,
  _role_as_name: ($) => field('name', alias($.keyword_role, $.identifier)),

  // DATABASE ROLE is a kind DROP names but a grant's ON clause does not.
  _database_role_kind: ($) => seq($.keyword_database, $.keyword_role),

  // The multi-word kinds DROP, UNDROP, GRANT, and REVOKE share. They stay
  // out of object_kind so a grant can also read their words as a plural
  // (see _plural_object_kind).
  _multi_word_object_kind: ($) =>
    choice(
      seq(choice($.keyword_dynamic, $.keyword_external, $.keyword_iceberg), $.keyword_table),
      seq($.keyword_semantic, $.keyword_view),
      seq($.keyword_network, $.keyword_rule),
      seq($.keyword_external, $.keyword_volume),
      seq(choice($.keyword_replication, $.keyword_failover), $.keyword_group),
      seq($.keyword_event, $.keyword_table),
      seq($.keyword_cortex, $.keyword_search, $.keyword_service),
      typed_integration($),
    ),

  // UNDROP {TABLE | SCHEMA | DATABASE | ...} name
  undrop_statement: ($) =>
    seq(
      $.keyword_undrop,
      choice($.object_kind, alias($._multi_word_object_kind, $.object_kind)),
      field('name', $.object_reference),
    ),
};
