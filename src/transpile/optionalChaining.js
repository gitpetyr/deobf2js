const t = require("@babel/types");

/**
 * Check if two nodes are structurally equivalent identifiers or member expressions.
 */
function nodesEqual(a, b) {
  if (t.isIdentifier(a) && t.isIdentifier(b)) {
    return a.name === b.name;
  }
  if (t.isMemberExpression(a) && t.isMemberExpression(b)) {
    if (a.computed !== b.computed) return false;
    if (!nodesEqual(a.object, b.object)) return false;
    if (t.isIdentifier(a.property) && t.isIdentifier(b.property)) {
      return a.property.name === b.property.name;
    }
    if (t.isStringLiteral(a.property) && t.isStringLiteral(b.property)) {
      return a.property.value === b.property.value;
    }
    return false;
  }
  return false;
}

/**
 * Convert a regular MemberExpression into an OptionalMemberExpression chain.
 * Marks the outermost access as optional.
 */
function toOptionalMember(node) {
  if (!t.isMemberExpression(node)) return node;
  return t.optionalMemberExpression(
    node.object,
    node.property,
    node.computed,
    true
  );
}

/**
 * Recursively make all MemberExpression nodes in the chain optional.
 */
function deepOptional(node) {
  if (t.isMemberExpression(node)) {
    return t.optionalMemberExpression(
      deepOptional(node.object),
      node.property,
      node.computed,
      true
    );
  }
  return node;
}

module.exports = {
  name: "optionalChaining",
  tags: ["safe"],
  visitor() {
    return {
      LogicalExpression(path) {
        if (path.node.operator !== "&&") return;

        // Don't transform standalone ExpressionStatements — optional chaining
        // as a statement is unusual and may change semantics.
        if (t.isExpressionStatement(path.parent)) return;

        const { left, right } = path.node;

        // Pattern: a != null && a.b
        if (t.isBinaryExpression(left) && left.operator === "!=" &&
            t.isNullLiteral(left.right) &&
            t.isIdentifier(left.left) &&
            t.isMemberExpression(right) &&
            t.isIdentifier(right.object) &&
            left.left.name === right.object.name) {
          path.replaceWith(toOptionalMember(right));
          this.changes++;
          return;
        }

        // Pattern: a && a.b  (identifier guard)
        if (t.isIdentifier(left) && t.isMemberExpression(right) &&
            t.isIdentifier(right.object) &&
            left.name === right.object.name) {
          path.replaceWith(toOptionalMember(right));
          this.changes++;
          return;
        }

        // Chained pattern: a.b && a.b.c  (member extends member by one property)
        if (t.isMemberExpression(left) && t.isMemberExpression(right) &&
            nodesEqual(left, right.object)) {
          path.replaceWith(toOptionalMember(right));
          this.changes++;
          return;
        }
      },
    };
  },
};
