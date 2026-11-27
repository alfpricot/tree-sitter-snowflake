//! Shared extraction, parsing, and advisory checks for Snowflake handler bodies.
//! Returned embedded trees use decoded-body byte offsets; translate them through
//! [`HandlerSource`] before reporting findings in the SQL file. This crate computes
//! no complexity totals. Consumers attribute their measurements to the SQL file.

#![doc = include_str!("../README.md")]

mod checks;
mod extract;
mod source;

pub use checks::{Finding, RULES, Rule, Severity};
pub use source::{HandlerSource, source_point};
pub use tree_sitter;

use std::{collections::HashMap, fmt, ops::Range};
use tree_sitter::{Parser, Query, Tree};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    JavaScript,
    Python,
    Java,
    Scala,
}

impl Language {
    pub fn grammar(self) -> Option<tree_sitter::Language> {
        match self {
            Self::JavaScript => Some(tree_sitter_javascript::LANGUAGE.into()),
            Self::Python => Some(tree_sitter_python::LANGUAGE.into()),
            Self::Java => {
                #[cfg(feature = "java")]
                {
                    Some(tree_sitter_java::LANGUAGE.into())
                }
                #[cfg(not(feature = "java"))]
                {
                    None
                }
            }
            Self::Scala => {
                #[cfg(feature = "scala")]
                {
                    Some(tree_sitter_scala::LANGUAGE.into())
                }
                #[cfg(not(feature = "scala"))]
                {
                    None
                }
            }
        }
    }

