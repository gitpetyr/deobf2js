const t = require("@babel/types");

module.exports = {
  name: "unminifyBooleans",
  tags: ["safe"],
  visitor() {
    return {
      UnaryExpression(path) {
        if (path.node.operator !== "!") return;
        if (!t.isNumericLiteral(path.node.argument)) return;

        const value = path.node.argument.value;
        if (value === 0) {
          path.replaceWith(t.booleanLiteral(true));
          this.changes++;
        } else if (value === 1) {
          path.replaceWith(t.booleanLiteral(false));
          this.changes++;
        }
      },
    };
  },
};
