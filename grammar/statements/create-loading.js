import { create_header } from '../helpers.js';

// The objects that load data: stages, file formats, streams, and pipes.
export default {
  // CREATE [OR REPLACE] [TEMPORARY] STAGE name
  //   [URL = ''] [STORAGE_INTEGRATION = x] [CREDENTIALS = (...)]
  //   [ENCRYPTION = (...)] [FILE_FORMAT = (...)] [COPY_OPTIONS = (...)]
  //   [COMMENT = '']
  create_stage: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_stage, { modifiers: [optional($.keyword_temporary)] }),
        // WITH may also introduce an option: WITH DIRECTORY = (...).
        repeat(choice($._with_tag, seq($.keyword_with, $.option), $.option)),
      ),
    ),

  // CREATE [OR REPLACE] FILE FORMAT name TYPE = csv [options ...]
  create_file_format: ($) =>
    prec.right(seq(...create_header($, [$.keyword_file, $.keyword_format]), repeat1($.option))),

  // CREATE [OR REPLACE] [TEMPORARY] STREAM name [[WITH] TAG (...)]
  //   [COPY GRANTS]
  //   { ON { [EXTERNAL | EVENT | DYNAMIC] TABLE | VIEW | STAGE } source
  //       [{AT | BEFORE} (...)] [APPEND_ONLY = ...] [INSERT_ONLY = ...]
  //       [SHOW_INITIAL_ROWS = ...] [COMMENT = '']
  //   | CLONE source_stream [COPY GRANTS] }
  create_stream: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_stream, { modifiers: [optional($.keyword_temporary)] }),
        optional($._with_tag),
        optional(seq($.keyword_copy, $.keyword_grants)),
        choice(
          seq(
            $.keyword_on,
            choice(
              seq(
                optional(choice($.keyword_external, $.keyword_event, $.keyword_dynamic)),
                $.keyword_table,
              ),
              $.keyword_view,
              $.keyword_stage,
            ),
            field('source', $.object_reference),
            optional($.time_travel),
          ),
          seq(
            $.keyword_clone,
            field('clone', $.object_reference),
            optional(seq($.keyword_copy, $.keyword_grants)),
          ),
        ),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] PIPE name [AUTO_INGEST = ...]
  //   [ERROR_INTEGRATION = ...] [COMMENT = ''] AS COPY INTO ...
  create_pipe: ($) =>
    prec.right(
      seq(
        ...create_header($, $.keyword_pipe),
        repeat($.option),
        $.keyword_as,
        $.copy_into_statement,
      ),
    ),
};
