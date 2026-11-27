// Snowflake ALTER statements. The table takes a detailed action list; the
// other objects share one shape — SET options, UNSET names, RENAME TO,
// and the object's own resume/suspend verbs — generated from a plain
// function rather than a shared named rule, because a named rule whose
// every segment is optional matches the empty string and `generate`
// rejects it.
import {
  comma_list,
  paren_list,
  set_unset_properties,
  set_unset_tags,
  typed_integration,
  wrapped_in_parenthesis,
} from '../helpers.js';

// `tags: false` leaves out SET TAG / UNSET TAG for an object Snowflake
// doesn't tag.
function alter_object(
  keyword,
  actions = [],
  { tags = true, spaced = false, name = ($) => $.object_reference } = {},
) {
  return ($) =>
    seq(
      $.keyword_alter,
      keyword($),
      optional($._if_exists_clause),
      field('name', name($)),
      choice(
        ...actions.map((action) => action($)),
        ...(tags ? set_unset_tags($) : []),
        ...set_unset_properties($, { spaced }),
        seq($.keyword_rename, $.keyword_to, $.object_reference),
      ),
    );
}
// ALTER {REPLICATION | FAILOVER} GROUP [IF EXISTS] name action
function alter_group(kind) {
  return ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        kind($),
        $.keyword_group,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        choice(
          seq($.keyword_rename, $.keyword_to, $.object_reference),
          seq($.keyword_set, repeat1($.group_property), optional($._ignore_edition_check)),
          ...set_unset_tags($),
          seq($.keyword_unset, comma_list($.identifier, true)),
          // ADD names TO list, REMOVE names FROM list. The ALLOWED_ACCOUNTS
          // list holds accounts, which are not schema objects.
          seq(
            choice(
              seq($.keyword_add, comma_list($.object_reference, true), $.keyword_to, $.identifier),
              seq(
                $.keyword_add,
                comma_list($.account_identifier, true),
                $.keyword_to,
                alias($.keyword_allowed_accounts, $.identifier),
              ),
            ),
            optional($._ignore_edition_check),
          ),
          seq($.keyword_remove, comma_list($.object_reference, true), $.keyword_from, $.identifier),
          seq(
            $.keyword_remove,
            comma_list($.account_identifier, true),
            $.keyword_from,
            alias($.keyword_allowed_accounts, $.identifier),
          ),
          // MOVE {DATABASES | SHARES} names TO FAILOVER GROUP name
          seq(
            $.keyword_move,
            $.identifier,
            comma_list($.object_reference, true),
            $.keyword_to,
            choice($.keyword_failover, $.keyword_replication),
            $.keyword_group,
            $.object_reference,
          ),
          $.keyword_refresh,
          $.keyword_primary,
          seq($.keyword_suspend, optional($.keyword_immediate)),
          $.keyword_resume,
        ),
      ),
    );
}

