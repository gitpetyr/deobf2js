const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("deadFunctionElimination");

module.exports = {
  name: "deadFunctionElimination",
  tags: ["unsafe"],
  run(ast, state, options = {}) {
    const taintedNames = options.taintedNames || new Set();
    const aggressiveDce = options.aggressiveDce || false;
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      traverse(ast, {
        FunctionDeclaration(path) {
          const name = path.node.id && path.node.id.name;
          if (!name) return;
          if (taintedNames.has(name)) return;

          if (!aggressiveDce && path.parentPath.isProgram()) return;

          const binding = path.scope.getBinding(name);
          if (!binding) return;

          if (binding.referencePaths.length > 0) return;

          path.remove();
          changes++;
        },

        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const init = path.node.init;
          if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;

          const name = path.node.id.name;
          if (taintedNames.has(name)) return;

          if (!aggressiveDce) {
            const varDecl = path.parentPath;
            if (varDecl.parentPath && varDecl.parentPath.isProgram()) return;
          }

          const binding = path.scope.getBinding(name);
          if (!binding) return;

          const hasObjPropRef = binding.referencePaths.some((refPath) => {
            return refPath.parentPath.isObjectProperty() && refPath.parentPath.node.value === refPath.node;
          });
          if (hasObjPropRef) return;

          if (binding.referencePaths.length > 0) return;

          const varDecl = path.parentPath;
          if (varDecl.node.declarations.length === 1) {
            varDecl.remove();
          } else {
            path.remove();
          }
          changes++;
        },
      });

      if (changes > 0) {
        traverse(ast, {
          Program(path) { path.scope.crawl(); },
        });
      }

      totalChanges += changes;
      log("Pass", pass, ":", changes, "functions removed");
      if (changes === 0) break;
    }

    state.changes += totalChanges;
  },
};
