import { create_header, typed_integration } from '../helpers.js';

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
        ...create_header($, $.keyword_database, { modifiers: [optional($.keyword_transient)] }),
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
};
