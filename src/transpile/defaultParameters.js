const t = require("@babel/types");

/**
 * Check if a node is `void 0` (i.e. undefined).
 */
function isVoidZero(node) {
  return t.isUnaryExpression(node, { operator: "void" }) &&
         t.isNumericLiteral(node.argument, { value: 0 });
}

/**
 * Check if a node is `=== void 0` or `=== undefined` test for a given name.
 * Returns true if the test matches `name === void 0` or `void 0 === name`.
 */
function isUndefinedCheck(test, name) {
  if (!t.isBinaryExpression(test, { operator: "===" })) return false;
  const { left, right } = test;

  // name === void 0  or  name === undefined
  if (t.isIdentifier(left, { name }) && (isVoidZero(right) || t.isIdentifier(right, { name: "undefined" }))) {
    return true;
  }
  // void 0 === name  or  undefined === name
  if (t.isIdentifier(right, { name }) && (isVoidZero(left) || t.isIdentifier(left, { name: "undefined" }))) {
    return true;
  }
  return false;
}

module.exports = {
  name: "defaultParameters",
  tags: ["safe"],
  visitor() {
    return {
      "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(path) {
        const { params, body } = path.node;
        if (!t.isBlockStatement(body)) return;

        const paramNames = new Set();
        for (const p of params) {
          if (t.isIdentifier(p)) paramNames.add(p.name);
        }
        if (paramNames.size === 0) return;

        const stmts = body.body;
        const toRemove = [];

        // Scan leading statements for default-parameter patterns
        for (let i = 0; i < stmts.length; i++) {
          const stmt = stmts[i];
          let matched = false;

          // Pattern 1: if (a === void 0) a = defaultVal;
          if (t.isIfStatement(stmt) && !stmt.alternate) {
            const checkedName = getIfDefaultName(stmt);
            if (checkedName && paramNames.has(checkedName)) {
              const defaultVal = getIfDefaultValue(stmt);
              if (defaultVal) {
                setParamDefault(params, checkedName, defaultVal);
                toRemove.push(i);
                matched = true;
              }
            }
          }

          // Pattern 2: a = a === void 0 ? defaultVal : a;
          if (!matched && t.isExpressionStatement(stmt) &&
              t.isAssignmentExpression(stmt.expression, { operator: "=" })) {
            const assign = stmt.expression;
            if (t.isIdentifier(assign.left) && paramNames.has(assign.left.name) &&
                t.isConditionalExpression(assign.right)) {
              const cond = assign.right;
              const name = assign.left.name;
              if (isUndefinedCheck(cond.test, name) &&
                  t.isIdentifier(cond.alternate, { name })) {
                setParamDefault(params, name, cond.consequent);
                toRemove.push(i);
                matched = true;
              }
            }
          }

          // Stop scanning at the first non-matching statement
          if (!matched) break;
        }

        // Remove matched statements in reverse order
        for (let i = toRemove.length - 1; i >= 0; i--) {
          stmts.splice(toRemove[i], 1);
        }

        if (toRemove.length > 0) {
          this.changes += toRemove.length;
        }
      },
    };
  },
};

/**
 * Extract the parameter name from `if (name === void 0) name = ...;`
 */
function getIfDefaultName(stmt) {
  if (!isSimpleAssignBlock(stmt.consequent)) return null;
  const assign = getAssignFromConsequent(stmt.consequent);
  if (!assign || !t.isIdentifier(assign.left)) return null;
  const name = assign.left.name;
  if (!isUndefinedCheck(stmt.test, name)) return null;
  return name;
}

/**
 * Extract the default value from `if (name === void 0) name = value;`
 */
function getIfDefaultValue(stmt) {
  const assign = getAssignFromConsequent(stmt.consequent);
  return assign ? assign.right : null;
}

function isSimpleAssignBlock(node) {
  if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression, { operator: "=" })) {
    return true;
  }
  if (t.isBlockStatement(node) && node.body.length === 1) {
    return isSimpleAssignBlock(node.body[0]);
  }
  return false;
}

function getAssignFromConsequent(node) {
  if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression, { operator: "=" })) {
    return node.expression;
  }
  if (t.isBlockStatement(node) && node.body.length === 1) {
    return getAssignFromConsequent(node.body[0]);
  }
  return null;
}

function setParamDefault(params, name, defaultVal) {
  for (let i = 0; i < params.length; i++) {
    if (t.isIdentifier(params[i]) && params[i].name === name) {
      params[i] = t.assignmentPattern(params[i], defaultVal);
      return;
    }
  }
}
