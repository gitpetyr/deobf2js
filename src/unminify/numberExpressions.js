const t = require("@babel/types");

module.exports = {
  name: "numberExpressions",
  tags: ["safe"],
  visitor() {
    return {
      UnaryExpression(path) {
        const { operator, argument } = path.node;

        // +5 → 5
        if (operator === "+" && t.isNumericLiteral(argument)) {
          path.replaceWith(t.numericLiteral(argument.value));
          this.changes++;
          return;
        }

        // -0 → 0
        if (
          operator === "-" &&
          t.isNumericLiteral(argument) &&
          argument.value === 0
        ) {
          path.replaceWith(t.numericLiteral(0));
          this.changes++;
        }
      },
    };
  },
};
