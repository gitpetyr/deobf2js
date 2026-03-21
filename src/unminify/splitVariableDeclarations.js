const t = require("@babel/types");

module.exports = {
  name: "splitVariableDeclarations",
  tags: ["safe"],
  visitor() {
    return {
      VariableDeclaration(path) {
        if (path.node.declarations.length <= 1) return;

        const parent = path.parent;
        if (
          t.isForStatement(parent, { init: path.node }) ||
          t.isForInStatement(parent, { left: path.node }) ||
          t.isForOfStatement(parent, { left: path.node })
        ) {
          return;
        }

        if (!t.isProgram(parent) && !t.isBlockStatement(parent)) return;

        const kind = path.node.kind;
        const replacements = path.node.declarations.map((declarator) =>
          t.variableDeclaration(kind, [declarator])
        );

        path.replaceWithMultiple(replacements);
        this.changes++;
      },
    };
  },
};
