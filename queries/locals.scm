; Scopes
(block) @local.scope
(create_procedure) @local.scope
(create_function) @local.scope
(for_statement) @local.scope
(while_statement) @local.scope
(repeat_statement) @local.scope
(loop_statement) @local.scope

; Definitions
(variable_declaration
  name: (identifier) @local.definition)

(let_statement
  name: (identifier) @local.definition)

(cursor_declaration
  name: (identifier) @local.definition)

(resultset_declaration
  name: (identifier) @local.definition)

(exception_declaration
  name: (identifier) @local.definition)

(function_argument
  name: (identifier) @local.definition)

(for_statement
  variable: (identifier) @local.definition)

; References
(identifier) @local.reference
