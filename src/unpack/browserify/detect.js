const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

/**
 * Detect Browserify bundle pattern in an AST.
 *
 * Browserify pattern:
 *   (function(){function r(e,n,t){...}return r})()({
 *     1: [function(require,module,exports){ ... }, {"dep": 2}],
 *     2: [function(require,module,exports){ ... }, {}]
 *   }, {}, [1])
 *
 * The outer structure is a CallExpression where:
 *   - callee is a CallExpression (the IIFE that returns the loader function `r`)
 *   - first argument is an ObjectExpression (module map)
 *   - each property value is an ArrayExpression with 2 elements:
 *       [FunctionExpression, ObjectExpression(dependency map)]
 *   - third argument is an ArrayExpression of entry IDs
 *
 * @param {Object} ast - Babel AST of the full bundle
 * @returns {{ modulesNode: Object, entryIds: Array }|null}
 */
function detectBrowserify(ast) {
  let result = null;

  traverse(ast, {
    CallExpression(path) {
      if (result) return;

      const { callee, arguments: args } = path.node;

      // Callee must be a CallExpression (double-invocation pattern)
      if (!t.isCallExpression(callee)) return;

      // The inner callee should be a FunctionExpression (the IIFE)
      const innerCallee = callee.callee;
      if (
        !t.isFunctionExpression(innerCallee) &&
        !t.isArrowFunctionExpression(innerCallee)
      ) {
        return;
      }

      // First argument should be an ObjectExpression (module map)
      if (args.length < 1 || !t.isObjectExpression(args[0])) return;

      const modulesNode = args[0];

      // Verify that each property value is [FunctionExpression, ObjectExpression]
      let valid = modulesNode.properties.length > 0;
      for (const prop of modulesNode.properties) {
        if (!t.isObjectProperty(prop)) {
          valid = false;
          break;
        }
        if (!t.isArrayExpression(prop.value) || prop.value.elements.length !== 2) {
          valid = false;
          break;
        }
        const [funcEl, depsEl] = prop.value.elements;
        if (
          !(t.isFunctionExpression(funcEl) || t.isArrowFunctionExpression(funcEl)) ||
          !t.isObjectExpression(depsEl)
        ) {
          valid = false;
          break;
        }
      }
      if (!valid) return;

      // Third argument is the entry point IDs array
      let entryIds = [];
      if (args.length >= 3 && t.isArrayExpression(args[2])) {
        entryIds = args[2].elements
          .map((el) => {
            if (t.isNumericLiteral(el)) return el.value;
            if (t.isStringLiteral(el)) return el.value;
            return null;
          })
          .filter((v) => v !== null);
      }

      result = { modulesNode, entryIds };
      path.stop();
    },
  });

  return result;
}

module.exports = { detectBrowserify };
