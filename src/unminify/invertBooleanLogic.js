const t = require("@babel/types");

const comparisonFlips = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};

function isSimple(node) {
  return t.isIdentifier(node) || t.isLiteral(node);
}

module.exports = {
  name: "invertBooleanLogic",
  tags: ["safe"],
  visitor() {
    return {
      UnaryExpression(path) {
        const node = path.node;
        if (node.operator !== "!") return;

        const arg = node.argument;

        // !(a op b) → a flippedOp b (for comparison operators)
        if (t.isBinaryExpression(arg) && arg.operator in comparisonFlips) {
          path.replaceWith(
            t.binaryExpression(comparisonFlips[arg.operator], arg.left, arg.right)
          );
          this.changes++;
          return;
        }

        // De Morgan's laws — only when both operands are simple
        if (t.isLogicalExpression(arg)) {
          if (!isSimple(arg.left) || !isSimple(arg.right)) return;

          if (arg.operator === "&&") {
            // !(a && b) → !a || !b
            path.replaceWith(
              t.logicalExpression(
                "||",
                t.unaryExpression("!", arg.left),
                t.unaryExpression("!", arg.right)
              )
            );
            this.changes++;
            return;
          }

          if (arg.operator === "||") {
            // !(a || b) → !a && !b
            path.replaceWith(
              t.logicalExpression(
                "&&",
                t.unaryExpression("!", arg.left),
                t.unaryExpression("!", arg.right)
              )
            );
            this.changes++;
            return;
          }
        }
      },
    };
  },
};
