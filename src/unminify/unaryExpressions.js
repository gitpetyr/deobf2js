const t = require("@babel/types");

module.exports = {
  name: "unaryExpressions",
  tags: ["safe"],
  visitor() {
    return {
      UnaryExpression(path) {
        const node = path.node;

        // -(-x) → x
        if (
          node.operator === "-" &&
          t.isUnaryExpression(node.argument) &&
          node.argument.operator === "-"
        ) {
          path.replaceWith(node.argument.argument);
          this.changes++;
          return;
        }

        // ~(~x) → x
        if (
          node.operator === "~" &&
          t.isUnaryExpression(node.argument) &&
          node.argument.operator === "~"
        ) {
          path.replaceWith(node.argument.argument);
          this.changes++;
          return;
        }

        // typeof undefined → "undefined"
        if (
          node.operator === "typeof" &&
          t.isIdentifier(node.argument, { name: "undefined" })
        ) {
          path.replaceWith(t.stringLiteral("undefined"));
          this.changes++;
          return;
        }
      },
    };
  },
};
