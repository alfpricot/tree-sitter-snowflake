//! What a SQL text contains, as plain data: its statement kinds, the blocks and
//! decision points [`STRUCTURE_QUERY`](tree_sitter_snowflake::STRUCTURE_QUERY)
//! captures, its routines, the objects it names, and its syntax errors. Handler
//! bodies in other languages are not read; use [`Analyzer`](crate::Analyzer) for
//! those.

mod names;

use crate::{Error, Language as RoutineLanguage, RoutineKind, descendants, error_ranges, extract};
use std::{ops::Range, sync::OnceLock};
use tree_sitter::{Language, Node, Parser, Query, QueryCursor, StreamingIterator};

/// Everything [`summary`] found. Every range is in bytes of the SQL text.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[non_exhaustive]
pub struct Summary {
    /// The top-level statements, in document order. A statement inside a syntax
    /// error that the parser could not recover is not listed.
    pub statements: Vec<Statement>,
    /// The definitions the structure query captures, such as procedures,
    /// functions, policies, and alerts, in document order.
    pub blocks: Vec<Block>,
    /// Every `CREATE PROCEDURE` and `CREATE FUNCTION`, SQL routines included,
    /// in document order.
    pub routines: Vec<Routine>,
    /// The Snowflake Scripting branches, loops, and exception handlers the
    /// structure query captures, in document order. SQL inside a single-quoted
    /// body is not parsed, so it contributes none.
    pub decisions: Vec<Decision>,
    /// The names the SQL creates or refers to, in document order.
    pub objects: Vec<ObjectName>,
    /// SQL syntax errors.
    pub errors: Vec<Range<usize>>,
}

/// One top-level statement.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[non_exhaustive]
pub struct Statement {
    /// The grammar's node kind, such as `create_table`. A statement without a
    /// node of its own, such as a `DROP`, is named by its leading keyword node.
    pub kind: String,
    /// The statement, without its terminator.
    pub range: Range<usize>,
}

/// One definition captured by the structure query.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[non_exhaustive]
pub struct Block {
    /// The grammar's node kind, such as `create_procedure`.
    pub kind: String,
    /// The defined name as written.
    pub name: String,
    /// The whole definition.
    pub range: Range<usize>,
    /// How many of [`Summary::decisions`] lie inside this definition.
    pub decisions: usize,
}

/// One procedure or function.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[non_exhaustive]
pub struct Routine {
    /// The routine name as written.
    pub name: String,
    /// Whether the routine is a procedure or a function.
    pub kind: RoutineKind,
    /// The foreign language the routine declares, or `None` for a SQL routine
    /// (and for one whose syntax errors hide the clause).
    pub language: Option<RoutineLanguage>,
    /// The whole statement, equal to
    /// [`Handler::routine_range`](crate::Handler::routine_range) for the
    /// handler the analyzer returns for it.
    pub range: Range<usize>,
}

/// One decision point.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[non_exhaustive]
pub struct Decision {
    /// The grammar's node kind, such as `if_statement`.
    pub kind: String,
    /// The whole construct.
    pub range: Range<usize>,
}

/// One name in the SQL.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[non_exhaustive]
pub struct ObjectName {
    /// The name as written, including any qualification and quotes.
    pub name: String,
    /// Where the name is written.
    pub range: Range<usize>,
    /// The node kind of the `CREATE` statement that defines this name, or
    /// `None` for a reference. References include the names of called functions.
    /// The qualifier of a column, such as the `t` in `t.a`, is not a reference,
    /// except before `NEXTVAL`, where it names a sequence. Neither is a name in
    /// `FROM` or `JOIN` that means a `WITH` clause's common table expression.
    pub created_by: Option<String>,
}

/// Summarizes `sql`.
///
/// # Errors
///
/// [`Error::Language`] or [`Error::Query`] when the grammar or the structure
/// query does not fit the linked tree-sitter, and [`Error::Canceled`] when the
/// parse returns no tree.
pub fn summary(sql: &str) -> Result<Summary, Error> {
    let language = tree_sitter_snowflake::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language).map_err(Error::Language)?;
    let query = structure_query(&language)?;
    let tree = parser.parse(sql, None).ok_or(Error::Canceled)?;
    let root = tree.root_node();
    let decisions = decisions(sql, root, query);
    Ok(Summary {
        statements: statements(root),
        blocks: blocks(sql, root, query, &decisions),
        routines: routines(sql, root),
        decisions,
        objects: objects(sql, root),
        errors: error_ranges(root),
    })
}

