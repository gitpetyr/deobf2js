const t = require("@babel/types");

module.exports = {
  name: "logicalAssignments",
  tags: ["safe"],
  visitor() {
    return {
      // Pattern: x && (x = y)  or  x || (x = y)  as a standalone statement
      // -->  x &&= y  or  x ||= y
      ExpressionStatement(path) {
        const expr = path.node.expression;
        if (!t.isLogicalExpression(expr)) return;

        const { operator, left, right } = expr;
        if (operator !== "&&" && operator !== "||") return;
        if (!t.isIdentifier(left)) return;
        if (!t.isAssignmentExpression(right, { operator: "=" })) return;
        if (!t.isIdentifier(right.left) || right.left.name !== left.name) return;

        const assignOp = operator + "="; // "&&=" or "||="
        path.replaceWith(
          t.expressionStatement(
            t.assignmentExpression(assignOp, left, right.right)
          )
        );
        this.changes++;
      },
    };
  },
};
