const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const { tryEvaluate, valueToNode } = require("./constantFolding");
const { createSandboxInstance } = require("../utils/sandbox");
const { referencesAny } = require("../utils/taintAnalysis");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("pureFunctionEvaluation");

const SIDE_EFFECT_OBJECTS = new Set([
  "console", "document", "window", "fetch", "XMLHttpRequest",
  "localStorage", "sessionStorage", "indexedDB",
  "fs", "process", "require", "import",
]);

const PURE_GLOBALS = new Set([
  "Math", "String", "Number", "Boolean", "parseInt", "parseFloat",
  "atob", "btoa", "decodeURIComponent", "encodeURIComponent",
  "isNaN", "isFinite",
]);

function isPureFunction(funcNode, funcPath) {
  let pure = true;

  funcPath.traverse({
    CallExpression(callPath) {
      if (!pure) return;
      const callee = callPath.node.callee;
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
        if (SIDE_EFFECT_OBJECTS.has(callee.object.name)) {
          pure = false;
          return;
        }
      }
      if (t.isIdentifier(callee) && SIDE_EFFECT_OBJECTS.has(callee.name)) {
        pure = false;
        return;
      }
    },
    AssignmentExpression(assignPath) {
      if (!pure) return;
      const left = assignPath.node.left;
      if (t.isIdentifier(left)) {
        const binding = assignPath.scope.getBinding(left.name);
        if (!binding || (binding.scope.path !== funcPath && !binding.scope.path.isDescendant(funcPath))) {
          pure = false;
        }
      }
      if (t.isMemberExpression(left)) {
        if (t.isIdentifier(left.object)) {
          const binding = assignPath.scope.getBinding(left.object.name);
          if (!binding || (binding.scope.path !== funcPath && !binding.scope.path.isDescendant(funcPath))) {
            pure = false;
          }
        }
      }
    },
    UpdateExpression(updatePath) {
      if (!pure) return;
      const arg = updatePath.node.argument;
      if (t.isIdentifier(arg)) {
        const binding = updatePath.scope.getBinding(arg.name);
        if (!binding || (binding.scope.path !== funcPath && !binding.scope.path.isDescendant(funcPath))) {
          pure = false;
        }
      }
    },
    Identifier(idPath) {
      if (!pure) return;
      if (idPath.parentPath.isMemberExpression() && idPath.parentPath.node.property === idPath.node && !idPath.parentPath.node.computed) return;
      if (idPath.parentPath.isVariableDeclarator() && idPath.parentPath.node.id === idPath.node) return;
      if (idPath.listKey === "params") return;

      const name = idPath.node.name;
      const binding = idPath.scope.getBinding(name);
      if (!binding) {
        if (!PURE_GLOBALS.has(name) && name !== "undefined" && name !== "NaN" && name !== "Infinity") {
          if (!funcNode.params.some(p => t.isIdentifier(p) && p.name === name)) {
            pure = false;
          }
        }
        return;
      }
      if (binding.scope.path !== funcPath && !binding.scope.path.isDescendant(funcPath) && binding.scope !== funcPath.scope) {
        if (!binding.constant) {
          pure = false;
        }
      }
    },
    ThisExpression() { pure = false; },
    FunctionDeclaration(path) { path.skip(); },
    FunctionExpression(path) { path.skip(); },
    ArrowFunctionExpression(path) { path.skip(); },
  });

  return pure;
}

function allArgsLiteral(args) {
  return args.every((arg) => {
    if (t.isNumericLiteral(arg) || t.isStringLiteral(arg) || t.isBooleanLiteral(arg) || t.isNullLiteral(arg)) return true;
    if (t.isUnaryExpression(arg, { operator: "-" }) && t.isNumericLiteral(arg.argument)) return true;
    if (t.isUnaryExpression(arg, { operator: "!" }) && t.isBooleanLiteral(arg.argument)) return true;
    return false;
  });
}

function isSingleReturnPure(funcNode) {
  if (!t.isBlockStatement(funcNode.body)) return false;
  const stmts = funcNode.body.body;
  if (stmts.length !== 1 || !t.isReturnStatement(stmts[0]) || !stmts[0].argument) return false;
  return true;
}

function tryStaticEval(funcNode, args) {
  if (!isSingleReturnPure(funcNode)) return null;

  const paramNames = funcNode.params.map((p) => p.name);
  const paramMap = new Map();
  for (let i = 0; i < paramNames.length; i++) {
    paramMap.set(paramNames[i], args[i] || t.identifier("undefined"));
  }

  const expr = t.cloneDeep(funcNode.body.body[0].argument);
  substituteIdentifiers(expr, paramMap);

  const result = tryEvaluate(expr);
  if (result === null) return null;
  if (typeof result.value === "number" && (Number.isNaN(result.value) || !Number.isFinite(result.value))) return null;

  const node = valueToNode(result.value);
  return node;
}

