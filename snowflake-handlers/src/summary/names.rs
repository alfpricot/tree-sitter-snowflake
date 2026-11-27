//! Which `object_reference` nodes do not name a schema object.

use std::borrow::Cow;
use tree_sitter::Node;

/// Whether `reference` only qualifies a column or `*`, as the `t` in `t.a`. A
/// qualifier before `NEXTVAL` names a sequence, so it is not one.
pub(super) fn is_column_qualifier(sql: &str, reference: Node<'_>) -> bool {
    reference
        .parent()
        .is_some_and(|parent| match parent.kind() {
            "all_fields" => true,
            "field" => !parent
                .child_by_field_name("name")
                .is_some_and(|n| sql[n.byte_range()].eq_ignore_ascii_case("nextval")),
            _ => false,
        })
}

/// Whether `reference` reads a common table expression that is in scope, and
/// so names no object. Only an unqualified name in `FROM` or `JOIN` can.
pub(super) fn is_cte_use(sql: &str, reference: Node<'_>) -> bool {
    if reference.named_child_count() != 1
        || reference
            .parent()
            .is_none_or(|parent| parent.kind() != "relation")
    {
        return false;
    }
    let name = resolved(&sql[reference.byte_range()]);
    let mut inner = reference;
    while let Some(scope) = inner.parent() {
        let mut cursor = scope.walk();
        let mut recursive = false;
        for child in scope.named_children(&mut cursor) {
            recursive |= child.kind() == "keyword_recursive";
            // An expression is visible after its own definition, and inside
            // it only when it is recursive.
            let own = child == inner;
            if child.kind() == "cte"
                && (!own || recursive || follows_union(child, reference))
                && child
                    .named_child(0)
                    .is_some_and(|n| resolved(&sql[n.byte_range()]) == name)
            {
                return true;
            }
            if own {
                break;
            }
        }
        inner = scope;
    }
    false
}

/// Whether `reference` is in a later branch of the `UNION` that is the body of
/// `cte`, where Snowflake reads the expression's own name as recursion even
/// without the `RECURSIVE` keyword.
fn follows_union(cte: Node<'_>, reference: Node<'_>) -> bool {
    let mut cursor = cte.walk();
    let body = cte
        .named_children(&mut cursor)
        .find(|n| n.kind() == "statement");
    let Some(mut operation) = body.and_then(|body| body.named_child(0)) else {
        return false;
    };
    // The first branch of a chain of set operations is the innermost one.
    while operation.kind() == "set_operation" {
        let mut cursor = operation.walk();
        let union = operation
            .children(&mut cursor)
            .find(|n| n.kind() == "keyword_union");
        if union.is_some_and(|union| union.end_byte() <= reference.start_byte()) {
            return true;
        }
        let Some(first) = operation.named_child(0) else {
            break;
        };
        operation = first;
    }
    false
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
