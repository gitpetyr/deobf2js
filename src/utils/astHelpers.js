const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

function findStringArrays(ast) {
  const results = [];

  traverse(ast, {
    VariableDeclaration(path) {
      if (path.parent.type !== "Program") return;

      for (const declarator of path.get("declarations")) {
        const init = declarator.get("init");
        if (!init.node) continue;

        // Pattern 1: var arr = ["str1", "str2", "str3", ...]
        if (init.isArrayExpression()) {
          const elements = init.node.elements;
          if (
            elements.length >= 3 &&
            elements.every((el) => t.isStringLiteral(el))
          ) {
            results.push({
              path: path,
              name: declarator.node.id.name,
            });
          }
        }

        // Pattern 2: var arr = "str1|str2|str3".split("|")
        if (init.isCallExpression()) {
          const callee = init.node.callee;
          if (
            t.isMemberExpression(callee) &&
            t.isStringLiteral(callee.object) &&
            t.isIdentifier(callee.property, { name: "split" }) &&
            init.node.arguments.length === 1 &&
            t.isStringLiteral(init.node.arguments[0])
          ) {
            results.push({
              path: path,
              name: declarator.node.id.name,
            });
          }
        }
      }
    },
  });

  return results;
}

function findShuffleIIFEs(ast, arrayNames) {
  const nameSet = new Set(arrayNames);
  const results = [];

  traverse(ast, {
    ExpressionStatement(path) {
      if (path.parent.type !== "Program") return;

      const expr = path.node.expression;

      // Classic IIFE: (function(){ ... })()
      // Bang-style: !function(){ ... }()
      let fnBody = null;
      if (
        t.isCallExpression(expr) &&
        t.isFunctionExpression(expr.callee)
      ) {
        fnBody = expr.callee.body;
      } else if (
        t.isUnaryExpression(expr, { operator: "!" }) &&
        t.isCallExpression(expr.argument) &&
        t.isFunctionExpression(expr.argument.callee)
      ) {
        fnBody = expr.argument.callee.body;
      }
      // Parenthesized IIFE: (function(){ ... }())
      if (!fnBody && t.isCallExpression(expr)) {
        const callee = expr.callee;
        if (
          t.isSequenceExpression(callee) &&
          callee.expressions.length === 1 &&
          t.isFunctionExpression(callee.expressions[0])
        ) {
          fnBody = callee.expressions[0].body;
        }
      }

      if (!fnBody) return;

      // Check the full expression (including call arguments) for array references
      const code = JSON.stringify(path.node);
      const refsArray = arrayNames.some((name) => code.includes('"' + name + '"'));
      const hasPushShift =
        code.includes('"push"') && code.includes('"shift"');

      if (refsArray && hasPushShift) {
        results.push({ path });
      }
    },
  });

  return results;
}

function findDecoderFunctions(ast, arrayNames) {
  const nameSet = new Set(arrayNames);
  const results = [];
  const wrapperResults = [];

  // First pass: find wrapper functions (single return statement returning array name)
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parent.type !== "Program") return;
      const body = path.node.body.body;
      if (
        body.length === 1 &&
        t.isReturnStatement(body[0]) &&
        t.isIdentifier(body[0].argument) &&
        nameSet.has(body[0].argument.name)
      ) {
        wrapperResults.push({
          path,
          name: path.node.id.name,
          wrappedArray: body[0].argument.name,
        });
      }
    },
    VariableDeclaration(path) {
      if (path.parent.type !== "Program") return;
      for (const declarator of path.get("declarations")) {
        const init = declarator.get("init");
        if (!init.node || !init.isFunctionExpression()) continue;
        const body = init.node.body.body;
        if (
          body.length === 1 &&
          t.isReturnStatement(body[0]) &&
          t.isIdentifier(body[0].argument) &&
          nameSet.has(body[0].argument.name)
        ) {
          wrapperResults.push({
            path,
            name: declarator.node.id.name,
            wrappedArray: body[0].argument.name,
          });
        }
      }
    },
  });

  const wrapperNames = new Set(wrapperResults.map((w) => w.name));
  const allRelevantNames = new Set([...nameSet, ...wrapperNames]);

  // Second pass: find decoder functions
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parent.type !== "Program") return;
      if (wrapperNames.has(path.node.id.name)) return;
      if (path.node.params.length < 1) return;

      const code = JSON.stringify(path.node);
      const refsRelevant = [...allRelevantNames].some(
        (name) => code.includes('"' + name + '"')
      );
      // Check for computed member access pattern: arr[something]
      const hasComputedAccess = code.includes('"computed":true');

      if (refsRelevant && hasComputedAccess) {
        const associatedWrappers = wrapperResults.filter((w) =>
          code.includes('"' + w.name + '"')
        );
        results.push({
          path,
          name: path.node.id.name,
          wrapperPaths: associatedWrappers.map((w) => w.path),
        });
      }
    },
    VariableDeclaration(path) {
      if (path.parent.type !== "Program") return;
      for (const declarator of path.get("declarations")) {
        const init = declarator.get("init");
        if (!init.node || !init.isFunctionExpression()) continue;
        if (wrapperNames.has(declarator.node.id.name)) continue;
        if (init.node.params.length < 1) continue;

        const code = JSON.stringify(init.node);
        const refsRelevant = [...allRelevantNames].some(
          (name) => code.includes('"' + name + '"')
        );
        const hasComputedAccess = code.includes('"computed":true');

        if (refsRelevant && hasComputedAccess) {
          const associatedWrappers = wrapperResults.filter((w) =>
            code.includes('"' + w.name + '"')
          );
          results.push({
            path,
            name: declarator.node.id.name,
            wrapperPaths: associatedWrappers.map((w) => w.path),
          });
        }
      }
    },
  });

  return results;
}

module.exports = { findStringArrays, findShuffleIIFEs, findDecoderFunctions };
