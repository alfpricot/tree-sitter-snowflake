; Foldable regions. tree-sitter.json has no key for fold queries, so editors
; load this file directly or through the bindings.

; Snowflake Scripting blocks and control flow.
[
  (block)
  (declare_statement)
  (exception_section)
  (if_statement)
  (case_statement)
  (for_statement)
  (while_statement)
  (repeat_statement)
  (loop_statement)
] @fold

; Common table expressions and parenthesized subqueries.
[
  (cte)
  (subquery)
] @fold

; $$ ... $$ bodies.
[
  (dollar_quoted_script)
  (dollar_quoted_expression)
  (dollar_quoted_body)
] @fold
