from pathlib import Path

import pytest
from tree_sitter import Language, Parser, Query

import tree_sitter_snowflake

ROOT = Path(__file__).resolve().parents[3]
LANGUAGE = Language(tree_sitter_snowflake.language())


def test_parses_a_fixture():
    source = (ROOT / "test" / "fixtures" / "external_access.sql").read_bytes()
    tree = Parser(LANGUAGE).parse(source)
    assert tree.root_node.type == "program"
    assert not tree.root_node.has_error


@pytest.mark.parametrize("name", [n for n in tree_sitter_snowflake.__all__ if n.endswith("_QUERY")])
def test_every_exported_query_compiles(name):
    Query(LANGUAGE, getattr(tree_sitter_snowflake, name))


def test_every_query_file_is_exported():
    exported = {n for n in tree_sitter_snowflake.__all__ if n.endswith("_QUERY")}
    shipped = {f"{p.stem.upper()}_QUERY" for p in (ROOT / "queries").glob("*.scm")}
    assert exported == shipped
