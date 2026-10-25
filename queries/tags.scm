; Definitions
(create_table
  name: (object_reference name: (identifier) @name)) @definition.table

(create_view
  name: (object_reference name: (identifier) @name)) @definition.table

(create_materialized_view
  name: (object_reference name: (identifier) @name)) @definition.table

(create_dynamic_table
  name: (object_reference name: (identifier) @name)) @definition.table

(create_procedure
  name: (object_reference name: (identifier) @name)) @definition.function

(create_function
  name: (object_reference name: (identifier) @name)) @definition.function

(create_task
  name: (object_reference name: (identifier) @name)) @definition.task

(create_alert
  name: (object_reference name: (identifier) @name)) @definition.alert

(create_policy
  name: (object_reference name: (identifier) @name)) @definition.interface

; References
(invocation
  (object_reference name: (identifier) @name)) @reference.call
