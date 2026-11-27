//! What a SQL text contains, as plain data: its statement kinds, the blocks
//! [`STRUCTURE_QUERY`](tree_sitter_snowflake::STRUCTURE_QUERY) captures, the
//! objects it names, and its syntax errors. Handler bodies in other languages
//! are not read; use [`Analyzer`](crate::Analyzer) for those.

use crate::{Error, descendants, error_ranges};
use std::ops::Range;
use tree_sitter::{Node, Parser, Query, QueryCursor, StreamingIterator};

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
    let query =
        Query::new(&language, tree_sitter_snowflake::STRUCTURE_QUERY).map_err(Error::Query)?;
    let tree = parser.parse(sql, None).ok_or(Error::Canceled)?;
    let root = tree.root_node();
    Ok(Summary {
        statements: statements(root),
        blocks: blocks(sql, root, &query),
        objects: objects(sql, root),
        errors: error_ranges(root),
    })
}

fn statements(root: Node<'_>) -> Vec<Statement> {
    let mut cursor = root.walk();
    root.named_children(&mut cursor)
        .filter(|node| node.kind() == "statement")
        .filter_map(|node| {
            let mut cursor = node.walk();
            let first = node
                .named_children(&mut cursor)
                .find(|child| !child.is_extra())?;
            Some(Statement {
                kind: first.kind().to_owned(),
                range: node.byte_range(),
            })
        })
        .collect()
}

fn blocks(sql: &str, root: Node<'_>, query: &Query) -> Vec<Block> {
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
        } else if node.kind() == "object_reference" && !created.contains(&node.id()) {
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
