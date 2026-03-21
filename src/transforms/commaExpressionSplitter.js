const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("commaExpressionSplitter");

module.exports = {
  name: "commaExpressionSplitter",
  tags: ["safe"],
  visitor() {
    return {
      ExpressionStatement(path) {
        const expr = path.node.expression;
        if (!t.isSequenceExpression(expr)) return;

        // (a(), b(), c()) -> a(); b(); c();
        const stmts = expr.expressions.map((e) => t.expressionStatement(e));
        path.replaceWithMultiple(stmts);
        this.changes++;
      },
    };
  },
};
