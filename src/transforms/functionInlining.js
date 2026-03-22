const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("functionInlining");

const MAX_CALL_SITES_UNCONDITIONAL = 5;
const MAX_STATEMENTS_SMALL = 3;

/**
 * Check if function contains unsafe keywords (this, arguments, yield, await)
 */
function hasUnsafeKeywords(funcNode) {
  let found = false;
  traverse(
    t.file(t.program([t.isBlockStatement(funcNode.body)
      ? funcNode.body
      : t.expressionStatement(funcNode.body)
    ])),
    {
      ThisExpression() { found = true; },
      Identifier(path) {
        if (path.node.name === "arguments") {
          found = true;
        }
      },
      YieldExpression() { found = true; },
      AwaitExpression() { found = true; },
      FunctionDeclaration(path) { path.skip(); },
      FunctionExpression(path) { path.skip(); },
      ArrowFunctionExpression(path) { path.skip(); },
    },
    undefined,
    { noScope: true }
  );
  return found;
}

/**
 * Check if function has complex params (defaults, rest, destructured)
 */
function hasComplexParams(funcNode) {
  return funcNode.params.some((p) => !t.isIdentifier(p));
}

/**
 * Check if function body references its own name (recursive)
 */
function isRecursive(funcName, funcNode) {
  let recursive = false;
  traverse(
    t.file(t.program([funcNode.body])),
    {
      Identifier(path) {
        if (path.node.name === funcName) recursive = true;
      },
      FunctionDeclaration(path) { path.skip(); },
      FunctionExpression(path) { path.skip(); },
      ArrowFunctionExpression(path) { path.skip(); },
    },
    undefined,
    { noScope: true }
  );
  return recursive;
}

/**
 * Check if function references external mutable bindings.
 * Global references (Math, console) do not block inlining.
 */
function hasExternalMutableRefs(funcPath) {
  let hasMutable = false;
  funcPath.traverse({
    Identifier(idPath) {
      if (hasMutable) return;
      if (idPath.parentPath.isMemberExpression() && idPath.parentPath.node.property === idPath.node && !idPath.parentPath.node.computed) return;
      if (idPath.listKey === "params") return;
      if (idPath.parentPath.isVariableDeclarator() && idPath.parentPath.node.id === idPath.node) return;
      if (idPath.parentPath.isFunctionDeclaration() && idPath.parentPath.node.id === idPath.node) return;

      const name = idPath.node.name;
      const binding = idPath.scope.getBinding(name);
      if (!binding) return; // global, allow
      const funcScope = funcPath.scope;
      if (binding.scope === funcScope || binding.scope.path.isDescendant(funcPath)) return;
      if (!binding.constant) {
        hasMutable = true;
      }
    },
  });
  return hasMutable;
}

/**
 * Check if expression is side-effect-free
 */
function isPureExpression(node) {
  if (t.isLiteral(node)) return true;
  if (t.isIdentifier(node)) return true;
  if (t.isUnaryExpression(node) && node.operator !== "delete") return isPureExpression(node.argument);
  if (t.isBinaryExpression(node)) return isPureExpression(node.left) && isPureExpression(node.right);
  if (t.isMemberExpression(node)) return isPureExpression(node.object) && (node.computed ? isPureExpression(node.property) : true);
  return false;
}

/**
 * Substitute params with args in a cloned node
 */
function substituteParams(node, paramMap) {
  const cloned = t.cloneDeep(node);
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
        if (t.isIdentifier(child[i]) && paramMap.has(child[i].name)) {
          child[i] = t.cloneDeep(paramMap.get(child[i].name));
        } else {
          replaceIdents(child[i], paramMap);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      if (t.isIdentifier(child) && paramMap.has(child.name)) {
        node[key] = t.cloneDeep(paramMap.get(child.name));
      } else {
        replaceIdents(child, paramMap);
      }
    }
  }
}

/**
 * Count how many times each param is referenced in the function body
 */
function countParamRefs(funcBody, paramNames) {
  const counts = new Map();
  for (const name of paramNames) counts.set(name, 0);

  traverse(
    t.file(t.program([funcBody])),
    {
      Identifier(path) {
        if (counts.has(path.node.name)) {
          counts.set(path.node.name, counts.get(path.node.name) + 1);
        }
      },
      FunctionDeclaration(path) { path.skip(); },
      FunctionExpression(path) { path.skip(); },
      ArrowFunctionExpression(path) { path.skip(); },
    },
    undefined,
    { noScope: true }
  );
  return counts;
}

