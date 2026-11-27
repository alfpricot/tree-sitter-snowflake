//! Shared extraction, parsing, and advisory checks for Snowflake handler bodies.
//! Returned embedded trees use decoded-body byte offsets; translate them through
//! [`HandlerSource`] before reporting findings in the SQL file. This crate computes
//! no complexity totals. Consumers attribute their measurements to the SQL file.

#![doc = include_str!("../README.md")]

mod checks;
mod extract;
mod source;
#[cfg(feature = "summary")]
pub mod summary;

pub use checks::{Finding, RULES, Rule, Severity};
pub use source::{EncodingError, HandlerSource, source_point};
pub use tree_sitter;

use std::{
    collections::HashMap,
    fmt,
    ops::{ControlFlow, Range},
    time::{Duration, Instant},
};
use tree_sitter::{LanguageError, ParseOptions, ParseState, Parser, Query, QueryError, Tree};

/// The identifiers a [`Finding`] can carry, one per [`RULES`] entry.
pub mod rules {
    pub use crate::checks::{
        CONCURRENCY, JDBC_CONNECTION, JS_EVAL, JS_HOST_API, JS_IMPORT, LOCAL_WRITE_PATH,
        OWNER_TEMP_OBJECT, PYTHON_GET_PATTERN, PYTHON_PROCESS, PYTHON_PUT_GET,
        SCALA_TASK_WAREHOUSE, SESSION_BUILDER,
    };
}

/// The language of an embedded handler body.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Language {
    /// `LANGUAGE JAVASCRIPT`.
    JavaScript,
    /// `LANGUAGE PYTHON`.
    Python,
    /// `LANGUAGE JAVA`.
    Java,
    /// `LANGUAGE SCALA`.
    Scala,
}

impl Language {
    /// The parser for this language, or `None` when its Cargo feature is off.
    #[must_use]
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

    /// The restriction query for this language. Queries ship even when the
    /// corresponding optional parser is disabled.
    #[must_use]
    pub fn query(self) -> &'static str {
        match self {
            Self::JavaScript => include_str!("../queries/javascript.scm"),
            Self::Python => include_str!("../queries/python.scm"),
            Self::Java => include_str!("../queries/java.scm"),
            Self::Scala => include_str!("../queries/scala.scm"),
        }
    }
}

/// Which statement declared a handler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RoutineKind {
    /// `CREATE PROCEDURE`.
    Procedure,
    /// `CREATE FUNCTION`.
    Function,
}

/// The rights a procedure runs with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ExecutionRights {
    /// `EXECUTE AS OWNER`, or no clause, which is the same.
    Owner,
    /// `EXECUTE AS CALLER`.
    Caller,
    /// An `EXECUTE AS` clause naming neither the owner nor the caller.
    Unknown,
    /// Functions have no execution rights clause.
    NotApplicable,
}

/// An unavailable/invalid body must never be interpreted as measured at zero.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum HandlerStatus {
    /// The body decoded and parsed without syntax errors, and was checked.
    Parsed,
    /// The body decoded, but this build has no parser for its language.
    UnavailableLanguage,
    /// The routine has SQL syntax errors, so its body was not decoded. A routine
    /// with syntax errors and no readable body is skipped instead.
    InvalidSql,
    /// The routine has no inline body, as when its handler is staged, so there
    /// is nothing to parse or check.
    Staged,
    /// Analysis of this body stopped early. Other handlers are unaffected. A body
    /// that parsed before a check stopped keeps its tree.
    AnalysisFailed(AnalysisFailure),
    /// A single-quoted body holds an escape or apostrophe that cannot be decoded.
    InvalidEncoding(EncodingError),
    /// The decoded body has syntax errors in its own language.
    InvalidBody,
}

/// Why one handler's analysis stopped early.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AnalysisFailure {
    /// The body is longer than [`Limits::max_body_bytes`], so it was not decoded.
    BodyTooLarge,
    /// A parse of the body, or of SQL text inside it, ran past
    /// [`Limits::parse_timeout`].
    TimedOut,
    /// A restriction query found more matches than the query cursor can hold.
    MatchLimitExceeded,
}

/// Bounds on the work [`Analyzer::analyze`] spends, set with
/// [`Analyzer::with_limits`]. Both default to `None`, which means no bound.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct Limits {
    /// The longest handler body that is analyzed, in SQL bytes between its
    /// delimiters. A longer one reports [`AnalysisFailure::BodyTooLarge`].
    pub max_body_bytes: Option<usize>,
    /// How long any one parse may run. A handler whose parse runs longer reports
    /// [`AnalysisFailure::TimedOut`]; the parse of the SQL text itself fails the
    /// call with [`Error::Canceled`].
    pub parse_timeout: Option<Duration>,
}

impl Limits {
    /// Sets [`Limits::max_body_bytes`].
    #[must_use]
    pub fn with_max_body_bytes(mut self, bytes: usize) -> Self {
        self.max_body_bytes = Some(bytes);
        self
    }

    /// Sets [`Limits::parse_timeout`].
    #[must_use]
    pub fn with_parse_timeout(mut self, timeout: Duration) -> Self {
        self.parse_timeout = Some(timeout);
        self
    }
}

