const t = require("@babel/types");

function evaluateLiteralComparison(operator, left, right) {
  if (!t.isLiteral(left) || !t.isLiteral(right)) return null;

  let leftVal, rightVal;

  if (t.isStringLiteral(left)) leftVal = left.value;
  else if (t.isNumericLiteral(left)) leftVal = left.value;
  else if (t.isBooleanLiteral(left)) leftVal = left.value;
  else if (t.isNullLiteral(left)) leftVal = null;
  else return null;

  if (t.isStringLiteral(right)) rightVal = right.value;
  else if (t.isNumericLiteral(right)) rightVal = right.value;
  else if (t.isBooleanLiteral(right)) rightVal = right.value;
  else if (t.isNullLiteral(right)) rightVal = null;
  else return null;

  switch (operator) {
    case "===":
      return leftVal === rightVal;
    case "!==":
      return leftVal !== rightVal;
    case "==":
      return leftVal == rightVal;
    case "!=":
      return leftVal != rightVal;
    default:
      return null;
  }
}

function evaluateCondition(node) {
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isBinaryExpression(node)) {
    return evaluateLiteralComparison(node.operator, node.left, node.right);
  }
  return null;
}

module.exports = {
  name: "deadCode",
  tags: ["safe"],
  visitor() {
    return {
      IfStatement(path) {
        const result = evaluateCondition(path.node.test);
        if (result === null) return;

        if (result) {
          if (t.isBlockStatement(path.node.consequent)) {
            path.replaceWithMultiple(path.node.consequent.body);
          } else {
            path.replaceWith(path.node.consequent);
          }
        } else {
          if (path.node.alternate) {
            if (t.isBlockStatement(path.node.alternate)) {
              path.replaceWithMultiple(path.node.alternate.body);
            } else {
              path.replaceWith(path.node.alternate);
            }
          } else {
            path.remove();
          }
        }
        this.changes++;
      },
      ConditionalExpression(path) {
        const result = evaluateCondition(path.node.test);
        if (result === null) return;

        if (result) {
          path.replaceWith(path.node.consequent);
        } else {
          path.replaceWith(path.node.alternate);
        }
        this.changes++;
      },
    };
  },
};
