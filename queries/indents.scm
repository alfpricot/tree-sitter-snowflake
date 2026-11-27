; Indentation, using the capture names nvim-treesitter reads:
; @indent.begin indents the lines after a node's first line, @indent.branch
; outdents the line that starts with the node, and @indent.end closes it.

[
  (block)
  (declare_statement)
  (exception_handler)
  (if_statement)
  (case_statement)
  (case_when_clause)
  (for_statement)
  (while_statement)
  (repeat_statement)
  (loop_statement)
  (cte)
  (subquery)
  (column_definitions)
] @indent.begin

(exception_section) @indent.branch
(elseif_clause) @indent.branch
(if_statement (else_clause) @indent.branch)

; In CASE, ELSE lines up with WHEN and indents its own statements.
(case_statement (else_clause) @indent.begin)

(block (keyword_end) @indent.branch @indent.end)
(if_statement (keyword_end) @indent.branch @indent.end)
(case_statement (keyword_end) @indent.branch @indent.end)
(for_statement (keyword_end) @indent.branch @indent.end)
(while_statement (keyword_end) @indent.branch @indent.end)
(repeat_statement (keyword_until) @indent.branch)
(repeat_statement (keyword_end) @indent.branch @indent.end)
(loop_statement (keyword_end) @indent.branch @indent.end)

[
  (cte ")" @indent.branch @indent.end)
  (subquery ")" @indent.branch @indent.end)
  (column_definitions ")" @indent.branch @indent.end)
]
