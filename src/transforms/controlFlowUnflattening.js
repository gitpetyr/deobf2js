const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const { createLogger } = require("../utils/logger");
const { log } = createLogger("controlFlowUnflattening");

/**
 * Try to resolve a string-split order array from an AST node.
 * Handles: "3|1|4|0|2"["split"]("|") or str.split("|")
 * Returns string[] or null.
 */
function resolveOrderArray(node, scope) {
  // Direct: "3|1|4|0|2"["split"]("|")
  if (t.isCallExpression(node)) {
    const callee = node.callee;
    if (t.isMemberExpression(callee) && t.isStringLiteral(callee.object)) {
      let methodName = null;
      if (callee.computed && t.isStringLiteral(callee.property)) {
        methodName = callee.property.value;
      } else if (!callee.computed && t.isIdentifier(callee.property)) {
        methodName = callee.property.name;
      }
      if (methodName === "split" && node.arguments.length === 1 && t.isStringLiteral(node.arguments[0])) {
        return callee.object.value.split(node.arguments[0].value);
      }
    }
  }

  // Variable reference
  if (t.isIdentifier(node) && scope) {
    const binding = scope.getBinding(node.name);
    if (!binding) return null;

    // Case 1: var U = "..."["split"]("|")
    if (binding.path.isVariableDeclarator() && binding.path.node.init) {
      return resolveOrderArray(binding.path.node.init, binding.scope);
    }

    // Case 2: parameter reassigned — U = "..."["split"]("|")
    // Find the assignment in constantViolations
    for (const violation of binding.constantViolations) {
      if (violation.isAssignmentExpression() && violation.node.operator === "=") {
        const result = resolveOrderArray(violation.node.right, scope);
        if (result) return result;
      }
    }
  }

  return null;
}

/**
 * Try to resolve the order array from a for-loop init expression.
 * Handles: for (i = "0|1|2".split("|"), x = 0; ...)
 */
function resolveOrderFromForInit(init, orderVarName) {
  const exprs = [];
  if (t.isSequenceExpression(init)) {
    exprs.push(...init.expressions);
  } else if (t.isAssignmentExpression(init)) {
    exprs.push(init);
  }

  for (const expr of exprs) {
    if (
      t.isAssignmentExpression(expr, { operator: "=" }) &&
      t.isIdentifier(expr.left, { name: orderVarName })
    ) {
      return resolveOrderArray(expr.right, null);
    }
  }

  return null;
}

/**
 * Try to resolve the index variable init value and find its path for removal.
 * Returns { initValue, removePath } or null.
 */
function resolveIndexVar(name, scope) {
  const binding = scope.getBinding(name);
  if (!binding) return null;

  // Case 1: var O = 0
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.node.init;
    if (init && t.isNumericLiteral(init) && init.value === 0) {
      return { initValue: 0, removePath: binding.path };
    }
  }

  // Case 2: parameter reassigned — O = 0
  for (const violation of binding.constantViolations) {
    if (violation.isAssignmentExpression() && violation.node.operator === "=") {
      const right = violation.node.right;
      if (t.isNumericLiteral(right) && right.value === 0) {
        const stmt = violation.parentPath;
        if (stmt && stmt.isExpressionStatement()) {
          return { initValue: 0, removePath: stmt };
        }
      }
    }
  }

  return null;
}

/**
 * Find the removable path for the order array assignment.
 */
function findOrderRemovePath(orderNode, scope) {
  if (!t.isIdentifier(orderNode)) return null;

  const binding = scope.getBinding(orderNode.name);
  if (!binding) return null;

  // Case 1: var declaration
  if (binding.path.isVariableDeclarator()) {
    return binding.path;
  }

  // Case 2: assignment expression
  for (const violation of binding.constantViolations) {
    if (violation.isAssignmentExpression() && violation.node.operator === "=" &&
        t.isIdentifier(violation.node.left) && violation.node.left.name === orderNode.name) {
      const stmt = violation.parentPath;
      if (stmt && stmt.isExpressionStatement()) {
        return stmt;
      }
    }
  }

  return null;
}

/**
 * Extract and unflatten a switch-case control flow block.
 * Returns the sequential statements array, or null if pattern doesn't match.
 */
