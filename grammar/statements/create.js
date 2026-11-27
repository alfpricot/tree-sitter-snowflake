import { comma_list, create_header, paren_list, wrapped_in_parenthesis } from '../helpers.js';

// Snowflake DDL: CREATE [OR REPLACE] across Snowflake's object families. This
// module holds the statement list, the clauses the families share, and the
// objects without a family module of their own. Option floods (warehouse
// parameters, task parameters, file-format options, copy options, stage
// properties, table properties) are the generic `option` shape,
// `identifier [= value]`, because option names are never keywords.
export default {
  _create_statement: ($) =>
    choice(
      $.create_table,
      $.create_view,
      $.create_materialized_view,
      $.create_dynamic_table,
      $.create_stage,
      $.create_file_format,
      $.create_stream,
      $.create_pipe,
      $.create_warehouse,
      $.create_database,
      $.create_schema,
      $.create_role,
      $.create_user,
      $.create_sequence,
      $.create_tag,
      $.create_integration,
      $.create_agent,
      $.create_streamlit,
      $.create_cortex_search,
      $.create_policy,
      $.create_alert,
      $.create_secret,
      $.create_network_rule,
      $.create_database_role,
      $.create_share,
      $.create_external_volume,
      $.create_notebook,
      $.create_replication_group,
      $.create_failover_group,
    ),

  // CREATE [OR REPLACE] CORTEX SEARCH SERVICE name ON column
  //   [options] AS '..' — the vector-index DDL, whose body is a single
  // quoted query string.
  create_cortex_search: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_cortex,
        $.keyword_search,
        $.keyword_service,
        field('name', $.object_reference),
        $.keyword_on,
        field('column', alias($._qualified_field, $.field)),
        repeat($.option),
        $.keyword_as,
        choice(wrapped_in_parenthesis($._dml_read), $.string_body),
      ),
    ),

  // CREATE [OR REPLACE] STREAMLIT name ROOT_LOCATION = '..' MAIN_FILE = '..'
  // [QUERY_WAREHOUSE = '..' ... options]
  // The name is an ordinary object reference, or the versioned spelling
  // a warehouse dump scripts (`db.schema.root/versions/live`, whose final
  // segment may carry a stray trailing quote from the dump).
  create_streamlit: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_streamlit,
        field('name', choice(alias($._streamlit_versioned_name, $.identifier), $.object_reference)),
        repeat1($.option),
      ),
    ),

  _streamlit_versioned_name: (_) => /[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*(\/[A-Za-z0-9_.']+)+/,

  // CREATE [OR REPLACE] AGENT name profile = '..' FROM SPECIFICATION $yaml$
  // — a Cortex Agent. The specification body is YAML, so it is the opaque
  // dollar-quoted string, not a SQL script.
  create_agent: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_agent,
        field('name', $.object_reference),
        repeat($.option),
        $.keyword_from,
        $.keyword_specification,
        alias($._dollar_quoted_string, $.literal),
      ),
    ),

  _or_replace: ($) => seq($.keyword_or, $.keyword_replace),

  // [WITH] TAG (tag = 'value', ...) — object tags at creation. WITH is
  // optional, as Snowflake documents it.
  _with_tag: ($) =>
    seq(optional($.keyword_with), $.keyword_tag, paren_list($.tag_assignment, true)),

  // [WITH] ROW ACCESS POLICY p ON (col, ...) and
  // [WITH] AGGREGATION POLICY p [ENTITY KEY (col, ...)] — the policies a
  // table or view attaches at creation.
  _with_policy: ($) =>
    seq(
      optional($.keyword_with),
      choice(
        seq(
          $.keyword_row,
          $.keyword_access,
          $.keyword_policy,
          $.object_reference,
          $.keyword_on,
          paren_list($.identifier, true),
        ),
        seq(
          $.keyword_aggregation,
          $.keyword_policy,
          $.object_reference,
          optional(seq($.keyword_entity, $.keyword_key, paren_list($.identifier, true))),
        ),
      ),
    ),

  // [WITH] MASKING POLICY p [USING (col, ...)] and
  // [WITH] PROJECTION POLICY p — the policies a single column carries.
  _with_column_policy: ($) =>
    seq(
      optional($.keyword_with),
      choice(
        seq(
          $.keyword_masking,
          $.keyword_policy,
          $.object_reference,
          optional(seq($.keyword_using, paren_list($.identifier, true))),
        ),
        seq($.keyword_projection, $.keyword_policy, $.object_reference),
      ),
    ),

  // WITH CONTACT (purpose = contact, ...) — the contacts a database,
  // schema, or warehouse names for support or approval requests.
  _with_contact: ($) => seq($.keyword_with, $.keyword_contact, $._paren_options),

  // CREATE [OR REPLACE] SEQUENCE [IF NOT EXISTS] name
  //   [WITH] [START [WITH] n] [INCREMENT [BY] n] [options]
  create_sequence: ($) =>
    prec.right(
      seq(...create_header($, $.keyword_sequence), optional($.keyword_with), repeat($.option)),
    ),

  // CREATE [OR REPLACE] TAG [IF NOT EXISTS] name
  //   [ALLOWED_VALUES 'a', 'b'] [COMMENT = '']
  // The name is a full object reference: tags are schema objects and may
  // be qualified.
  create_tag: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_tag),
        optional(seq($.identifier, comma_list(alias($._single_quote_string, $.literal), true))),
        repeat($.option),
      ),
    ),
};
