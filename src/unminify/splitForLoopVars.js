const t = require("@babel/types");

module.exports = {
  name: "splitForLoopVars",
  tags: ["safe"],
  visitor() {
    return {
      ForStatement(path) {
        const init = path.node.init;
        if (!t.isVariableDeclaration(init)) return;

        const parent = path.parentPath;
        if (!parent.isBlock() && !parent.isProgram()) return;

        path.insertBefore(init);
        path.node.init = null;
        this.changes++;
      },
    };
  },
};
