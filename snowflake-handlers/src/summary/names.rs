//! Which `object_reference` nodes name a schema object.

use std::borrow::Cow;
use tree_sitter::Node;

/// A named node on the way from the root to the node being visited.
pub(super) struct Ancestor<'tree, 'sql> {
    node: Node<'tree>,
    /// Whether its `WITH` clause says `RECURSIVE`.
    recursive: bool,
    /// The common table expressions among its children visited so far, each
    /// with the name it declares.
    ctes: Vec<(Node<'tree>, Cow<'sql, str>)>,
}

/// Calls `visit` for `root` and every named node below it, in document order,
/// with the node's ancestors, outermost first. Carrying them along avoids
/// asking each node for its parent, which searches down from the root again.
pub(super) fn walk<'tree, 'sql>(
    sql: &'sql str,
    root: Node<'tree>,
    mut visit: impl FnMut(Node<'tree>, &[Ancestor<'tree, 'sql>]),
) {
    let mut cursor = root.walk();
    let mut path: Vec<Ancestor<'tree, 'sql>> = Vec::new();
    loop {
        let node = cursor.node();
        if node.is_named() {
            if let Some(parent) = path.last_mut() {
                match node.kind() {
                    "keyword_recursive" => parent.recursive = true,
                    "cte" => {
                        if let Some(name) = node.named_child(0) {
                            parent.ctes.push((node, resolved(&sql[name.byte_range()])));
                        }
                    }
                    _ => {}
                }
            }
            visit(node, &path);
            if cursor.goto_first_child() {
                path.push(Ancestor {
                    node,
                    recursive: false,
                    ctes: Vec::new(),
                });
                continue;
            }
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return;
            }
            path.pop();
        }
    }
}

/// Whether `reference` only qualifies a column or `*`, as the `t` in `t.a`. A
/// qualifier before `NEXTVAL` names a sequence, so it is not one.
pub(super) fn is_column_qualifier(sql: &str, path: &[Ancestor<'_, '_>]) -> bool {
    path.last().is_some_and(|parent| match parent.node.kind() {
        "all_fields" => true,
        "field" => !parent
            .node
            .child_by_field_name("name")
            .is_some_and(|n| sql[n.byte_range()].eq_ignore_ascii_case("nextval")),
        _ => false,
    })
}

/// Whether `reference` reads a common table expression that is in scope, and
/// so names no object. Only an unqualified name in `FROM`, `JOIN`, or another
/// source of rows can: the table a `MERGE` writes is always an object.
pub(super) fn is_cte_use(sql: &str, reference: Node<'_>, path: &[Ancestor<'_, '_>]) -> bool {
    let [.., statement, relation] = path else {
        return false;
    };
    if reference.named_child_count() != 1
        || relation.node.kind() != "relation"
        || (statement.node.kind() == "merge_statement"
            && statement.node.child_by_field_name("target") == Some(relation.node))
    {
        return false;
    }
    let name = resolved(&sql[reference.byte_range()]);
    path.iter().enumerate().any(|(depth, scope)| {
        scope.ctes.iter().any(|(cte, declared)| {
            // An expression is visible after its own definition, and inside
            // it only when it is recursive.
            let inside = path.get(depth + 1).is_some_and(|child| child.node == *cte);
            *declared == name && (!inside || scope.recursive || follows_union(*cte, reference))
        })
    })
}

/// Whether `reference` is in a later branch of the `UNION` that is the body of
/// `cte`, where Snowflake reads the expression's own name as recursion even
/// without the `RECURSIVE` keyword.
fn follows_union(cte: Node<'_>, reference: Node<'_>) -> bool {
    // The body may open with a `WITH` clause of its own, ahead of the `UNION`.
    let operation = named_child_of_kind(cte, "statement")
        .and_then(|body| named_child_of_kind(body, "set_operation"));
    // One node holds every branch of a chain, so its first `UNION` ends the
    // first branch.
    operation
        .and_then(|operation| named_child_of_kind(operation, "keyword_union"))
        .is_some_and(|union| union.end_byte() <= reference.start_byte())
}

fn named_child_of_kind<'tree>(node: Node<'tree>, kind: &str) -> Option<Node<'tree>> {
    let mut cursor = node.walk();
    node.named_children(&mut cursor)
        .find(|child| child.kind() == kind)
}

/// The name an identifier stands for: a quoted one keeps its case, and an
/// unquoted one is read in uppercase.
fn resolved(identifier: &str) -> Cow<'_, str> {
    match identifier
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    {
        Some(quoted) => Cow::Owned(quoted.replace("\"\"", "\"")),
        None => Cow::Owned(identifier.to_uppercase()),
    }
}
