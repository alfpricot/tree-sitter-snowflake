// Package tree_sitter_snowflake provides the Snowflake SQL grammar for
// tree-sitter.
package tree_sitter_snowflake

// #cgo CFLAGS: -std=c11 -fPIC
// #include "../../src/parser.c"
// #include "../../src/scanner.c"
import "C"

import "unsafe"

// Language returns the tree-sitter language for this grammar.
func Language() unsafe.Pointer {
	return unsafe.Pointer(C.tree_sitter_snowflake())
}
