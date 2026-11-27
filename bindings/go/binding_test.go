package tree_sitter_snowflake_test

import (
	"os"
	"testing"

	tree_sitter_snowflake "github.com/alfpricot/tree-sitter-snowflake/bindings/go"
	tree_sitter "github.com/tree-sitter/go-tree-sitter"
)

// The fixture holds a dollar-quoted body, so the external scanner is exercised
// along with the parser.
func TestParsesAFixtureWithoutErrors(t *testing.T) {
	source, err := os.ReadFile("../../test/fixtures/external_access.sql")
	if err != nil {
		t.Fatal(err)
	}
	parser := tree_sitter.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(tree_sitter.NewLanguage(tree_sitter_snowflake.Language())); err != nil {
		t.Fatal(err)
	}
	tree := parser.Parse(source, nil)
	defer tree.Close()
	if tree.RootNode().HasError() {
		t.Error("the fixture parsed with errors")
	}
}
