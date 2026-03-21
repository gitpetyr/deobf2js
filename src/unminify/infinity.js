const t = require("@babel/types");

module.exports = {
  name: "infinity",
  tags: ["safe"],
  visitor() {
    return {
      BinaryExpression(path) {
        const { operator, left, right } = path.node;
        if (
          operator === "/" &&
          t.isNumericLiteral(left, { value: 1 }) &&
          t.isNumericLiteral(right, { value: 0 })
        ) {
          path.replaceWith(t.identifier("Infinity"));
          this.changes++;
        }
      },
      UnaryExpression(path) {
        if (path.node.operator !== "-") return;
        const arg = path.node.argument;
        if (
          t.isBinaryExpression(arg, { operator: "/" }) &&
          t.isNumericLiteral(arg.left, { value: 1 }) &&
          t.isNumericLiteral(arg.right, { value: 0 })
        ) {
          path.replaceWith(
            t.unaryExpression("-", t.identifier("Infinity"))
          );
          this.changes++;
        }
      },
    };
  },
};
