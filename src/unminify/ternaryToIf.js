const t = require("@babel/types");

module.exports = {
  name: "ternaryToIf",
  tags: ["safe"],
  visitor() {
    return {
      ExpressionStatement(path) {
        const expr = path.node.expression;
        if (!t.isConditionalExpression(expr)) return;

        path.replaceWith(
          t.ifStatement(
            expr.test,
            t.blockStatement([t.expressionStatement(expr.consequent)]),
            t.blockStatement([t.expressionStatement(expr.alternate)])
          )
        );
        this.changes++;
      },
      ReturnStatement(path) {
        const arg = path.node.argument;
        if (!t.isConditionalExpression(arg)) return;

        path.replaceWith(
          t.ifStatement(
            arg.test,
            t.blockStatement([t.returnStatement(arg.consequent)]),
            t.blockStatement([t.returnStatement(arg.alternate)])
          )
        );
        this.changes++;
      },
    };
  },
};