/// One foreign-language procedure or function found in the SQL.
#[derive(Debug)]
#[non_exhaustive]
pub struct Handler {
    /// The routine name as written, including any qualification and quotes.
    pub name: String,
    /// Whether the routine is a procedure or a function.
    pub routine_kind: RoutineKind,
    /// The language the routine declares.
    pub language: Language,
    /// The rights the routine runs with.
    pub rights: ExecutionRights,
    /// The whole statement, as a byte range in the SQL.
    pub routine_range: Range<usize>,
    /// The `HANDLER` option, the entry point inside the body or staged file.
    pub handler: Option<String>,
    /// The `RUNTIME_VERSION` option, without its quotes.
    pub runtime_version: Option<String>,
    /// The body including its delimiters, as a byte range in the SQL. A staged
    /// handler has an empty range at the end of its statement.
    pub body_range: Range<usize>,
    /// The decoded body, when it could be reconstructed.
    pub source: Option<HandlerSource>,
    /// The body parsed in its language, with offsets into the decoded text.
    pub tree: Option<Tree>,
    /// How far analysis of this body got.
    pub status: HandlerStatus,
    /// Embedded syntax errors, translated into absolute SQL byte ranges.
    pub parse_errors: Vec<Range<usize>>,
    /// Restriction checks that matched in this body.
    pub findings: Vec<Finding>,
}

/// Everything [`Analyzer::analyze`] learned about one SQL text.
#[derive(Debug)]
#[non_exhaustive]
pub struct Analysis {
    /// The Snowflake SQL tree.
    pub sql_tree: Tree,
    /// SQL syntax errors, as byte ranges in the SQL.
    pub sql_errors: Vec<Range<usize>>,
    /// The foreign-language handlers, in document order.
    pub handlers: Vec<Handler>,
    /// Cross-statement checks, such as a Scala task without a warehouse.
    pub findings: Vec<Finding>,
}

/// Why [`Analyzer::new`] or [`Analyzer::analyze`] failed.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// The linked tree-sitter cannot load one of the grammars.
    Language(LanguageError),
    /// A restriction query does not compile against its grammar.
    Query(QueryError),
    /// The SQL text's parse returned no tree.
    Canceled,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Language(_) => f.write_str("Could not load a grammar"),
            Self::Query(_) => f.write_str("Could not compile a restriction query"),
            Self::Canceled => f.write_str("Parse canceled"),
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Language(error) => Some(error),
            Self::Query(error) => Some(error),
            Self::Canceled => None,
        }
    }
}

/// Reuse an analyzer across files to retain compiled parsers and queries.
pub struct Analyzer {
    sql: Parser,
    embedded: HashMap<Language, (Parser, Query)>,
    limits: Limits,
}

impl Analyzer {
    /// Loads the SQL grammar, and the parser and query of every language this
    /// build includes.
    ///
    /// # Errors
    ///
    /// [`Error::Language`] or [`Error::Query`] when a grammar or its query
    /// does not fit the linked tree-sitter.
    pub fn new() -> Result<Self, Error> {
        let mut sql = Parser::new();
        sql.set_language(&tree_sitter_snowflake::LANGUAGE.into())
            .map_err(Error::Language)?;
        let mut embedded = HashMap::new();
        for language in [
            Language::JavaScript,
            Language::Python,
            Language::Java,
            Language::Scala,
        ] {
            if let Some(grammar) = language.grammar() {
                let mut parser = Parser::new();
                parser.set_language(&grammar).map_err(Error::Language)?;
                let query = Query::new(&grammar, language.query()).map_err(Error::Query)?;
                embedded.insert(language, (parser, query));
            }
        }
        Ok(Self {
            sql,
            embedded,
            limits: Limits::default(),
        })
    }

    /// Bounds the work each later [`Analyzer::analyze`] call may spend.
    #[must_use]
    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    /// Extracts, parses, and checks every foreign-language handler in `sql`.
    /// A handler that cannot be analyzed reports why in its
    /// [`HandlerStatus`], without affecting the others.
    ///
    /// # Errors
    ///
    /// [`Error::Canceled`] when the parse of `sql` itself returns no tree.
    pub fn analyze(&mut self, sql: &str) -> Result<Analysis, Error> {
        let timeout = self.limits.parse_timeout;
        let sql_tree = parse(&mut self.sql, sql, timeout).ok_or(Error::Canceled)?;
        let sql_errors = error_ranges(sql_tree.root_node());
        let statements = extract::Statements::collect(sql_tree.root_node());
        let mut handlers = extract::handlers(sql, &statements.routines, self.limits);
        for body in &mut handlers {
            let Some(source) = &body.source else { continue };
            let Some((parser, query)) = self.embedded.get_mut(&body.language) else {
                body.status = HandlerStatus::UnavailableLanguage;
                continue;
            };
            let Some(tree) = parse(parser, source.text(), timeout) else {
                body.status = HandlerStatus::AnalysisFailed(AnalysisFailure::TimedOut);
                continue;
            };
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
                match checks::check(body, &tree, query, &mut self.sql, timeout) {
                    Ok(findings) => body.findings = findings,
                    Err(failure) => body.status = HandlerStatus::AnalysisFailed(failure),
                }
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

/// Parses `text`, giving up after `timeout`. Returns `None` when no tree was
/// produced.
pub(crate) fn parse(parser: &mut Parser, text: &str, timeout: Option<Duration>) -> Option<Tree> {
    let Some(timeout) = timeout else {
        return parser.parse(text, None);
    };
    let started = Instant::now();
    let mut progress = |_: &ParseState| {
        if started.elapsed() >= timeout {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    };
    let bytes = text.as_bytes();
    let tree = parser.parse_with_options(
        &mut |offset, _| bytes.get(offset..).unwrap_or_default(),
        None,
        Some(ParseOptions::new().progress_callback(&mut progress)),
    );
    if tree.is_none() {
        // A canceled parser would otherwise resume this parse on its next input.
        parser.reset();
    }
    tree
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
