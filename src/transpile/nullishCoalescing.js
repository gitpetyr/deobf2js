const t = require("@babel/types");

/**
 * Check if a node is `void 0` (i.e. undefined).
 */
function isVoidZero(node) {
  return t.isUnaryExpression(node, { operator: "void" }) &&
         t.isNumericLiteral(node.argument, { value: 0 });
}

/**
 * Check if a node is the identifier `undefined`.
 */
function isUndefinedId(node) {
  return t.isIdentifier(node, { name: "undefined" });
}

/**
 * Check if two nodes are the same identifier.
 */
function sameIdentifier(a, b) {
  return t.isIdentifier(a) && t.isIdentifier(b) && a.name === b.name;
}

module.exports = {
  name: "nullishCoalescing",
  tags: ["safe"],
  visitor() {
    return {
      ConditionalExpression(path) {
        const { test, consequent, alternate } = path.node;

        // Pattern 1: a != null ? a : b  -->  a ?? b
        if (t.isBinaryExpression(test, { operator: "!=" }) &&
            t.isNullLiteral(test.right) &&
            t.isIdentifier(test.left) &&
            sameIdentifier(test.left, consequent)) {
          path.replaceWith(t.logicalExpression("??", consequent, alternate));
          this.changes++;
          return;
        }

        // Pattern 2: a !== null && a !== void 0 ? a : b  -->  a ?? b
        // (or a !== void 0 && a !== null)
        if (t.isLogicalExpression(test, { operator: "&&" })) {
          const { left: l, right: r } = test;
          if (t.isBinaryExpression(l, { operator: "!==" }) &&
              t.isBinaryExpression(r, { operator: "!==" })) {
            const id = l.left;
            if (!t.isIdentifier(id)) return;

            const lIsNull = t.isNullLiteral(l.right);
            const lIsUndef = isVoidZero(l.right) || isUndefinedId(l.right);
            const rIsNull = t.isNullLiteral(r.right);
            const rIsUndef = isVoidZero(r.right) || isUndefinedId(r.right);

            const hasNullAndUndef = (lIsNull && rIsUndef) || (lIsUndef && rIsNull);
            if (!hasNullAndUndef) return;
            if (!sameIdentifier(id, r.left)) return;
            if (!sameIdentifier(id, consequent)) return;

            path.replaceWith(t.logicalExpression("??", consequent, alternate));
            this.changes++;
            return;
          }
        }
      },
    };
  },
};
