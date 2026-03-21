const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("objectPropertyCollapse");

/**
 * Collapse incremental object property assignments into the object literal.
 *
 * Converts:
 *   M = {};
 *   M["key1"] = value1;
 *   M["key2"] = value2;
 *
 * Into:
 *   M = { key1: value1, key2: value2 };
 *
 * This normalization allows constantObjectInlining and objectProxyInlining
 * to handle these objects.
 */

function collapseProperties(path, varName, objExpr) {
  const siblings = path.getAllNextSiblings();
  const properties = [];
  const toRemove = [];

  for (const sibling of siblings) {
    // Must be an expression statement
    if (!sibling.isExpressionStatement()) break;
    const expr = sibling.node.expression;

    // Must be an assignment: X["key"] = value or X.key = value
    if (!t.isAssignmentExpression(expr) || expr.operator !== "=") break;
    if (!t.isMemberExpression(expr.left)) break;
    if (!t.isIdentifier(expr.left.object) || expr.left.object.name !== varName) break;

    // Resolve property key
    let key;
    if (!expr.left.computed && t.isIdentifier(expr.left.property)) {
      key = t.identifier(expr.left.property.name);
    } else if (expr.left.computed && t.isStringLiteral(expr.left.property)) {
      const keyName = expr.left.property.value;
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(keyName)) {
        key = t.identifier(keyName);
      } else {
        key = t.stringLiteral(keyName);
      }
    } else {
      break; // dynamic key -- stop collecting
    }

    properties.push(t.objectProperty(key, expr.right));
    toRemove.push(sibling);
  }

  if (properties.length === 0) return 0;

  // Merge collected properties into the object literal
  objExpr.properties.push(...properties);

  // Remove the individual assignment statements
  for (const stmt of toRemove) {
    stmt.remove();
  }

  return properties.length;
}

module.exports = {
  name: "objectPropertyCollapse",
  tags: ["safe"],
  run(ast, state) {
    traverse(ast, {
      // Handle: X = {}; X["key"] = value; ...
      ExpressionStatement(path) {
        const expr = path.node.expression;
        if (!t.isAssignmentExpression(expr) || expr.operator !== "=") return;
        if (!t.isIdentifier(expr.left)) return;
        if (!t.isObjectExpression(expr.right)) return;
        if (expr.right.properties.length > 0) return; // only empty objects

        const varName = expr.left.name;
        state.changes += collapseProperties(path, varName, expr.right);
      },
      // Handle: var X = {}; X["key"] = value; ...
      VariableDeclaration(path) {
        if (path.node.declarations.length !== 1) return;
        const decl = path.node.declarations[0];
        if (!t.isIdentifier(decl.id)) return;
        if (!decl.init || !t.isObjectExpression(decl.init)) return;
        if (decl.init.properties.length > 0) return;

        const varName = decl.id.name;
        state.changes += collapseProperties(path, varName, decl.init);
      },
    });

    log("Collapsed", state.changes, "property assignments into object literals");
  },
};
