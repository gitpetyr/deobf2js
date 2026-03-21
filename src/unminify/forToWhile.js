const t = require("@babel/types");

module.exports = {
  name: "forToWhile",
  tags: ["safe"],
  visitor() {
    return {
      ForStatement(path) {
        if (path.node.init || path.node.update) return;

        const test = path.node.test || t.booleanLiteral(true);
        path.replaceWith(t.whileStatement(test, path.node.body));
        this.changes++;
      },
    };
  },
};
