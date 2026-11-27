use crate::{
    AnalysisFailure, ExecutionRights, Handler, HandlerSource, HandlerStatus, Language, Limits,
    RoutineKind, descendants,
};
use tree_sitter::Node;

/// The statements the analyzer reads, gathered in one pass over the SQL tree.
pub(crate) struct Statements<'tree> {
    /// Every `CREATE PROCEDURE` and `CREATE FUNCTION`.
    pub routines: Vec<Node<'tree>>,
    /// Every `CREATE TASK`.
    pub tasks: Vec<Node<'tree>>,
}

impl<'tree> Statements<'tree> {
    pub fn collect(root: Node<'tree>) -> Self {
        let mut statements = Self {
            routines: Vec::new(),
            tasks: Vec::new(),
        };
        for node in descendants(root) {
            match node.kind() {
                "create_procedure" | "create_function" => statements.routines.push(node),
                "create_task" => statements.tasks.push(node),
                _ => {}
            }
        }
        statements
    }
}

pub(crate) fn handlers(sql: &str, routines: &[Node<'_>], limits: Limits) -> Vec<Handler> {
    let mut result = Vec::new();
    for &routine in routines {
        let kind = match routine.kind() {
            "create_procedure" => RoutineKind::Procedure,
            "create_function" => RoutineKind::Function,
            _ => continue,
        };
        let Some(language_node) = routine.child_by_field_name("language") else {
            continue;
        };
        let language = descendants(language_node).find_map(|node| match node.kind() {
            "keyword_javascript" => Some(Language::JavaScript),
            "keyword_python" => Some(Language::Python),
            "keyword_java" => Some(Language::Java),
            "keyword_scala" => Some(Language::Scala),
            _ => None,
        });
        let Some(language) = language else { continue };
        let wrapper = routine.child_by_field_name("body");
        // Without a body, only a routine that parsed cleanly is known to be
        // staged; a syntax error may be what hid the body.
        if wrapper.is_none() && routine.has_error() {
            continue;
        }
        let form = wrapper.and_then(|wrapper| {
            descendants(wrapper).find(|n| matches!(n.kind(), "string_body" | "dollar_quoted_body"))
        });
        let body_start = wrapper.map_or(routine.end_byte(), |n| n.start_byte());
        let mut rights = if kind == RoutineKind::Procedure {
            ExecutionRights::Owner
        } else {
            ExecutionRights::NotApplicable
        };
        if kind == RoutineKind::Procedure {
            for node in descendants(routine)
                .filter(|n| n.kind() == "execute_as_clause" && n.end_byte() <= body_start)
            {
                let mut owner = false;
                let caller = descendants(node).any(|n| {
                    owner |= n.kind() == "keyword_owner";
                    n.kind() == "keyword_caller"
                });
                rights = if caller {
                    ExecutionRights::Caller
                } else if owner {
                    ExecutionRights::Owner
                } else {
                    ExecutionRights::Unknown
                };
            }
        }
        let mut body = Handler {
            name: routine
                .child_by_field_name("name")
                .map(|n| sql[n.byte_range()].to_owned())
                .unwrap_or_default(),
            routine_kind: kind,
            language,
            rights,
            routine_range: routine.byte_range(),
            handler: option_value(sql, routine, "HANDLER"),
            runtime_version: option_value(sql, routine, "RUNTIME_VERSION"),
            body_range: wrapper.map_or(body_start..body_start, |n| n.byte_range()),
            source: None,
            tree: None,
            status: if wrapper.is_none() {
                HandlerStatus::Staged
            } else {
                HandlerStatus::InvalidSql
            },
            parse_errors: Vec::new(),
            findings: Vec::new(),
        };
        if !routine.has_error()
            && let Some(form) = form
        {
            let delimiters = if form.kind() == "string_body" { 1 } else { 2 };
            let range = form.start_byte() + delimiters..form.end_byte() - delimiters;
            if limits.max_body_bytes.is_some_and(|max| range.len() > max) {
                body.status = HandlerStatus::AnalysisFailed(AnalysisFailure::BodyTooLarge);
            } else {
                let decoded = if delimiters == 1 {
                    HandlerSource::quoted(&sql[range.clone()], range.start)
                } else {
                    Ok(HandlerSource::verbatim(&sql[range.clone()], range.start))
                };
                match decoded {
                    Ok(source) => {
                        body.source = Some(source);
                        body.status = HandlerStatus::UnavailableLanguage;
                    }
                    Err(message) => body.status = HandlerStatus::InvalidEncoding(message),
                }
            }
        }
        result.push(body);
    }
    result
}

/// The decoded value of one of a routine's header options, such as `HANDLER`.
/// The last spelling wins when an option is repeated.
fn option_value(sql: &str, routine: Node<'_>, name: &str) -> Option<String> {
    let mut cursor = routine.walk();
    let value = routine
        .named_children(&mut cursor)
        .filter(|n| n.kind() == "module_option")
        .filter_map(|n| n.named_child(0))
        .filter(|option| {
            option
                .child_by_field_name("name")
                .is_some_and(|n| sql[n.byte_range()].eq_ignore_ascii_case(name))
        })
        .filter_map(|option| option.child_by_field_name("value"))
        .last()?;
    let raw = &sql[value.byte_range()];
    if let Some(inner) = raw.strip_prefix("$$").and_then(|r| r.strip_suffix("$$")) {
        return Some(inner.to_owned());
    }
    match raw.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')) {
        Some(inner) => HandlerSource::quoted(inner, 0)
            .ok()
            .map(|decoded| decoded.text().to_owned()),
        None => Some(raw.to_owned()),
    }
}
