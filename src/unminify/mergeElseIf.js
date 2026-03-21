const t = require("@babel/types");

module.exports = {
  name: "mergeElseIf",
  tags: ["safe"],
  visitor() {
    return {
      IfStatement(path) {
        const { alternate } = path.node;
        if (!alternate) return;
        if (!t.isBlockStatement(alternate)) return;
        if (alternate.body.length !== 1) return;
        if (!t.isIfStatement(alternate.body[0])) return;

        path.node.alternate = alternate.body[0];
        this.changes++;
      },
    };
  },
};
