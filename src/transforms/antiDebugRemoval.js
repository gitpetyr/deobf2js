const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("antiDebugRemoval");

/**
 * Check if a function body contains only a debugger statement.
 */
function isDebuggerOnlyBody(node) {
  if (t.isBlockStatement(node)) {
    return node.body.length === 1 && t.isDebuggerStatement(node.body[0]);
  }
  return t.isDebuggerStatement(node);
}

module.exports = {
  name: "antiDebugRemoval",
  tags: ["unsafe"],
  visitor() {
    return {
      // Standalone: debugger;
      DebuggerStatement(path) {
        path.remove();
        this.changes++;
        log("Removed debugger statement");
      },

      // setInterval/setTimeout(() => { debugger }, ...) or with function()
      CallExpression(path) {
        const callee = path.node.callee;

        // Match setInterval/setTimeout by name
        let name = null;
        if (t.isIdentifier(callee)) {
          name = callee.name;
        } else if (
          t.isMemberExpression(callee) &&
          !callee.computed &&
          t.isIdentifier(callee.property)
        ) {
          name = callee.property.name;
        }

        if (name !== "setInterval" && name !== "setTimeout") return;
        if (path.node.arguments.length < 1) return;

        const callback = path.node.arguments[0];

        // function() { debugger } or () => { debugger }
        if (
          (t.isFunctionExpression(callback) || t.isArrowFunctionExpression(callback)) &&
          isDebuggerOnlyBody(callback.body)
        ) {
          // Remove the entire ExpressionStatement if possible
          if (path.parentPath.isExpressionStatement()) {
            path.parentPath.remove();
          } else {
            path.remove();
          }
          this.changes++;
          log("Removed", name, "debugger trap");
        }
      },
    };
  },
};
