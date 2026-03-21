const t = require("@babel/types");

module.exports = {
  name: "blockStatements",
  tags: ["safe"],
  visitor() {
    return {
      IfStatement(path) {
        const { consequent, alternate } = path.node;
        if (consequent && !t.isBlockStatement(consequent)) {
          path.node.consequent = t.blockStatement([
            t.isStatement(consequent) ? consequent : t.expressionStatement(consequent),
          ]);
          this.changes++;
        }
        if (alternate && !t.isBlockStatement(alternate) && !t.isIfStatement(alternate)) {
          path.node.alternate = t.blockStatement([
            t.isStatement(alternate) ? alternate : t.expressionStatement(alternate),
          ]);
          this.changes++;
        }
      },
      WhileStatement(path) {
        if (path.node.body && !t.isBlockStatement(path.node.body)) {
          path.node.body = t.blockStatement([
            t.isStatement(path.node.body) ? path.node.body : t.expressionStatement(path.node.body),
          ]);
          this.changes++;
        }
      },
      ForStatement(path) {
        if (path.node.body && !t.isBlockStatement(path.node.body)) {
          path.node.body = t.blockStatement([
            t.isStatement(path.node.body) ? path.node.body : t.expressionStatement(path.node.body),
          ]);
          this.changes++;
        }
      },
      ForInStatement(path) {
        if (path.node.body && !t.isBlockStatement(path.node.body)) {
          path.node.body = t.blockStatement([
            t.isStatement(path.node.body) ? path.node.body : t.expressionStatement(path.node.body),
          ]);
          this.changes++;
        }
      },
      ForOfStatement(path) {
        if (path.node.body && !t.isBlockStatement(path.node.body)) {
          path.node.body = t.blockStatement([
            t.isStatement(path.node.body) ? path.node.body : t.expressionStatement(path.node.body),
          ]);
          this.changes++;
        }
      },
    };
  },
};
