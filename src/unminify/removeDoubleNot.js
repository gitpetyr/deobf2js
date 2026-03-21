const t = require("@babel/types");

module.exports = {
  name: "removeDoubleNot",
  tags: ["safe"],
  visitor() {
    return {
      UnaryExpression(path) {
        if (path.node.operator !== "!") return;
        if (!t.isUnaryExpression(path.node.argument, { operator: "!" })) return;

        const inner = path.node.argument.argument;
        const parent = path.parent;
        const parentKey = path.key;

        const isBooleanContext =
          (t.isIfStatement(parent) && parentKey === "test") ||
          (t.isWhileStatement(parent) && parentKey === "test") ||
          (t.isForStatement(parent) && parentKey === "test") ||
          (t.isConditionalExpression(parent) && parentKey === "test") ||
          t.isLogicalExpression(parent) ||
          (t.isUnaryExpression(parent) && parent.operator === "!");

        if (!isBooleanContext) return;

        path.replaceWith(inner);
        this.changes++;
      },
    };
  },
};
