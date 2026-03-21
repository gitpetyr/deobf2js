const t = require("@babel/types");

/**
 * Flatten a left-recursive chain of BinaryExpression(+) into an array of parts.
 */
function flattenConcat(node) {
  const parts = [];
  function walk(n) {
    if (t.isBinaryExpression(n, { operator: "+" })) {
      walk(n.left);
      walk(n.right);
    } else {
      parts.push(n);
    }
  }
  walk(node);
  return parts;
}

module.exports = {
  name: "templateLiterals",
  tags: ["safe"],
  visitor() {
    return {
      BinaryExpression(path) {
        if (path.node.operator !== "+") return;

        // Only process the top-level concatenation (not sub-expressions)
        if (t.isBinaryExpression(path.parent, { operator: "+" })) return;

        const parts = flattenConcat(path.node);

        const hasString = parts.some((p) => t.isStringLiteral(p));
        const hasNonString = parts.some((p) => !t.isStringLiteral(p));

        // Only convert if mixed: at least one string literal AND at least one non-string
        if (!hasString || !hasNonString) return;

        const quasis = [];
        const expressions = [];

        // Build template literal parts
        let currentRaw = "";
        for (const part of parts) {
          if (t.isStringLiteral(part)) {
            currentRaw += part.value;
          } else {
            quasis.push(
              t.templateElement({ raw: currentRaw, cooked: currentRaw }, false)
            );
            currentRaw = "";
            expressions.push(part);
          }
        }
        // Final quasi (tail)
        quasis.push(
          t.templateElement({ raw: currentRaw, cooked: currentRaw }, true)
        );

        path.replaceWith(t.templateLiteral(quasis, expressions));
        this.changes++;
      },
    };
  },
};
