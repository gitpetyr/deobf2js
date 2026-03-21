const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[taintAnalysis] " + args.join(" ") + "\n");
}

/**
 * Check if an expression subtree references any name in the given set.
 */
function referencesAny(node, names) {
  if (!node) return false;
  if (t.isIdentifier(node) && names.has(node.name)) return true;
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && c.type && referencesAny(c, names)) return true;
      }
    } else if (child && child.type && referencesAny(child, names)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the full set of tainted variable names by propagating from seed names.
 *
 * Algorithm:
 * 1. Collect all assignment-like edges (var x = <expr>, x = <expr>)
 * 2. Initialize tainted set with preserve names
 * 3. Iteratively propagate: if RHS references a tainted name, LHS becomes tainted
 * 4. Repeat until fixed point
 *
 * @param {Object} ast - Babel AST
 * @param {Set<string>} preserveNames - user-specified seed variable names
 * @returns {Set<string>} - full set of tainted variable names
 */
function computeTaintedNames(ast, preserveNames) {
  if (!preserveNames || preserveNames.size === 0) return new Set();

  const tainted = new Set(preserveNames);

  // Collect all assignment edges: { target: string, rhsNode: Node }
  const edges = [];
  traverse(ast, {
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (t.isIdentifier(id) && init) {
        edges.push({ target: id.name, rhs: init });
      }
    },
    AssignmentExpression(path) {
      if (path.node.operator === "=" && t.isIdentifier(path.node.left)) {
        edges.push({ target: path.node.left.name, rhs: path.node.right });
      }
    },
  });

  log("Collected", edges.length, "assignment edges");
  log("Initial tainted:", [...tainted].join(", "));

  // Iterate until fixed point
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (tainted.has(edge.target)) continue;
      if (referencesAny(edge.rhs, tainted)) {
        tainted.add(edge.target);
        changed = true;
      }
    }
  }

  log("Final tainted set (" + tainted.size + "):", [...tainted].join(", "));
  return tainted;
}

module.exports = { computeTaintedNames, referencesAny };
