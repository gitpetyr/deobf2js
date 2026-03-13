const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

const GLOBAL_BUILTINS = new Set([
  "console", "Math", "JSON", "Object", "Array", "String", "Number",
  "Boolean", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "Map", "Set", "WeakMap", "WeakSet",
  "Promise", "Symbol", "Proxy", "Reflect", "parseInt", "parseFloat",
  "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "eval", "undefined", "NaN", "Infinity",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "globalThis", "window", "document", "navigator", "location",
  "fetch", "XMLHttpRequest", "URL", "URLSearchParams",
  "atob", "btoa", "crypto", "performance",
]);

/**
 * Extract functions from the AST with their external dependencies and callees.
 * @param {import("@babel/types").File} ast
 * @returns {Array<{ path: any, name: string, code: string, node: any, externalDeps: string[], callees: Array<{ name: string, snippet: string }> }>}
 */
function extractFunctions(ast) {
  const functions = [];

  // First pass: collect all top-level function declarations and their code
  const topLevelFunctions = new Map();
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parent === ast.program || t.isProgram(path.parent)) {
        const name = path.node.id ? path.node.id.name : null;
        if (name) {
          topLevelFunctions.set(name, path);
        }
      }
    },
    VariableDeclarator(path) {
      const parentDecl = path.parentPath;
      if (
        parentDecl &&
        parentDecl.parent === ast.program ||
        (parentDecl && t.isProgram(parentDecl.parent))
      ) {
        if (
          t.isIdentifier(path.node.id) &&
          (t.isFunctionExpression(path.node.init) ||
            t.isArrowFunctionExpression(path.node.init))
        ) {
          topLevelFunctions.set(path.node.id.name, path);
        }
      }
    },
  });

  // Second pass: extract each function with analysis
  traverse(ast, {
    FunctionDeclaration(path) {
      processFunction(path, path.node.id ? path.node.id.name : "anonymous", path.node);
    },
    VariableDeclarator(path) {
      if (
        t.isIdentifier(path.node.id) &&
        (t.isFunctionExpression(path.node.init) ||
          t.isArrowFunctionExpression(path.node.init))
      ) {
        processFunction(path, path.node.id.name, path.node.init);
      }
    },
  });

  function processFunction(path, name, fnNode) {
    const code = generate(
      t.isFunctionDeclaration(fnNode) ? fnNode : path.parent
    ).code;

    // Filter by line count
    const lines = code.split("\n").length;
    if (lines < 3 || lines > 200) return;

    // Scope analysis: find external references
    const externalDeps = [];
    const calleeNames = new Set();

    const fnScope = t.isFunctionDeclaration(fnNode)
      ? path.scope
      : (path.get("init") && path.get("init").scope) || path.scope;

    // Collect identifiers referenced but not defined within the function
    const innerPath = t.isFunctionDeclaration(fnNode)
      ? path
      : path.get("init");

    if (!innerPath || !innerPath.node) return;

    innerPath.traverse({
      ReferencedIdentifier(refPath) {
        const refName = refPath.node.name;

        // Skip if it's the function's own name
        if (refName === name) return;

        // Skip if defined within the function scope
        const binding = refPath.scope.getBinding(refName);
        if (binding) {
          // Check if the binding is inside the function
          let current = binding.scope;
          while (current) {
            if (current === fnScope) return; // defined inside function
            current = current.parent;
          }
        }

        // Skip globals
        if (GLOBAL_BUILTINS.has(refName)) return;

        // Check if it's a callee
        const parent = refPath.parent;
        if (
          t.isCallExpression(parent) &&
          parent.callee === refPath.node
        ) {
          calleeNames.add(refName);
        }

        if (!externalDeps.includes(refName)) {
          externalDeps.push(refName);
        }
      },
    });

    // Build callee snippets
    const callees = [];
    for (const calleeName of calleeNames) {
      const calleePath = topLevelFunctions.get(calleeName);
      if (calleePath) {
        const fullCode = generate(
          calleePath.node.init || calleePath.node
        ).code;
        const snippetLines = fullCode.split("\n");
        const snippet =
          snippetLines.length > 10
            ? snippetLines.slice(0, 10).join("\n") + "\n// ... truncated"
            : fullCode;
        callees.push({ name: calleeName, snippet });
      }
    }

    functions.push({
      path,
      name,
      code,
      node: fnNode,
      externalDeps,
      callees,
    });
  }

  return functions;
}

module.exports = { extractFunctions };
