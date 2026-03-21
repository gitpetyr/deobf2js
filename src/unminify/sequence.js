const t = require("@babel/types");

module.exports = {
  name: "sequence",
  tags: ["safe"],
  visitor() {
    return {
      ReturnStatement(path) {
        if (!t.isSequenceExpression(path.node.argument)) return;
        if (!path.parentPath || !path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return;

        const expressions = path.node.argument.expressions;
        if (expressions.length < 2) return;

        const preceding = expressions.slice(0, -1).map((expr) =>
          t.expressionStatement(expr)
        );
        const last = expressions[expressions.length - 1];

        path.replaceWithMultiple([
          ...preceding,
          t.returnStatement(last),
        ]);
        this.changes++;
      },
      ThrowStatement(path) {
        if (!t.isSequenceExpression(path.node.argument)) return;
        if (!path.parentPath || !path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return;

        const expressions = path.node.argument.expressions;
        if (expressions.length < 2) return;

        const preceding = expressions.slice(0, -1).map((expr) =>
          t.expressionStatement(expr)
        );
        const last = expressions[expressions.length - 1];

        path.replaceWithMultiple([
          ...preceding,
          t.throwStatement(last),
        ]);
        this.changes++;
      },
      IfStatement(path) {
        if (!t.isSequenceExpression(path.node.test)) return;
        if (!path.parentPath || !path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return;

        const expressions = path.node.test.expressions;
        if (expressions.length < 2) return;

        const preceding = expressions.slice(0, -1).map((expr) =>
          t.expressionStatement(expr)
        );
        const last = expressions[expressions.length - 1];

        path.node.test = last;
        path.insertBefore(preceding);
        this.changes++;
      },
    };
  },
};
