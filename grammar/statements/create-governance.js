import { create_header, paren_list, wrapped_in_parenthesis } from '../helpers.js';

// Policies, alerts, secrets and network rules.
export default {
  // CREATE [OR REPLACE] {MASKING | ROW ACCESS | AGGREGATION | PROJECTION} POLICY [IF NOT EXISTS] name
  //   AS (args) RETURNS type -> expr [COMMENT = '...'] ...
  // CREATE [OR REPLACE] {NETWORK | PASSWORD | SESSION | AUTHENTICATION} POLICY [IF NOT EXISTS] name
  //   [options ...]
  create_policy: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_policy, {
          modifiers: [optional(field('policy_type', $._policy_kind))],
        }),
        choice(
          seq(
            repeat($.option),
            $.keyword_as,
            paren_list($.policy_parameter, false),
            $.keyword_returns,
            field('return_type', $._type),
            '->',
            field('body', $.policy_body),
            repeat($.option),
          ),
          repeat($.option),
        ),
      ),
    ),

  // CREATE [OR REPLACE] SECRET [IF NOT EXISTS] name TYPE = ... [options]
  create_secret: ($) => prec.right(seq(...create_header($, $.keyword_secret), repeat1($.option))),

  // CREATE [OR REPLACE] NETWORK RULE name TYPE = ... VALUE_LIST = (...) MODE = ...
  create_network_rule: ($) =>
    prec.right(seq(...create_header($, [$.keyword_network, $.keyword_rule]), repeat1($.option))),

  policy_parameter: ($) => seq(field('name', $.identifier), optional(field('type', $._type))),

  policy_body: ($) => $._expression,

  // CREATE [OR REPLACE] ALERT [IF NOT EXISTS] name
  //   [WAREHOUSE = ...] [SCHEDULE = ...] [COMMENT = ...]
  //   IF ( EXISTS ( query ) ) THEN statement
  create_alert: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_alert),
        repeat($.alert_option),
        $.keyword_if,
        wrapped_in_parenthesis($._expression),
        $.keyword_then,
        field('action', $.statement),
      ),
    ),

  alert_option: ($) =>
    choice(
      seq(
        $.keyword_warehouse,
        '=',
        field('warehouse', choice($.object_reference, alias($._single_quote_string, $.literal))),
      ),
      seq($.keyword_schedule, '=', alias($._single_quote_string, $.literal)),
      $.option,
    ),
};
