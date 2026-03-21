const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose)
    process.stderr.write("[deadCodeElimination] " + args.join(" ") + "\n");
}

// Check if an AST node references a given identifier name
function referencesName(node, name) {
  if (!node) return false;
  if (t.isIdentifier(node) && node.name === name) return true;
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && c.type && referencesName(c, name)) return true;
      }
    } else if (child && child.type && referencesName(child, name)) {
      return true;
    }
  }
  return false;
}

// Check if an AST node is free of side effects
function isPure(node) {
  if (!node) return true;
  if (t.isLiteral(node)) return true;
  if (t.isIdentifier(node)) return true;
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node))
    return true;
  if (t.isObjectExpression(node)) {
    return node.properties.every((p) => {
      if (t.isSpreadElement(p)) return false;
      if (t.isObjectMethod(p)) return true;
      return isPure(p.key) && isPure(p.value);
    });
  }
  if (t.isArrayExpression(node)) {
    return node.elements.every((e) => e === null || isPure(e));
  }
  if (t.isUnaryExpression(node) && node.operator !== "delete")
    return isPure(node.argument);
  if (t.isBinaryExpression(node) || t.isLogicalExpression(node))
    return isPure(node.left) && isPure(node.right);
  if (t.isConditionalExpression(node))
    return isPure(node.test) && isPure(node.consequent) && isPure(node.alternate);
  if (t.isTemplateLiteral(node))
    return node.expressions.every((e) => isPure(e));
  return false;
}

function deadCodeElimination(ast, consumedPaths, taintedNames) {
  taintedNames = taintedNames || new Set();
  let removedCount = 0;

  // Collect consumed node names so Step 2 only removes related infrastructure
  const consumedNames = new Set();
  for (const p of consumedPaths) {
    const node = p.node;
    if (t.isFunctionDeclaration(node) && node.id) {
      consumedNames.add(node.id.name);
    } else if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (t.isIdentifier(d.id)) consumedNames.add(d.id.name);
      }
    }
  }

  // Step 1: Remove consumed paths (string arrays, wrappers, shuffle IIFEs, decoders)
  const consumedSet = new Set(consumedPaths.map((p) => p.node));
  traverse(ast, {
    enter(path) {
      if (consumedSet.has(path.node)) {
        path.remove();
        removedCount++;
      }
    },
  });
  log("Removed", removedCount, "consumed nodes");

  // Refresh bindings after removal
  traverse(ast, {
    Program(path) {
      path.scope.crawl();
    },
  });

  // Step 2: Remove unreferenced declarations only if they referenced consumed infrastructure
  // This avoids deleting user code that happens to be unreferenced (e.g. exported functions)
  let deadCount = 0;
  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id.name;
      if (taintedNames.has(name)) return;
      const binding = path.scope.getBinding(name);
      if (!binding || binding.referencePaths.length > 0) return;
      // Only remove if the function body referenced a consumed name
      const refsConsumed = [...consumedNames].some((n) => referencesName(path.node, n));
      if (refsConsumed) {
        path.remove();
        deadCount++;
      }
    },
    VariableDeclaration(path) {
      const declarators = path.get("declarations");
      let allDead = true;

      for (const declarator of declarators) {
        if (!t.isIdentifier(declarator.node.id)) {
          allDead = false;
          continue;
        }
        // Skip tainted variables
        if (taintedNames.has(declarator.node.id.name)) {
          allDead = false;
          continue;
        }
        const binding = path.scope.getBinding(declarator.node.id.name);
        if (!binding || binding.referencePaths.length > 0) {
          allDead = false;
          continue;
        }
        // Only count as dead if it referenced consumed infrastructure
        const refsConsumed = [...consumedNames].some((n) => referencesName(declarator.node, n));
        if (!refsConsumed) {
          allDead = false;
        }
      }

      if (allDead) {
        path.remove();
        deadCount++;
      }
    },
  });

  log("Removed", deadCount, "unreferenced declarations");

  // Step 3: Dead store elimination inside function bodies (not top-level)
  // Iterative — removing one dead store may expose others (e.g. O = U; then U = {...})
  let deadStoreCount = 0;
  let dsChanged = true;
  while (dsChanged) {
    dsChanged = false;

    traverse(ast, {
      Program(path) {
        path.scope.crawl();
      },
    });

    traverse(ast, {
      // Remove: ExpressionStatement { x = <pure>; } where x is never read
      ExpressionStatement(path) {
        if (!path.getFunctionParent()) return;

        const expr = path.node.expression;
        if (!t.isAssignmentExpression(expr) || expr.operator !== "=") return;
        if (!t.isIdentifier(expr.left)) return;

        const name = expr.left.name;
        const binding = path.scope.getBinding(name);
        if (!binding) return;

        // Only handle bindings local to the enclosing function
        const funcParent = path.getFunctionParent();
        if (binding.scope !== funcParent.scope) return;

        if (binding.referencePaths.length > 0) return;
        if (!isPure(expr.right)) return;

        log("Removing dead store:", name);
        path.remove();
        deadStoreCount++;
        dsChanged = true;
      },

      // Remove: var/let/const x = <pure>; where x is never read or reassigned
      VariableDeclarator(path) {
        if (!path.getFunctionParent()) return;
        if (!t.isIdentifier(path.node.id)) return;

        const name = path.node.id.name;
        const binding = path.scope.getBinding(name);
        if (!binding) return;

        const funcParent = path.getFunctionParent();
        if (binding.scope !== funcParent.scope) return;

        if (binding.referencePaths.length > 0) return;
        if (binding.constantViolations.length > 0) return;

        if (path.node.init && !isPure(path.node.init)) return;

        log("Removing dead variable:", name);
        const declaration = path.parentPath;
        if (
          t.isVariableDeclaration(declaration.node) &&
          declaration.node.declarations.length === 1
        ) {
          declaration.remove();
        } else {
          path.remove();
        }
        deadStoreCount++;
        dsChanged = true;
      },
    });
  }

  log("Removed", deadStoreCount, "dead stores");
  return removedCount + deadCount + deadStoreCount;
}

module.exports = deadCodeElimination;