module.exports = {
  name: "functionInlining",
  tags: ["unsafe"],
  run(ast, state, options = {}) {
    const taintedNames = options.taintedNames || new Set();
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      // Phase 1: Collect all function definitions
      const funcDefs = new Map();

      traverse(ast, {
        FunctionDeclaration(path) {
          const name = path.node.id && path.node.id.name;
          if (!name) return;
          if (taintedNames.has(name)) return;
          funcDefs.set(name, { path, funcNode: path.node, callSites: [] });
        },
        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const init = path.node.init;
          if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;
          const name = path.node.id.name;
          if (taintedNames.has(name)) return;
          funcDefs.set(name, { path, funcNode: init, callSites: [] });
        },
      });

      // Phase 2: Collect call sites
      traverse(ast, {
        CallExpression(path) {
          if (!t.isIdentifier(path.node.callee)) return;
          const name = path.node.callee.name;
          const def = funcDefs.get(name);
          if (def) def.callSites.push(path);
        },
      });

      // Phase 3: Inline eligible functions
      for (const [name, def] of funcDefs) {
        const { funcNode, callSites } = def;
        if (callSites.length === 0) continue;

        // Safety checks
        if (hasComplexParams(funcNode)) continue;
        if (hasUnsafeKeywords(funcNode)) continue;
        if (isRecursive(name, funcNode)) continue;
        if (hasExternalMutableRefs(def.path)) continue;

        const body = funcNode.body;
        if (!t.isBlockStatement(body)) continue;

        const stmts = body.body;
        const callCount = callSites.length;

        const isSmall = stmts.length <= MAX_STATEMENTS_SMALL;
        if (callCount > MAX_CALL_SITES_UNCONDITIONAL && !isSmall) continue;

        const isSingleReturn = stmts.length === 1 && t.isReturnStatement(stmts[0]) && stmts[0].argument;

        const paramNames = funcNode.params.map((p) => p.name);
        const paramRefCounts = countParamRefs(body, paramNames);

        // Check for unsafe args (side-effectful arg mapped to multiply-referenced param)
        let unsafeArgs = false;
        for (const callPath of callSites) {
          const args = callPath.node.arguments;
          for (let i = 0; i < paramNames.length; i++) {
            const arg = args[i];
            if (!arg) continue;
            const refCount = paramRefCounts.get(paramNames[i]) || 0;
            if (refCount > 1 && !isPureExpression(arg)) {
              unsafeArgs = true;
              break;
            }
          }
          if (unsafeArgs) break;
        }
        if (unsafeArgs) continue;

        // Perform inlining
        let inlinedAny = false;
        for (const callPath of callSites) {
          if (!callPath.node) continue;
          const args = callPath.node.arguments;
          const paramMap = new Map();
          for (let i = 0; i < paramNames.length; i++) {
            paramMap.set(paramNames[i], args[i] || t.identifier("undefined"));
          }

          if (isSingleReturn) {
            const replaced = substituteParams(stmts[0].argument, paramMap);
            callPath.replaceWith(replaced);
            inlinedAny = true;
          } else {
            const parent = callPath.parentPath;
            let insertionPath = null;
            let resultTarget = null;

            if (parent.isExpressionStatement()) {
              insertionPath = parent;
            } else if (parent.isVariableDeclarator() && parent.parentPath.isVariableDeclaration()) {
              insertionPath = parent.parentPath;
              resultTarget = parent.node.id;
            } else {
              continue;
            }

            const newStmts = [];
            for (let i = 0; i < stmts.length; i++) {
              const stmt = stmts[i];
              if (t.isReturnStatement(stmt)) {
                if (stmt.argument && resultTarget) {
                  const assignment = t.expressionStatement(
                    t.assignmentExpression("=", t.cloneDeep(resultTarget), substituteParams(stmt.argument, paramMap))
                  );
                  newStmts.push(assignment);
                }
              } else {
                newStmts.push(substituteParams(stmt, paramMap));
              }
            }

            if (resultTarget) {
              insertionPath.replaceWithMultiple([
                t.variableDeclaration("var", [t.variableDeclarator(t.cloneDeep(resultTarget))]),
                ...newStmts,
              ]);
            } else {
              insertionPath.replaceWithMultiple(newStmts);
            }
            inlinedAny = true;
          }
        }

        if (inlinedAny) {
          changes++;
        }
      }

      if (changes > 0) {
        traverse(ast, {
          Program(path) { path.scope.crawl(); },
        });
      }

      totalChanges += changes;
      log("Pass", pass, ":", changes, "functions inlined");
      if (changes === 0) break;
    }

    state.changes += totalChanges;
  },
};
