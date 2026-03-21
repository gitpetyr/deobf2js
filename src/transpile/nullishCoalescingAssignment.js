const t = require("@babel/types");

/**
 * Check if a node is a loose null check: `x == null` or `null == x`.
 * Returns the identifier name if matched, or null.
 */
function getLooseNullCheckId(node) {
  if (!t.isBinaryExpression(node, { operator: "==" })) return null;
  if (t.isNullLiteral(node.right) && t.isIdentifier(node.left)) {
    return node.left.name;
  }
  if (t.isNullLiteral(node.left) && t.isIdentifier(node.right)) {
    return node.right.name;
  }
  return null;
}

module.exports = {
  name: "nullishCoalescingAssignment",
  tags: ["safe"],
  visitor() {
    return {
      // Pattern: x = x ?? y  -->  x ??= y
      AssignmentExpression(path) {
        if (path.node.operator !== "=") return;
        const { left, right } = path.node;
        if (!t.isIdentifier(left)) return;
        if (!t.isLogicalExpression(right, { operator: "??" })) return;
        if (!t.isIdentifier(right.left) || right.left.name !== left.name) return;

        path.replaceWith(
          t.assignmentExpression("??=", left, right.right)
        );
        this.changes++;
      },

      // Pattern: if (x == null) x = y;  -->  x ??= y;
      IfStatement(path) {
        const { test, consequent, alternate } = path.node;

        // Must have no else branch
        if (alternate) return;

        const checkedName = getLooseNullCheckId(test);
        if (!checkedName) return;

        // Consequent must be a single assignment statement (or a block with one)
        let assignStmt;
        if (t.isExpressionStatement(consequent)) {
          assignStmt = consequent;
        } else if (t.isBlockStatement(consequent) && consequent.body.length === 1 &&
                   t.isExpressionStatement(consequent.body[0])) {
          assignStmt = consequent.body[0];
        } else {
          return;
        }

        const expr = assignStmt.expression;
        if (!t.isAssignmentExpression(expr, { operator: "=" })) return;
        if (!t.isIdentifier(expr.left) || expr.left.name !== checkedName) return;

        path.replaceWith(
          t.expressionStatement(
            t.assignmentExpression("??=", expr.left, expr.right)
          )
        );
        this.changes++;
      },
    };
  },
};
