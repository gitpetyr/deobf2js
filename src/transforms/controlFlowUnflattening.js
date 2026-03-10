const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[controlFlowUnflattening] " + args.join(" ") + "\n");
}

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
    if (binding && binding.path.isVariableDeclarator() && binding.path.node.init) {
      return resolveOrderArray(binding.path.node.init, binding.scope);
    }
  }

  return null;
}

/**
 * Try to resolve the index variable init value and find its declaration path.
 * Returns { initValue, declarationPath } or null.
 */
function resolveIndexVar(name, scope) {
  const binding = scope.getBinding(name);
  if (!binding || !binding.path.isVariableDeclarator()) return null;

  const init = binding.path.node.init;
  if (!init) return null;

  if (t.isNumericLiteral(init) && init.value === 0) {
    return { initValue: 0, declarationPath: binding.path };
  }

  return null;
}

function controlFlowUnflattening(ast) {
  let totalChanges = 0;

  traverse(ast, {
    WhileStatement(path) {
      // Test must be `true`
      if (!t.isBooleanLiteral(path.node.test, { value: true })) return;

      const whileBody = path.node.body;
      if (!t.isBlockStatement(whileBody)) return;

      const stmts = whileBody.body;
      // Body: SwitchStatement followed by BreakStatement
      if (stmts.length !== 2) return;
      if (!t.isSwitchStatement(stmts[0]) || !t.isBreakStatement(stmts[1])) return;

      const switchNode = stmts[0];

      // Discriminant must be order[idx++] — a MemberExpression with UpdateExpression
      const disc = switchNode.discriminant;
      if (!t.isMemberExpression(disc) || !disc.computed) return;

      // Property: idx++ (UpdateExpression with ++ postfix)
      const prop = disc.property;
      if (!t.isUpdateExpression(prop) || prop.operator !== "++" || !prop.prefix) {
        if (!t.isUpdateExpression(prop) || prop.operator !== "++" || prop.prefix) {
          // Accept both prefix and postfix
          if (!t.isUpdateExpression(prop) || prop.operator !== "++") return;
        }
      }
      if (!t.isIdentifier(prop.argument)) return;
      const indexVarName = prop.argument.name;

      // Object: the order array variable
      const orderNode = disc.object;

      // Resolve the order array
      const orderArray = resolveOrderArray(orderNode, path.scope);
      if (!orderArray || orderArray.length === 0) {
        log("Could not resolve order array");
        return;
      }
      log("Order array:", orderArray.join(", "));

      // Build case map: caseValue -> [statements]
      const caseMap = new Map();
      for (const caseClause of switchNode.cases) {
        if (!caseClause.test || !t.isStringLiteral(caseClause.test)) return;
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
          return;
        }
      }

      // Build sequential statements in order
      const sequential = [];
      for (const key of orderArray) {
        sequential.push(...caseMap.get(key));
      }

      // Collect paths to remove: order array declaration, index variable declaration
      const pathsToRemove = [];

      // Try to find and remove the order array declaration
      if (t.isIdentifier(orderNode)) {
        const orderBinding = path.scope.getBinding(orderNode.name);
        if (orderBinding && orderBinding.path.isVariableDeclarator()) {
          pathsToRemove.push(orderBinding.path);
        }
      }

      // Try to find and remove the index variable declaration
      const indexInfo = resolveIndexVar(indexVarName, path.scope);
      if (indexInfo) {
        pathsToRemove.push(indexInfo.declarationPath);
      }

      // Replace the while loop with sequential statements
      path.replaceWithMultiple(sequential);
      totalChanges++;

      // Remove infrastructure declarations
      for (const p of pathsToRemove) {
        const parent = p.parent;
        if (t.isVariableDeclaration(parent) && parent.declarations.length === 1) {
          p.parentPath.remove();
        } else {
          p.remove();
        }
      }

      log("Unflattened 1 while-switch block into", sequential.length, "statements");
    },
  });

  log("Total changes:", totalChanges);
  return totalChanges;
}

module.exports = controlFlowUnflattening;