export default {
  _alter_statement: ($) =>
    choice(
      $.alter_table,
      $.alter_view,
      $.alter_task,
      $.alter_warehouse,
      $.alter_database,
      $.alter_schema,
      $.alter_stage,
      $.alter_stream,
      $.alter_sequence,
      $.alter_role,
      $.alter_user,
      $.alter_pipe,
      $.alter_integration,
      $.alter_session,
      $.alter_account,
      $.alter_policy,
      $.alter_alert,
      $.alter_database_role,
      $.alter_share,
      $.alter_external_volume,
      $.alter_notebook,
      $.alter_secret,
      $.alter_network_rule,
      $.alter_replication_group,
      $.alter_failover_group,
    ),

  alter_table: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        optional($.keyword_event),
        $.keyword_table,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        repeat1(
          choice(
            $.add_column_action,
            $.drop_column_action,
            $.rename_column_action,
            $.alter_column_action,
            $.constraint_action,
            $.cluster_by,
            seq($.keyword_drop, $.keyword_cluster, $.keyword_by),
            seq($.keyword_swap, $.keyword_with, $.object_reference),
            seq($.keyword_rename, $.keyword_to, $.object_reference),
            seq($.keyword_add, $.keyword_search, $.keyword_optimization, optional($.keyword_on)),
            seq($.keyword_drop, $.keyword_search, $.keyword_optimization),
            ...set_unset_tags($),
            ...set_unset_properties($),
          ),
        ),
      ),
    ),

  add_column_action: ($) =>
    seq(
      $.keyword_add,
      $.keyword_column,
      optional($._if_not_exists),
      comma_list($.column_definition, true),
    ),

  drop_column_action: ($) =>
    seq(
      $.keyword_drop,
      $.keyword_column,
      optional($._if_exists_clause),
      comma_list($.identifier, true),
    ),

  rename_column_action: ($) =>
    seq($.keyword_rename, $.keyword_column, $.identifier, $.keyword_to, $.identifier),

  // {ALTER | MODIFY} COLUMN name {SET DATA TYPE t | UNSET DATA TYPE |
  //   SET DEFAULT expr | DROP DEFAULT | [SET] NOT NULL | DROP NOT NULL |
  //   SET MASKING POLICY p [USING (...)] | UNSET MASKING POLICY |
  //   SET TAG t = 'v', ... | UNSET TAG [t, ...]}
  alter_column_action: ($) =>
    seq(
      choice($.keyword_alter, $.keyword_modify),
      $.keyword_column,
      optional($._if_exists_clause),
      $.identifier,
      choice(
        seq($.keyword_set, $.keyword_data, $.keyword_type, $._type),
        seq($.keyword_unset, $.keyword_data, $.keyword_type),
        seq($.keyword_set, $.keyword_default, $._expression),
        seq($.keyword_drop, $.keyword_default),
        seq(optional($.keyword_set), $._not_null),
        seq($.keyword_drop, $._not_null),
        seq(
          $.keyword_set,
          $.keyword_masking,
          $.keyword_policy,
          $.object_reference,
          optional(seq($.keyword_using, paren_list($.identifier, true))),
        ),
        seq($.keyword_unset, $.keyword_masking, $.keyword_policy),
        seq($.keyword_with, $.keyword_tag, paren_list($.tag_assignment, true)),
        seq($.keyword_set, $.keyword_tag, comma_list($.tag_assignment, true)),
        seq($.keyword_unset, $.keyword_tag, optional(comma_list($.object_reference, true))),
      ),
    ),

  constraint_action: ($) =>
    seq(
      $.keyword_add,
      optional(seq($.keyword_constraint, $.identifier)),
      choice(
        seq(
          seq($.keyword_primary, $.keyword_key),
          paren_list($.identifier, true),
          optional($._not_enforced),
        ),
        seq($.keyword_unique, paren_list($.identifier, true), optional($._not_enforced)),
        seq($.keyword_foreign, $.keyword_key, paren_list($.identifier, true), $.referential_clause),
      ),
    ),

  alter_view: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        $.keyword_view,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        repeat1(
          choice(
            seq($.keyword_rename, $.keyword_to, $.object_reference),
            ...set_unset_tags($),
            ...set_unset_properties($),
            seq(
              $.keyword_add,
              $.keyword_row,
              $.keyword_access,
              $.keyword_policy,
              $.object_reference,
            ),
            seq($.keyword_drop, $.keyword_row, $.keyword_access, $.keyword_policy),
            $.keyword_secure,
          ),
        ),
      ),
    ),

  alter_warehouse: alter_object(
    ($) => $.keyword_warehouse,
    [
      ($) => $.keyword_suspend,
      ($) => seq($.keyword_resume, $.keyword_if, $.keyword_suspended),
      ($) => seq($.keyword_abort, $.keyword_all, $.keyword_queries),
    ],
  ),

  alter_database: alter_object(
    ($) => $.keyword_database,
    [
      ($) => seq($.keyword_swap, $.keyword_with, $.object_reference),
      ($) => seq($.keyword_enable, $.keyword_failsafe),
      ($) => seq($.keyword_disable, $.keyword_failsafe),
    ],
    // A database may be named `role`, as in CREATE DATABASE.
    { name: ($) => choice($.object_reference, alias($._role_as_name, $.object_reference)) },
  ),

  alter_schema: alter_object(
    ($) => $.keyword_schema,
    [($) => seq($.keyword_swap, $.keyword_with, $.object_reference)],
  ),

  alter_stage: alter_object(($) => $.keyword_stage, []),
  alter_stream: alter_object(($) => $.keyword_stream, []),
  alter_sequence: alter_object(($) => $.keyword_sequence, [], { tags: false }),
  alter_role: alter_object(($) => $.keyword_role, []),
  alter_user: alter_object(($) => $.keyword_user, []),
  alter_pipe: alter_object(
    ($) => $.keyword_pipe,
    [
      ($) => seq($.keyword_set, $.keyword_comment, '=', alias($._single_quote_string, $.literal)),
      ($) => $.keyword_refresh,
    ],
  ),
  // ALTER [{STORAGE | API | SECURITY | NOTIFICATION | EXTERNAL ACCESS}]
  //   INTEGRATION ...
  alter_integration: alter_object(($) => choice($.keyword_integration, typed_integration($)), [], {
    spaced: true,
  }),

  // The dynamic precedence reads `DATABASE ROLE r` as this rather than as a
  // database named `role`.
  alter_database_role: ($) =>
    prec.dynamic(1, alter_object((rules) => seq(rules.keyword_database, rules.keyword_role))($)),

  alter_secret: alter_object(($) => $.keyword_secret, [], { spaced: true }),
  alter_network_rule: alter_object(($) => seq($.keyword_network, $.keyword_rule), [], {
    spaced: true,
  }),
  alter_notebook: alter_object(
    ($) => $.keyword_notebook,
    [
      // ADD LIVE VERSION FROM LAST
      ($) => seq($.keyword_add, $.identifier, $.identifier, $.keyword_from, $.keyword_last),
    ],
    { spaced: true },
  ),

  // ALTER SHARE name {{ADD | REMOVE | SET} property ... | SET TAG ... |
  //   UNSET ...}
  alter_share: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        $.keyword_share,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        choice(
          seq(choice($.keyword_add, $.keyword_remove, $.keyword_set), repeat1($.group_property)),
          ...set_unset_tags($),
          seq($.keyword_unset, comma_list($.identifier, true)),
        ),
      ),
    ),

  alter_external_volume: alter_object(
    ($) => seq($.keyword_external, $.keyword_volume),
    [
      ($) => seq($.keyword_add, $.option),
      ($) => seq($.keyword_remove, $.identifier, alias($._single_quote_string, $.literal)),
      ($) => seq($.keyword_update, repeat1($.option)),
    ],
    { spaced: true },
  ),

  alter_replication_group: alter_group(($) => $.keyword_replication),
  alter_failover_group: alter_group(($) => $.keyword_failover),

  alter_session: ($) =>
    prec.right(seq($.keyword_alter, $.keyword_session, choice(...set_unset_properties($)))),

  // ALTER ACCOUNT SET <parameter> = value [, ...] — the account-level
  // parameter statements Snowflake scripts as one-liners.
  alter_account: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        $.keyword_account,
        choice(...set_unset_tags($), ...set_unset_properties($)),
      ),
    ),

  alter_policy: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        optional($._policy_kind),
        $.keyword_policy,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        choice(
          seq($.keyword_set, optional($.keyword_body), '->', field('body', $.policy_body)),
          // A parenthesized tag list is kept for input that already uses
          // it; Snowflake documents the bare list set_unset_tags covers.
          seq($.keyword_set, $.keyword_tag, paren_list($.tag_assignment, true)),
          seq($.keyword_unset, $.keyword_tag, paren_list($.object_reference, true)),
          ...set_unset_tags($),
          ...set_unset_properties($),
          seq($.keyword_rename, $.keyword_to, $.object_reference),
        ),
      ),
    ),

  alter_alert: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        $.keyword_alert,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        choice(
          $.keyword_resume,
          $.keyword_suspend,
          seq(
            $.keyword_modify,
            choice(
              seq($.keyword_condition, choice($.exists, wrapped_in_parenthesis($._expression))),
              seq($.keyword_action, field('action', $.statement)),
            ),
          ),
          ...set_unset_tags($),
          ...set_unset_properties($),
          seq($.keyword_rename, $.keyword_to, $.object_reference),
        ),
      ),
    ),
};