function processSwitch(switchNode, scope, forInit) {
  // Discriminant must be order[idx++] — a MemberExpression with UpdateExpression
  const disc = switchNode.discriminant;
  if (!t.isMemberExpression(disc) || !disc.computed) return null;

  // Property: idx++ (UpdateExpression with ++ postfix or prefix)
  const prop = disc.property;
  if (!t.isUpdateExpression(prop) || prop.operator !== "++") return null;
  if (!t.isIdentifier(prop.argument)) return null;
  const indexVarName = prop.argument.name;

  // Object: the order array variable
  const orderNode = disc.object;

  // Resolve the order array
  let orderArray = resolveOrderArray(orderNode, scope);

  // For for-loops, also try the init expression
  if (!orderArray && forInit && t.isIdentifier(orderNode)) {
    orderArray = resolveOrderFromForInit(forInit, orderNode.name);
  }

  if (!orderArray || orderArray.length === 0) {
    log("Could not resolve order array");
    return null;
  }
  log("Order array:", orderArray.join(", "));

  // Build case map: caseValue -> [statements]
  const caseMap = new Map();
  for (const caseClause of switchNode.cases) {
    if (!caseClause.test || !t.isStringLiteral(caseClause.test)) return null;
    const key = caseClause.test.value;
    // Strip trailing ContinueStatement
    const body = [...caseClause.consequent];
    if (body.length > 0 && t.isContinueStatement(body[body.length - 1])) {
      body.pop();
    }
    caseMap.set(key, body);
  }

  // Verify all order entries have corresponding cases
  for (const key of orderArray) {
    if (!caseMap.has(key)) {
      log("Missing case for order key:", key);
      return null;
    }
  }

  // Build sequential statements in order
  const sequential = [];
  for (const key of orderArray) {
    sequential.push(...caseMap.get(key));
  }

  return { sequential, orderNode, indexVarName };
}

/**
 * Check if a loop body matches: { SwitchStatement; BreakStatement; }
 */
function extractSwitchFromBody(body) {
  if (!t.isBlockStatement(body)) return null;
  const stmts = body.body;
  if (stmts.length !== 2) return null;
  if (!t.isSwitchStatement(stmts[0]) || !t.isBreakStatement(stmts[1])) return null;
  return stmts[0];
}

module.exports = {
  name: "controlFlowUnflattening",
  tags: ["unsafe"],

  run(ast, state) {
    let totalChanges = 0;

    traverse(ast, {
      WhileStatement(path) {
        // Test must be `true`
        if (!t.isBooleanLiteral(path.node.test, { value: true })) return;

        const switchNode = extractSwitchFromBody(path.node.body);
        if (!switchNode) return;

        const result = processSwitch(switchNode, path.scope, null);
        if (!result) return;

        const { sequential, orderNode, indexVarName } = result;

        // Collect paths to remove: order array declaration, index variable declaration
        const pathsToRemove = [];
        const orderRemovePath = findOrderRemovePath(orderNode, path.scope);
        if (orderRemovePath) pathsToRemove.push(orderRemovePath);
        const indexInfo = resolveIndexVar(indexVarName, path.scope);
        if (indexInfo) pathsToRemove.push(indexInfo.removePath);

        // Replace the while loop with sequential statements
        path.replaceWithMultiple(sequential);
        totalChanges++;

        // Remove infrastructure declarations
        for (const p of pathsToRemove) {
          if (t.isVariableDeclarator(p.node)) {
            const parent = p.parent;
            if (t.isVariableDeclaration(parent) && parent.declarations.length === 1) {
              p.parentPath.remove();
            } else {
              p.remove();
            }
          } else {
            p.remove();
          }
        }

        log("Unflattened 1 while-switch block into", sequential.length, "statements");
      },

      ForStatement(path) {
        // Test must be `true`
        if (!t.isBooleanLiteral(path.node.test, { value: true })) return;

        const switchNode = extractSwitchFromBody(path.node.body);
        if (!switchNode) return;

        const result = processSwitch(switchNode, path.scope, path.node.init);
        if (!result) return;

        const { sequential, orderNode, indexVarName } = result;

        // For for-loops, order & index are in init — no separate cleanup needed.
        // But still check for external declarations.
        const pathsToRemove = [];
        const orderRemovePath = findOrderRemovePath(orderNode, path.scope);
        if (orderRemovePath) pathsToRemove.push(orderRemovePath);
        const indexInfo = resolveIndexVar(indexVarName, path.scope);
        if (indexInfo) pathsToRemove.push(indexInfo.removePath);

        path.replaceWithMultiple(sequential);
        totalChanges++;

        for (const p of pathsToRemove) {
          if (t.isVariableDeclarator(p.node)) {
            const parent = p.parent;
            if (t.isVariableDeclaration(parent) && parent.declarations.length === 1) {
              p.parentPath.remove();
            } else {
              p.remove();
            }
          } else {
            p.remove();
          }
        }

        log("Unflattened 1 for-switch block into", sequential.length, "statements");
      },
    });

    log("Total changes:", totalChanges);
    state.changes += totalChanges;
  },
};
