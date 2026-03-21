const t = require("@babel/types");
const { Module } = require("../module");

/**
 * Extract module functions from a Webpack bundle's modules node.
 *
 * @param {Object} modulesNode - Babel AST node (ArrayExpression for webpack4, ObjectExpression for webpack5)
 * @param {"webpack4"|"webpack5"} type - Bundle type
 * @returns {Map<number|string, Module>} Map of module ID to Module instance
 */
function extractModules(modulesNode, type) {
  const modules = new Map();

  if (type === "webpack4") {
    // ArrayExpression: each element is a FunctionExpression
    // ID is the array index
    for (let i = 0; i < modulesNode.elements.length; i++) {
      const el = modulesNode.elements[i];
      if (!el) continue; // skip null/empty slots

      const bodyStatements = extractBody(el);
      const programAst = t.file(t.program(bodyStatements));
      modules.set(i, new Module(i, programAst));
    }
  } else if (type === "webpack5") {
    // ObjectExpression: each property key is module ID, value is function
    for (const prop of modulesNode.properties) {
      if (!t.isObjectProperty(prop)) continue;

      let id;
      if (t.isNumericLiteral(prop.key)) {
        id = prop.key.value;
      } else if (t.isStringLiteral(prop.key)) {
        id = prop.key.value;
      } else if (t.isIdentifier(prop.key)) {
        id = prop.key.name;
      } else {
        continue;
      }

      const bodyStatements = extractBody(prop.value);
      const programAst = t.file(t.program(bodyStatements));
      modules.set(id, new Module(id, programAst));
    }
  }

  return modules;
}

/**
 * Extract body statements from a module function.
 * @param {Object} funcNode - FunctionExpression or ArrowFunctionExpression
 * @returns {Object[]} Array of statement AST nodes
 */
function extractBody(funcNode) {
  if (t.isBlockStatement(funcNode.body)) {
    // Clone statements to detach from parent
    return funcNode.body.body.map((stmt) => t.cloneNode(stmt, true));
  }
  // Arrow function with expression body: return it as an expression statement
  return [t.expressionStatement(t.cloneNode(funcNode.body, true))];
}

module.exports = { extractModules };
