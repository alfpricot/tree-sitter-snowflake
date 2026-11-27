"""Tree-sitter grammar for Snowflake SQL"""

from importlib.resources import files

from ._binding import language

_QUERIES = {
    "HIGHLIGHTS_QUERY": "highlights.scm",
    "INJECTIONS_QUERY": "injections.scm",
    "LOCALS_QUERY": "locals.scm",
    "STRUCTURE_QUERY": "structure.scm",
    "TAGS_QUERY": "tags.scm",
    "FOLDS_QUERY": "folds.scm",
    "INDENTS_QUERY": "indents.scm",
}


def __getattr__(name):
    if name not in _QUERIES:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    try:
        query = (files(__package__) / "queries" / _QUERIES[name]).read_text(encoding="utf-8")
    except FileNotFoundError:
        query = None
    globals()[name] = query
    return query


__all__ = ["language", *_QUERIES]


def __dir__():
    return sorted({*globals(), *__all__})
