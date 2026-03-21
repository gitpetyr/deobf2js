const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

/**
 * Detect Webpack 4 or Webpack 5 bundle patterns in an AST.
 *
 * Webpack 4 pattern:
 *   (function(modules) {
 *     function __webpack_require__(moduleId) { ... }
 *     return __webpack_require__(0);
 *   })([function(module, exports, __webpack_require__) { ... }, ...]);
 *
 * Webpack 5 pattern:
 *   (() => {
 *     var __webpack_modules__ = { 123: (module, exports, __webpack_require__) => { ... } };
 *     function __webpack_require__(moduleId) { ... }
 *     __webpack_require__(123);
 *   })();
 *
 * @param {Object} ast - Babel AST of the full bundle
 * @returns {{ type: "webpack4"|"webpack5", modulesNode: Object, entryId: number|string }|null}
 */
function detectWebpack(ast) {
  let result = null;

  traverse(ast, {
    CallExpression(path) {
      if (result) return;

      const { callee, arguments: args } = path.node;

      // --- Webpack 4 ---
      // IIFE: (function(modules){ ... })([...])
      if (
        t.isFunctionExpression(callee) &&
        callee.params.length === 1 &&
        callee.params[0].name === "modules" &&
        args.length >= 1 &&
        t.isArrayExpression(args[0])
      ) {
        const modulesNode = args[0];
        // Verify elements are functions
        const allFunctions = modulesNode.elements.every(
          (el) => el === null || t.isFunctionExpression(el) || t.isArrowFunctionExpression(el)
        );
        if (!allFunctions) return;

        // Find entry ID
        let entryId = 0;
        traverse(
          callee.body,
          {
            ReturnStatement(retPath) {
              const arg = retPath.node.argument;
              if (
                t.isCallExpression(arg) &&
                t.isIdentifier(arg.callee, { name: "__webpack_require__" }) &&
                arg.arguments.length === 1 &&
                t.isNumericLiteral(arg.arguments[0])
              ) {
                entryId = arg.arguments[0].value;
              }
            },
            AssignmentExpression(assignPath) {
              const { left, right } = assignPath.node;
              if (
                t.isMemberExpression(left) &&
                t.isIdentifier(left.object, { name: "__webpack_require__" }) &&
                t.isIdentifier(left.property, { name: "s" }) &&
                t.isNumericLiteral(right)
              ) {
                entryId = right.value;
              }
            },
          },
          path.scope,
          path
        );

        result = { type: "webpack4", modulesNode, entryId };
        path.stop();
        return;
      }

      // --- Webpack 5 ---
      // IIFE: (() => { ... })() or (function(){ ... })()
      const isIIFE =
        (t.isArrowFunctionExpression(callee) || t.isFunctionExpression(callee)) &&
        callee.params.length === 0 &&
        args.length === 0;

      if (!isIIFE) return;

      const body = t.isBlockStatement(callee.body)
        ? callee.body
        : null;
      if (!body) return;

      // Look for __webpack_modules__ variable declaration
      let modulesNode = null;
      for (const stmt of body.body) {
        if (t.isVariableDeclaration(stmt)) {
          for (const decl of stmt.declarations) {
            if (
              t.isIdentifier(decl.id, { name: "__webpack_modules__" }) &&
              t.isObjectExpression(decl.init)
            ) {
              modulesNode = decl.init;
              break;
            }
          }
        }
        if (modulesNode) break;
      }
      if (!modulesNode) return;

      // Verify properties have function values
      const allFuncs = modulesNode.properties.every(
        (prop) =>
          t.isObjectProperty(prop) &&
          (t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value))
      );
      if (!allFuncs) return;

      // Find entry ID from last __webpack_require__() call in IIFE body
      let entryId = null;
      for (let i = body.body.length - 1; i >= 0; i--) {
        const stmt = body.body[i];
        if (t.isExpressionStatement(stmt) && t.isCallExpression(stmt.expression)) {
          const call = stmt.expression;
          if (
            t.isIdentifier(call.callee, { name: "__webpack_require__" }) &&
            call.arguments.length === 1
          ) {
            const arg = call.arguments[0];
            if (t.isNumericLiteral(arg)) {
              entryId = arg.value;
            } else if (t.isStringLiteral(arg)) {
              entryId = arg.value;
            }
            break;
          }
        }
      }

      if (entryId === null) return;

      result = { type: "webpack5", modulesNode, entryId };
      path.stop();
    },
  });

  return result;
}

module.exports = { detectWebpack };
