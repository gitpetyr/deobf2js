const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const { createLogger } = require("../utils/logger");
const { log } = createLogger("objectProxyInlining");

/**
 * Check if a function node is a simple proxy: single ReturnStatement body.
 * Returns { params, returnExpr } or null.
 */
function extractProxyFunction(node) {
  if (!t.isFunctionExpression(node)) return null;
  const body = node.body.body;
  if (body.length !== 1 || !t.isReturnStatement(body[0])) return null;
  const returnExpr = body[0].argument;
  if (!returnExpr) return null;

  // Only handle: BinaryExpression, LogicalExpression, UnaryExpression, CallExpression
  if (
    !t.isBinaryExpression(returnExpr) &&
    !t.isLogicalExpression(returnExpr) &&
    !t.isUnaryExpression(returnExpr) &&
    !t.isCallExpression(returnExpr)
  ) {
    return null;
  }

  return { params: node.params, returnExpr };
}

/**
 * Substitute parameter identifiers in a cloned expression with argument nodes.
 * Uses a simple recursive walk instead of traverse to avoid stack overflow.
 * paramMap: Map<string, ASTNode>
 */
function substituteParams(expr, paramMap) {
  const cloned = t.cloneDeepWithoutLoc(expr);
  replaceIdents(cloned, paramMap);
  return cloned;
}

function replaceIdents(node, paramMap) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key.startsWith("_")) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        if (child[i] && child[i].type === "Identifier" && paramMap.has(child[i].name)) {
          child[i] = t.cloneDeepWithoutLoc(paramMap.get(child[i].name));
        } else {
          replaceIdents(child[i], paramMap);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      if (child.type === "Identifier" && paramMap.has(child.name)) {
        node[key] = t.cloneDeepWithoutLoc(paramMap.get(child.name));
      } else {
        replaceIdents(child, paramMap);
      }
    }
  }
}

/**
 * Extract all proxy function properties from an object expression.
 */
function extractProxyFunctions(objExpr) {
  const funcMap = new Map();

  for (const prop of objExpr.properties) {
    if (!t.isObjectProperty(prop)) continue;
    if (prop.computed) continue;

    let key;
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      key = prop.key.value;
    } else {
      continue;
    }

    const proxy = extractProxyFunction(prop.value);
    if (!proxy) continue;

    funcMap.set(key, proxy);
  }

  return funcMap;
}

module.exports = {
  name: "objectProxyInlining",
  tags: ["unsafe"],

  run(ast, state) {
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      // Phase 1: Collect all objects with proxy function properties, with position info
      const definitions = [];

      traverse(ast, {
        VariableDeclarator(path) {
          const id = path.node.id;
          if (!t.isIdentifier(id)) return;
          const init = path.node.init;
          if (!init || !t.isObjectExpression(init)) return;

          const funcMap = extractProxyFunctions(init);
          if (funcMap.size === 0) return;

          definitions.push({
            name: id.name,
            funcMap,
            start: path.node.start,
            end: Infinity,
          });
        },
        AssignmentExpression(path) {
          if (path.node.operator !== "=") return;
          const left = path.node.left;
          const right = path.node.right;
          if (!t.isIdentifier(left)) return;
          if (!right || !t.isObjectExpression(right)) return;

          const funcMap = extractProxyFunctions(right);
          if (funcMap.size === 0) return;

          definitions.push({
            name: left.name,
            funcMap,
            start: path.node.start,
            end: Infinity,
          });
        },
      });

      if (definitions.length === 0) break;

      // Phase 2: Collect ALL assignments to each variable name (for invalidation)
      const assignmentPositions = new Map(); // name -> sorted [start]

      traverse(ast, {
        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const name = path.node.id.name;
          if (!assignmentPositions.has(name)) assignmentPositions.set(name, []);
          assignmentPositions.get(name).push(path.node.start);
        },
        AssignmentExpression(path) {
          if (path.node.operator !== "=") return;
          if (!t.isIdentifier(path.node.left)) return;
          const name = path.node.left.name;
          if (!assignmentPositions.has(name)) assignmentPositions.set(name, []);
          assignmentPositions.get(name).push(path.node.start);
        },
      });

      for (const positions of assignmentPositions.values()) {
        positions.sort((a, b) => a - b);
      }

      // Phase 3: Compute validity range for each definition
      for (const def of definitions) {
        const positions = assignmentPositions.get(def.name) || [];
        for (const pos of positions) {
          if (pos > def.start) {
            def.end = pos;
            break;
          }
        }
      }

      log("Pass", pass, ": found", definitions.length, "objects with proxy functions");

      // Phase 4: Replace obj.key(args) / obj['key'](args) with inlined expressions
      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee;
          if (!t.isMemberExpression(callee)) return;
          if (!t.isIdentifier(callee.object)) return;

          // Resolve position: try node itself, then walk up parents for cloned nodes
          let refPos = path.node.start;
          if (refPos === undefined) {
            let pp = path.parentPath;
            while (pp && pp.node && pp.node.start === undefined) pp = pp.parentPath;
            if (pp && pp.node) refPos = pp.node.start;
          }

          const varName = callee.object.name;

          // Find the most recent applicable definition
          let bestDef = null;
          if (refPos !== undefined) {
            for (const def of definitions) {
              if (def.name !== varName) continue;
              if (def.start >= refPos) continue;
              if (refPos >= def.end) continue;
              if (!bestDef || def.start > bestDef.start) {
                bestDef = def;
              }
            }
          } else {
            // No position available: only safe if there's exactly one definition for this name
            const matching = definitions.filter(d => d.name === varName);
            if (matching.length === 1) bestDef = matching[0];
          }

          if (!bestDef) return;

          // Resolve property key
          let key = null;
          if (!callee.computed && t.isIdentifier(callee.property)) {
            key = callee.property.name;
          } else if (callee.computed && t.isStringLiteral(callee.property)) {
            key = callee.property.value;
          }
          if (key === null) return;

          const proxy = bestDef.funcMap.get(key);
          if (!proxy) return;

          // Verify argument count matches parameter count
          if (path.node.arguments.length !== proxy.params.length) return;

          // Build param -> arg mapping
          const paramMap = new Map();
          for (let i = 0; i < proxy.params.length; i++) {
            const param = proxy.params[i];
            if (!t.isIdentifier(param)) return;
            paramMap.set(param.name, path.node.arguments[i]);
          }

          // Substitute and replace
          const result = substituteParams(proxy.returnExpr, paramMap);
          path.replaceWith(result);
          changes++;
        },
      });

      log("Pass", pass, ":", changes, "inlines");
      totalChanges += changes;
      if (changes === 0) break;

      // Refresh scopes
      traverse(ast, {
        Program(path) {
          path.scope.crawl();
        },
      });
    }

    log("Total changes:", totalChanges, "in", pass, "passes");
    state.changes += totalChanges;
  },
};
