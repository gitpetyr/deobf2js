const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

// Recursive AST check: does node contain a MemberExpression with property name propName?
function hasMemberAccess(node, propName) {
  if (!node) return false;
  if (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.property, { name: propName })
  ) return true;
  if (
    t.isMemberExpression(node) &&
    t.isStringLiteral(node.property, { value: propName })
  ) return true;
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && c.type && hasMemberAccess(c, propName)) return true;
      }
    } else if (child && child.type && hasMemberAccess(child, propName)) {
      return true;
    }
  }
  return false;
}

// Recursive AST check: does node reference an identifier with given name?
function referencesIdentifier(node, name) {
  if (!node) return false;
  if (t.isIdentifier(node) && node.name === name) return true;
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && c.type && referencesIdentifier(c, name)) return true;
      }
    } else if (child && child.type && referencesIdentifier(child, name)) {
      return true;
    }
  }
  return false;
}

// Recursive AST check: does node contain a computed MemberExpression?
function hasComputedMember(node) {
  if (!node) return false;
  if (t.isMemberExpression(node) && node.computed) return true;
  for (const key of t.VISITOR_KEYS[node.type] || []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && c.type && hasComputedMember(c)) return true;
      }
    } else if (child && child.type && hasComputedMember(child)) {
      return true;
    }
  }
  return false;
}

function findStringArrays(ast) {
  const results = [];

  traverse(ast, {
    VariableDeclaration(path) {
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

    // Pattern 3: function P(kY) { kY = "...".split("~"); P = function() { return kY; }; return P(); }
    // Also handles comma-expression variant: function P(kY) { return kY = "...".split("~"), P = function() { return kY; }, P(); }
    FunctionDeclaration(path) {
      const node = path.node;
      if (!node.id || !t.isIdentifier(node.id)) return;
      const body = node.body.body;
      if (body.length < 1) return;

      let hasSplitAssign = false;
      let hasSelfReassign = false;
      const fnName = node.id.name;

      // Check if an assignment expression matches the split pattern
      function checkSplitAssign(expr) {
        if (
          t.isAssignmentExpression(expr, { operator: "=" }) &&
          t.isCallExpression(expr.right) &&
          t.isMemberExpression(expr.right.callee) &&
          t.isStringLiteral(expr.right.callee.object) &&
          t.isIdentifier(expr.right.callee.property, { name: "split" }) &&
          expr.right.arguments.length === 1 &&
          t.isStringLiteral(expr.right.arguments[0])
        ) {
          hasSplitAssign = true;
        }
      }

      // Check if an assignment expression matches the self-reassign pattern
      function checkSelfReassign(expr) {
        if (
          t.isAssignmentExpression(expr, { operator: "=" }) &&
          t.isIdentifier(expr.left, { name: fnName }) &&
          t.isFunctionExpression(expr.right)
        ) {
          hasSelfReassign = true;
        }
      }

      for (const stmt of body) {
        // Separate statements: kY = "...".split("~"); P = function() { ... };
        if (t.isExpressionStatement(stmt)) {
          checkSplitAssign(stmt.expression);
          checkSelfReassign(stmt.expression);
        }
        // Comma-expression in return: return kY = "...".split("~"), P = function() { ... }, P();
        if (
          t.isReturnStatement(stmt) &&
          stmt.argument &&
          t.isSequenceExpression(stmt.argument)
        ) {
          for (const expr of stmt.argument.expressions) {
            checkSplitAssign(expr);
            checkSelfReassign(expr);
          }
        }
      }

      if (hasSplitAssign && hasSelfReassign) {
        results.push({
          path: path,
          name: fnName,
        });
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
      const expr = path.node.expression;

      // Classic IIFE: (function(){ ... })()
      // Unary-style: !function(){ ... }() or ~function(){ ... }()
      let fnBody = null;
      if (
        t.isCallExpression(expr) &&
        t.isFunctionExpression(expr.callee)
      ) {
        fnBody = expr.callee.body;
      } else if (
        t.isUnaryExpression(expr) &&
        (expr.operator === "!" || expr.operator === "~") &&
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

      // Extract the call arguments to check for direct array name references
      let callArgs = [];
      if (t.isCallExpression(expr)) {
        callArgs = expr.arguments;
      } else if (t.isUnaryExpression(expr) && t.isCallExpression(expr.argument)) {
        callArgs = expr.argument.arguments;
      }

      // Check if any call argument directly references an array name
      const refsArray = callArgs.some(
        (arg) => t.isIdentifier(arg) && nameSet.has(arg.name)
      );

      // Check the body for push/shift pattern
      const hasPushShift = hasMemberAccess(fnBody, "push") && hasMemberAccess(fnBody, "shift");

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
      if (wrapperNames.has(path.node.id.name)) return;
      if (path.node.params.length < 1) return;

      const refsRelevant = [...allRelevantNames].some(
        (name) => referencesIdentifier(path.node, name)
      );
      // Check for computed member access pattern: arr[something]
      const hasComputedAccess = hasComputedMember(path.node);

      if (refsRelevant && hasComputedAccess) {
        const associatedWrappers = wrapperResults.filter((w) =>
          referencesIdentifier(path.node, w.name)
        );
        results.push({
          path,
          name: path.node.id.name,
          wrapperPaths: associatedWrappers.map((w) => w.path),
        });
      }
    },
    VariableDeclaration(path) {
      for (const declarator of path.get("declarations")) {
        const init = declarator.get("init");
        if (!init.node || !init.isFunctionExpression()) continue;
        if (wrapperNames.has(declarator.node.id.name)) continue;
        if (init.node.params.length < 1) continue;

        const refsRelevant = [...allRelevantNames].some(
          (name) => referencesIdentifier(init.node, name)
        );
        const hasComputedAccess = hasComputedMember(init.node);

        if (refsRelevant && hasComputedAccess) {
          const associatedWrappers = wrapperResults.filter((w) =>
            referencesIdentifier(init.node, w.name)
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
