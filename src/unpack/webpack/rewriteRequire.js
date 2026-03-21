const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

/**
 * Rewrite webpack-specific require patterns in a module AST.
 *
 * Transforms:
 *   __webpack_require__(123)          → require("./module_123")
 *   __webpack_require__.d(exports, {name: () => name})  → exports.name = name
 *   __webpack_require__.r(exports)    → (removed)
 *   __webpack_require__.n(mod)        → mod
 *
 * @param {Object} moduleAst - Babel AST (File node) of a single module
 * @param {Map} modules - Map of all modules (used for path resolution)
 */
function rewriteRequire(moduleAst, modules) {
  traverse(moduleAst, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;

      // __webpack_require__(id) → require("./module_<id>")
      if (
        t.isIdentifier(callee, { name: "__webpack_require__" }) &&
        args.length === 1
      ) {
        const arg = args[0];
        let moduleId;
        if (t.isNumericLiteral(arg)) {
          moduleId = arg.value;
        } else if (t.isStringLiteral(arg)) {
          moduleId = arg.value;
        } else {
          return;
        }

        const targetMod = modules.get(moduleId);
        const modulePath = targetMod ? `./${targetMod.path.replace(/\.js$/, "")}` : `./module_${moduleId}`;

        path.replaceWith(
          t.callExpression(t.identifier("require"), [
            t.stringLiteral(modulePath),
          ])
        );
        return;
      }

      // __webpack_require__.d(exports, { name: () => value, ... })
      // → exports.name = value; exports.name2 = value2; ...
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "__webpack_require__" }) &&
        t.isIdentifier(callee.property, { name: "d" }) &&
        args.length === 2 &&
        t.isObjectExpression(args[1])
      ) {
        const exportStatements = [];
        for (const prop of args[1].properties) {
          if (!t.isObjectProperty(prop)) continue;

          const key = prop.key;
          const val = prop.value;

          let exportName;
          if (t.isIdentifier(key)) {
            exportName = key.name;
          } else if (t.isStringLiteral(key)) {
            exportName = key.value;
          } else {
            continue;
          }

          // The value is typically () => someVar — extract the return value
          let exportValue;
          if (
            t.isArrowFunctionExpression(val) &&
            !t.isBlockStatement(val.body)
          ) {
            exportValue = val.body;
          } else if (
            t.isArrowFunctionExpression(val) &&
            t.isBlockStatement(val.body) &&
            val.body.body.length === 1 &&
            t.isReturnStatement(val.body.body[0])
          ) {
            exportValue = val.body.body[0].argument;
          } else {
            exportValue = val;
          }

          exportStatements.push(
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(
                  t.identifier("exports"),
                  t.identifier(exportName)
                ),
                t.cloneNode(exportValue, true)
              )
            )
          );
        }

        if (exportStatements.length > 0) {
          // If in an expression statement, replace with multiple statements
          if (t.isExpressionStatement(path.parent)) {
            const parentPath = path.parentPath;
            for (let i = exportStatements.length - 1; i >= 1; i--) {
              parentPath.insertAfter(exportStatements[i]);
            }
            parentPath.replaceWith(exportStatements[0]);
          } else {
            // Fallback: replace call with first export assignment expression
            path.replaceWith(exportStatements[0].expression);
          }
        } else {
          path.remove();
        }
        return;
      }

      // __webpack_require__.r(exports) → remove
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "__webpack_require__" }) &&
        t.isIdentifier(callee.property, { name: "r" })
      ) {
        if (t.isExpressionStatement(path.parent)) {
          path.parentPath.remove();
        } else {
          path.replaceWith(t.identifier("undefined"));
        }
        return;
      }

      // __webpack_require__.n(mod) → mod
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "__webpack_require__" }) &&
        t.isIdentifier(callee.property, { name: "n" }) &&
        args.length === 1
      ) {
        path.replaceWith(t.cloneNode(args[0], true));
        return;
      }
    },
  });
}

module.exports = { rewriteRequire };
