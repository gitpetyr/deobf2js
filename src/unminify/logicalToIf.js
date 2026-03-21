const t = require("@babel/types");

module.exports = {
  name: "logicalToIf",
  tags: ["safe"],
  visitor() {
    return {
      ExpressionStatement(path) {
        const expr = path.node.expression;
        if (!t.isLogicalExpression(expr)) return;

        if (expr.operator === "&&") {
          path.replaceWith(
            t.ifStatement(expr.left, t.expressionStatement(expr.right))
          );
          this.changes++;
        } else if (expr.operator === "||") {
          path.replaceWith(
            t.ifStatement(
              t.unaryExpression("!", expr.left),
              t.expressionStatement(expr.right)
            )
          );
          this.changes++;
        }
      },
    };
  },
};
