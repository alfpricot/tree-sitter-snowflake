import {
  comma_list,
  create_header,
  stage_reference_or_quoted,
  typed_integration,
} from '../helpers.js';

// CREATE {REPLICATION | FAILOVER} GROUP [IF NOT EXISTS] name
//   {properties [IGNORE EDITION CHECK] | AS REPLICA OF org.account.name}
function create_group(kind) {
  return ($) =>
    prec.right(
      seq(
        ...create_header($, [kind($), $.keyword_group], { name: $.identifier }),
        choice(
          seq($.keyword_as, $.identifier, $.identifier, $.object_reference),
          repeat1(choice($.group_property, $._ignore_edition_check, $._with_tag)),
        ),
      ),
    );
}

// Account objects: warehouses, databases, schemas, roles, users, and
// integrations.
export default {
  // CREATE [OR REPLACE] WAREHOUSE [IF NOT EXISTS] name
  //   [WITH] [WAREHOUSE_SIZE = 'XSMALL' ... options]
  create_warehouse: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_warehouse),
        // The leading WITH introduces the properties; a WITH right before
        // TAG belongs to the tag clause instead.
        optional(seq($.keyword_with, $.option)),
        repeat(choice($._with_tag, $._with_contact, $.option)),
      ),
    ),

  // CREATE [OR REPLACE | TRANSIENT] DATABASE [IF NOT EXISTS] name
  //   [options]
  create_database: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_database, {
          modifiers: [optional($.keyword_transient)],
          // A database may be named `role`, which DATABASE ROLE would
          // otherwise swallow.
          name: choice($.object_reference, alias($._role_as_name, $.object_reference)),
        }),
        repeat(choice($._with_tag, $._with_contact, $.option)),
      ),
    ),

  // CREATE [OR REPLACE] [TRANSIENT] SCHEMA [IF NOT EXISTS] name
  //   [WITH MANAGED ACCESS] [options]
  create_schema: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_schema, { modifiers: [optional($.keyword_transient)] }),
        repeat(
          choice(
            $._with_tag,
            $._with_contact,
            seq($.keyword_with, $.keyword_managed, $.keyword_access),
            $.option,
          ),
        ),
      ),
    ),

  // CREATE [OR REPLACE] ROLE [IF NOT EXISTS] name [options]
  // The scripted role files carry a trailing COMMENT = '...' option.
  create_role: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_role, { name: $.identifier }),
        repeat(choice($._with_tag, $.option)),
      ),
    ),

  // CREATE [OR REPLACE] USER name [PASSWORD = ...] [options]
  create_user: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_user, { name: $.identifier }),
        repeat(choice($._with_tag, $.option)),
      ),
    ),

  // CREATE [OR REPLACE] {STORAGE | API | SECURITY | NOTIFICATION |
  //   EXTERNAL ACCESS} INTEGRATION [IF NOT EXISTS] name [options]
  create_integration: ($) =>
    prec.right(
      seq(...create_header($, typed_integration($), { name: $.identifier }), repeat1($.option)),
    ),

  // CREATE [OR REPLACE] DATABASE ROLE [IF NOT EXISTS] [db.]name
  //   [COMMENT = '...'] [[WITH] TAG (...)]
  // COMMENT is the only option, so that a database named `role` keeps its own
  // options: `DATABASE role CLONE prod` cannot be a role named CLONE.
  // The dynamic precedence reads `DATABASE ROLE r` as this rather than as a
  // database named `role` taking an option `r`.
  create_database_role: ($) =>
    prec.dynamic(
      1,
      prec.right(
        seq(
          ...create_header($, [$.keyword_database, $.keyword_role]),
          repeat(choice($._with_tag, alias($._comment_option, $.option))),
        ),
      ),
    ),

  _comment_option: ($) =>
    seq(field('name', alias($.keyword_comment, $.identifier)), '=', field('value', $.literal)),

  _ignore_edition_check: ($) => seq($.keyword_ignore, $.identifier, $.identifier),

  // org.account, as a share or a replication group lists accounts.
  account_identifier: ($) => seq($.identifier, optional(seq('.', $.identifier))),

  // CREATE [OR REPLACE] SHARE [IF NOT EXISTS] name [options]
  create_share: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_share, { name: $.identifier }),
        repeat(choice($._with_tag, $.option)),
      ),
    ),

  // CREATE [OR REPLACE] EXTERNAL VOLUME [IF NOT EXISTS] name
  //   STORAGE_LOCATIONS = ((...), ...) [options]
  create_external_volume: ($) =>
    prec.right(
      seq(
        ...create_header($, [$.keyword_external, $.keyword_volume], { name: $.identifier }),
        repeat1($.option),
      ),
    ),

  // CREATE [OR REPLACE] NOTEBOOK [IF NOT EXISTS] name [FROM 'location']
  //   [options]
  create_notebook: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_notebook),
        repeat(choice(seq($.keyword_from, stage_reference_or_quoted($)), $._with_tag, $.option)),
      ),
    ),

  create_replication_group: create_group(($) => $.keyword_replication),
  create_failover_group: create_group(($) => $.keyword_failover),

  // name = value [, value ...] — a property of a share or of a replication or
  // failover group, whose lists are not parenthesized. Two properties list
  // kinds of object and two list accounts, rather than objects.
  group_property: ($) =>
    prec.right(
      choice(
        seq(
          field(
            'name',
            choice(
              alias($.keyword_object_types, $.identifier),
              alias($.keyword_allowed_integration_types, $.identifier),
            ),
          ),
          '=',
          comma_list(field('value', alias($._replicated_kind, $.object_kind)), true),
        ),
        seq(
          field(
            'name',
            choice(
              alias($.keyword_accounts, $.identifier),
              alias($.keyword_allowed_accounts, $.identifier),
            ),
          ),
          '=',
          comma_list(field('value', $.account_identifier), true),
        ),
        seq(
          field('name', $.identifier),
          '=',
          comma_list(field('value', choice($.literal, $.object_reference)), true),
        ),
      ),
    ),

  // DATABASES, ROLES, ACCOUNT PARAMETERS, SECURITY INTEGRATIONS, ...
  _replicated_kind: ($) =>
    choice(
      $.identifier,
      $.keyword_roles,
      seq(
        choice(
          $.keyword_account,
          $.keyword_network,
          $.keyword_resource,
          $.keyword_security,
          $.keyword_api,
          $.keyword_storage,
          $.keyword_notification,
          seq($.keyword_external, $.keyword_access),
        ),
        $.identifier,
      ),
    ),
};
