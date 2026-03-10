const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[objectProxyInlining] " + args.join(" ") + "\n");
}

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

function objectProxyInlining(ast) {
  let totalChanges = 0;
  let pass = 0;

  while (true) {
    pass++;
    let changes = 0;

    // Collect objects with proxy function properties
    const proxyMaps = new Map(); // varName -> Map<propKey, { params, returnExpr }>

    traverse(ast, {
      VariableDeclarator(path) {
        const id = path.node.id;
        if (!t.isIdentifier(id)) return;
        const init = path.node.init;
        if (!init || !t.isObjectExpression(init)) return;

        const funcMap = extractProxyFunctions(init);
        if (funcMap.size === 0) return;

        proxyMaps.set(id.name, funcMap);
      },
      AssignmentExpression(path) {
        if (path.node.operator !== "=") return;
        const left = path.node.left;
        const right = path.node.right;
        if (!t.isIdentifier(left)) return;
        if (!right || !t.isObjectExpression(right)) return;

        const funcMap = extractProxyFunctions(right);
        if (funcMap.size === 0) return;

        proxyMaps.set(left.name, funcMap);
      },
    });

    if (proxyMaps.size === 0) break;
    log("Pass", pass, ": found", proxyMaps.size, "objects with proxy functions");

    // Replace obj.key(args) / obj['key'](args) with inlined expressions
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.object)) return;

        const entry = proxyMaps.get(callee.object.name);
        if (!entry) return;

        // Resolve property key
        let key = null;
        if (!callee.computed && t.isIdentifier(callee.property)) {
          key = callee.property.name;
        } else if (callee.computed && t.isStringLiteral(callee.property)) {
          key = callee.property.value;
        }
        if (key === null) return;

        const proxy = entry.get(key);
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
  }

  log("Total changes:", totalChanges, "in", pass, "passes");
  return totalChanges;
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

module.exports = objectProxyInlining;
