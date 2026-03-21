const t = require("@babel/types");

module.exports = {
  name: "voidToUndefined",
  tags: ["safe"],
  visitor() {
    return {
      UnaryExpression(path) {
        if (path.node.operator !== "void") return;
        if (!t.isLiteral(path.node.argument)) return;

        path.replaceWith(t.identifier("undefined"));
        this.changes++;
      },
    };
  },
};