    /// Queries ship even when the corresponding optional parser is disabled.
    pub fn query(self) -> &'static str {
        match self {
            Self::JavaScript => include_str!("../queries/javascript.scm"),
            Self::Python => include_str!("../queries/python.scm"),
            Self::Java => include_str!("../queries/java.scm"),
            Self::Scala => include_str!("../queries/scala.scm"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutineKind {
    Procedure,
    Function,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionRights {
    Owner,
    Caller,
    Unknown,
    NotApplicable,
}

/// An unavailable/invalid body must never be interpreted as measured at zero.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum HandlerStatus {
    Parsed,
    UnavailableLanguage,
    InvalidSql,
    InvalidEncoding(String),
    InvalidBody,
}

#[derive(Debug)]
#[non_exhaustive]
pub struct Handler {
    pub name: String,
    pub routine_kind: RoutineKind,
    pub language: Language,
    pub rights: ExecutionRights,
    pub routine_range: Range<usize>,
    pub body_range: Range<usize>,
    pub source: Option<HandlerSource>,
    pub tree: Option<Tree>,
    pub status: HandlerStatus,
    /// Embedded syntax errors, translated into absolute SQL byte ranges.
    pub parse_errors: Vec<Range<usize>>,
    pub findings: Vec<Finding>,
}

#[derive(Debug)]
#[non_exhaustive]
pub struct Analysis {
    pub sql_tree: Tree,
    pub sql_errors: Vec<Range<usize>>,
    pub handlers: Vec<Handler>,
    /// Cross-statement checks, such as a Scala task without a warehouse.
    pub findings: Vec<Finding>,
}

#[derive(Debug)]
pub struct Error(String);
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}

/// Reuse an analyzer across files to retain compiled parsers and queries.
pub struct Analyzer {
    sql: Parser,
    embedded: HashMap<Language, (Parser, Query)>,
}

impl Analyzer {
    pub fn new() -> Result<Self, Error> {
        let mut sql = Parser::new();
        sql.set_language(&tree_sitter_snowflake::LANGUAGE.into())
            .map_err(|e| Error(e.to_string()))?;
        let mut embedded = HashMap::new();
        for language in [
            Language::JavaScript,
            Language::Python,
            Language::Java,
            Language::Scala,
        ] {
            if let Some(grammar) = language.grammar() {
                let mut parser = Parser::new();
                parser
                    .set_language(&grammar)
                    .map_err(|e| Error(e.to_string()))?;
                let query =
                    Query::new(&grammar, language.query()).map_err(|e| Error(e.to_string()))?;
                embedded.insert(language, (parser, query));
            }
        }
        Ok(Self { sql, embedded })
    }

    pub fn analyze(&mut self, sql: &str) -> Result<Analysis, Error> {
        let sql_tree = self
            .sql
            .parse(sql, None)
            .ok_or_else(|| Error("SQL parse cancelled".into()))?;
        let sql_errors = error_ranges(sql_tree.root_node());
        let statements = extract::Statements::collect(sql_tree.root_node());
        let mut handlers = extract::handlers(sql, &statements.routines);
        for body in &mut handlers {
            let Some(source) = &body.source else { continue };
            let Some((parser, query)) = self.embedded.get_mut(&body.language) else {
                body.status = HandlerStatus::UnavailableLanguage;
                continue;
            };
            let tree = parser
                .parse(source.text(), None)
                .ok_or_else(|| Error("Handler body parse cancelled".into()))?;
            body.parse_errors = error_ranges(tree.root_node())
                .into_iter()
                .filter_map(|range| source.source_range(range))
                .collect();
            body.status = if tree.root_node().has_error() {
                HandlerStatus::InvalidBody
            } else {
                HandlerStatus::Parsed
            };
            // Partial trees are exposed for inspection, but are not checked as if valid.
            if body.status == HandlerStatus::Parsed {
                body.findings = checks::check(body, &tree, query, &mut self.sql)?;
            }
            body.tree = Some(tree);
        }
        let findings = checks::tasks(sql, &statements, &handlers);
        Ok(Analysis {
            sql_tree,
            sql_errors,
            handlers,
            findings,
        })
    }
}

/// `root` and every named node below it, in document order, walked with one
/// cursor so a search can stop early without collecting the subtree.
pub(crate) fn descendants(
    root: tree_sitter::Node<'_>,
) -> impl Iterator<Item = tree_sitter::Node<'_>> {
    let mut cursor = root.walk();
    let mut next = Some(root);
    std::iter::from_fn(move || {
        let node = next?;
        // Only the root and named nodes are descended into and returned.
        let mut moved = (node == root || node.is_named()) && cursor.goto_first_child();
        while !moved {
            if cursor.goto_next_sibling() {
                moved = true;
            } else if !cursor.goto_parent() {
                break;
            }
        }
        next = moved.then(|| cursor.node());
        Some(node)
    })
    .filter(move |node| *node == root || node.is_named())
}

fn error_ranges(root: tree_sitter::Node<'_>) -> Vec<Range<usize>> {
    let mut errors = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.is_error() || node.is_missing() {
            errors.push(node.byte_range());
        } else {
            let mut cursor = node.walk();
            stack.extend(node.children(&mut cursor));
        }
    }
    errors.sort_by_key(|r| r.start);
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Node;

    fn collect<'tree>(node: Node<'tree>, out: &mut Vec<Node<'tree>>) {
        out.push(node);
        let mut cursor = node.walk();
        for child in node.named_children(&mut cursor) {
            collect(child, out);
        }
    }

    /// The cursor walk matches a recursive pre-order walk from any starting
    /// node, and never leaves that node's subtree for its siblings.
    #[test]
    fn descendants_walks_one_subtree_in_document_order() {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_snowflake::LANGUAGE.into())
            .unwrap();
        let sql = "CREATE TASK t WAREHOUSE = w AS CALL p(1, 'a'); SELECT (1 + 2) FROM x;";
        let tree = parser.parse(sql, None).unwrap();
        let mut all = Vec::new();
        collect(tree.root_node(), &mut all);
        assert!(all.len() > 20);
        for &start in &all {
            let mut expected = Vec::new();
            collect(start, &mut expected);
            assert_eq!(
                descendants(start).collect::<Vec<_>>(),
                expected,
                "{}",
                start.kind()
            );
        }
    }
}
