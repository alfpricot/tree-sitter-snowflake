; Foreign-language procedure and function bodies.
;
; Each supported language gets its own branch, naming the lowercase
; tree-sitter grammar name explicitly rather than deriving it from the
; captured keyword (Snowflake spells it JAVASCRIPT; tree-sitter resolves
; grammars as `javascript`). A host that has not linked a grammar simply
; does not inject — the tree shape never depends on what the host has.
;
; A dollar-quoted body is verbatim source, and the capture is its
; `body_content` child rather than the whole `dollar_quoted_body`, so the
; injected parse starts after the opening `$$` and stops before the
; closing one.
;
; A single-quoted body (the common form) is not the embedded language's
; source, so its injection is approximate and only for highlighting
; JavaScript and Python. The `body_content` and `escape` nodes are combined
; into one injected document: escapes appear undecoded, each `''` is left
; out, and with `injection.combined` every single-quoted body of one
; language in a file shares that document. To analyze such a body, decode it
; first and keep a position-mapping table, as the snowflake-handlers crate
; does. See docs/CONSUMER_INTEGRATION.md.
;
; The wildcard parent matches every routine node that carries a foreign
; `language` and an inline body: `create_procedure` and `create_function`
; (CREATE OR REPLACE and CREATE OR ALTER included). ALTER PROCEDURE and
; ALTER FUNCTION never carry a body.

((_
   (foreign_language (keyword_javascript))
   body: (function_body (dollar_quoted_body (body_content) @injection.content)))
 (#set! injection.language "javascript"))

((_
   (foreign_language (keyword_python))
   body: (function_body (dollar_quoted_body (body_content) @injection.content)))
 (#set! injection.language "python"))

((_
   (foreign_language (keyword_java))
   body: (function_body (dollar_quoted_body (body_content) @injection.content)))
 (#set! injection.language "java"))

((_
   (foreign_language (keyword_scala))
   body: (function_body (dollar_quoted_body (body_content) @injection.content)))
 (#set! injection.language "scala"))

((_
   (foreign_language (keyword_javascript))
   body: (function_body (string_body [(body_content) (escape)] @injection.content)))
 (#set! injection.language "javascript")
 (#set! injection.combined))

((_
   (foreign_language (keyword_python))
   body: (function_body (string_body [(body_content) (escape)] @injection.content)))
 (#set! injection.language "python")
 (#set! injection.combined))