// Compiled once: the cost is paid against the whole grammar, not the input.
fn structure_query(language: &Language) -> Result<&'static Query, Error> {
    static QUERY: OnceLock<Query> = OnceLock::new();
    if let Some(query) = QUERY.get() {
        return Ok(query);
    }
    let query =
        Query::new(language, tree_sitter_snowflake::STRUCTURE_QUERY).map_err(Error::Query)?;
    Ok(QUERY.get_or_init(|| query))
}

fn statements(root: Node<'_>) -> Vec<Statement> {
    let mut cursor = root.walk();
    root.named_children(&mut cursor)
        .filter(|node| node.kind() == "statement")
        .filter_map(|node| {
            let mut cursor = node.walk();
            // A leading WITH clause sits directly under the statement, ahead
            // of the node that says what the statement does.
            let first = node.named_children(&mut cursor).find(|child| {
                !child.is_extra()
                    && !matches!(child.kind(), "keyword_with" | "keyword_recursive" | "cte")
            })?;
            Some(Statement {
                kind: first.kind().to_owned(),
                range: node.byte_range(),
            })
        })
        .collect()
}

fn routines(sql: &str, root: Node<'_>) -> Vec<Routine> {
    descendants(root)
        .filter_map(|node| {
            let kind = match node.kind() {
                "create_procedure" => RoutineKind::Procedure,
                "create_function" => RoutineKind::Function,
                _ => return None,
            };
            let name = node.child_by_field_name("name")?;
            Some(Routine {
                name: sql[name.byte_range()].to_owned(),
                kind,
                language: extract::foreign_language(node),
                range: node.byte_range(),
            })
        })
        .collect()
}

fn decisions(sql: &str, root: Node<'_>, query: &Query) -> Vec<Decision> {
    let Some(index) = query.capture_index_for_name("decision") else {
        return Vec::new();
    };
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, root, sql.as_bytes());
    let mut result = Vec::new();
    while let Some(matched) = matches.next() {
        for node in matched.nodes_for_capture_index(index) {
            result.push(Decision {
                kind: node.kind().to_owned(),
                range: node.byte_range(),
            });
        }
    }
    result.sort_by_key(|d| (d.range.start, d.range.end));
    result
}

fn blocks(sql: &str, root: Node<'_>, query: &Query, decisions: &[Decision]) -> Vec<Block> {
    let block = query.capture_index_for_name("definition.block");
    let name = query.capture_index_for_name("definition.name");
    let (Some(block_index), Some(name_index)) = (block, name) else {
        return Vec::new();
    };
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, root, sql.as_bytes());
    let mut result = Vec::new();
    while let Some(matched) = matches.next() {
        let block = matched.nodes_for_capture_index(block_index).next();
        let name = matched.nodes_for_capture_index(name_index).next();
        if let (Some(block), Some(name)) = (block, name) {
            result.push(Block {
                kind: block.kind().to_owned(),
                name: sql[name.byte_range()].to_owned(),
                range: block.byte_range(),
                decisions: {
                    let first = decisions.partition_point(|d| d.range.start < block.start_byte());
                    decisions[first..]
                        .iter()
                        .take_while(|d| d.range.start < block.end_byte())
                        .count()
                },
            });
        }
    }
    result.sort_by_key(|b| (b.range.start, b.range.end));
    // A definition with an optional capture can match more than once.
    result.dedup();
    result
}

// A created name is the `name` field of a `create_*` node, which is a plain
// identifier for some objects, such as roles and integrations. Every other
// object reference is a use of a name.
fn objects(sql: &str, root: Node<'_>) -> Vec<ObjectName> {
    let mut result = Vec::new();
    let mut created = Vec::new();
    for node in descendants(root) {
        if node.kind().starts_with("create_")
            && let Some(name) = node.child_by_field_name("name")
        {
            created.push(name.id());
            result.push(ObjectName {
                name: sql[name.byte_range()].to_owned(),
                range: name.byte_range(),
                created_by: Some(node.kind().to_owned()),
            });
        } else if node.kind() == "object_reference"
            && !created.contains(&node.id())
            && !names::is_column_qualifier(sql, node)
            && !names::is_cte_use(sql, node)
        {
            result.push(ObjectName {
                name: sql[node.byte_range()].to_owned(),
                range: node.byte_range(),
                created_by: None,
            });
        }
    }
    result.sort_by_key(|o| (o.range.start, o.range.end));
    result
}