function substituteIdentifiers(node, paramMap) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key.startsWith("_")) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        if (t.isIdentifier(child[i]) && paramMap.has(child[i].name)) {
          child[i] = t.cloneDeep(paramMap.get(child[i].name));
        } else {
          substituteIdentifiers(child[i], paramMap);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      if (t.isIdentifier(child) && paramMap.has(child.name)) {
        node[key] = t.cloneDeep(paramMap.get(child.name));
      } else {
        substituteIdentifiers(child, paramMap);
      }
    }
  }
}

function resultToNode(value) {
  if (value === null) return t.nullLiteral();
  if (value === undefined) return t.identifier("undefined");
  if (typeof value === "boolean") return t.booleanLiteral(value);
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    if (value < 0) return t.unaryExpression("-", t.numericLiteral(-value));
    return t.numericLiteral(value);
  }
  if (typeof value === "string") return t.stringLiteral(value);
  if (value instanceof RegExp) return t.regExpLiteral(value.source, value.flags);
  if (typeof value === "symbol" || typeof value === "function") return null;
  if (Array.isArray(value)) {
    const elems = value.map(resultToNode);
    if (elems.some((e) => e === null)) return null;
    return t.arrayExpression(elems);
  }
  if (typeof value === "object") {
    try { JSON.stringify(value); } catch { return null; }
    const props = Object.entries(value).map(([k, v]) => {
      const valNode = resultToNode(v);
      if (valNode === null) return null;
      return t.objectProperty(t.stringLiteral(k), valNode);
    });
    if (props.some((p) => p === null)) return null;
    return t.objectExpression(props);
  }
  return null;
}

module.exports = {
  name: "pureFunctionEvaluation",
  tags: ["unsafe"],
  async run(ast, state, options = {}) {
    const taintedNames = options.taintedNames || new Set();
    const sandboxType = options.sandboxType;
    let totalChanges = 0;

    // Phase 1: Collect candidate function definitions
    const funcDefs = new Map();

    traverse(ast, {
      FunctionDeclaration(path) {
        const name = path.node.id && path.node.id.name;
        if (!name || taintedNames.has(name)) return;
        funcDefs.set(name, { path, funcNode: path.node });
      },
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id)) return;
        const init = path.node.init;
        if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;
        const name = path.node.id.name;
        if (taintedNames.has(name)) return;
        funcDefs.set(name, { path, funcNode: init });
      },
    });

    // Phase 2: Try AST static evaluation, collect sandbox candidates
    const sandboxCandidates = [];

    traverse(ast, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee)) return;
        const name = path.node.callee.name;
        const def = funcDefs.get(name);
        if (!def) return;

        const args = path.node.arguments;
        if (!allArgsLiteral(args)) return;

        if (taintedNames.size > 0 && args.some(arg => referencesAny(arg, taintedNames))) return;

        const staticResult = tryStaticEval(def.funcNode, args);
        if (staticResult) {
          path.replaceWith(staticResult);
          totalChanges++;
          return;
        }

        if (sandboxType && isPureFunction(def.funcNode, def.path)) {
          sandboxCandidates.push({ callPath: path, def, args });
        }
      },
    });

    // Phase 3: Sandbox execution
    if (sandboxCandidates.length > 0 && sandboxType) {
      log("Evaluating", sandboxCandidates.length, "candidates via sandbox (type:", sandboxType + ")");
      const sandbox = await createSandboxInstance(sandboxType);
      try {
        for (const { callPath, def, args } of sandboxCandidates) {
          if (!callPath.node) continue;
          try {
            const funcCode = generate(def.funcNode.type === "FunctionDeclaration" ? def.funcNode : t.functionDeclaration(t.identifier("__fn"), def.funcNode.params, def.funcNode.body)).code;
            const fnName = def.funcNode.type === "FunctionDeclaration" ? def.funcNode.id.name : "__fn";
            const argsStr = args.map((a) => generate(a).code).join(", ");
            const code = funcCode + "\n" + fnName + "(" + argsStr + ")";

            const result = await sandbox.execute(code);
            const node = resultToNode(result);
            if (node) {
              callPath.replaceWith(node);
              totalChanges++;
            }
          } catch (err) {
            log("Sandbox evaluation failed:", err.message);
          }
        }
      } finally {
        await sandbox.close();
      }
    }

    log(totalChanges, "calls evaluated");
    state.changes += totalChanges;
  },
};
