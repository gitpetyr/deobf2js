const t = require("@babel/types");

function isUndefinedNode(node) {
  if (t.isIdentifier(node, { name: "undefined" })) return true;
  if (
    t.isUnaryExpression(node, { operator: "void" }) &&
    t.isNumericLiteral(node.argument, { value: 0 })
  ) {
    return true;
  }
  return false;
}

module.exports = {
  name: "typeofUndefined",
  tags: ["safe"],
  visitor() {
    return {
      BinaryExpression(path) {
        const { node } = path;
        const { operator } = node;
        if (
          operator !== "===" &&
          operator !== "!==" &&
          operator !== "==" &&
          operator !== "!="
        ) {
          return;
        }

        let typeofArg = null;
        let stringVal = null;

        if (
          t.isUnaryExpression(node.left, { operator: "typeof" }) &&
          t.isStringLiteral(node.right)
        ) {
          typeofArg = node.left.argument;
          stringVal = node.right.value;
        } else if (
          t.isUnaryExpression(node.right, { operator: "typeof" }) &&
          t.isStringLiteral(node.left)
        ) {
          typeofArg = node.right.argument;
          stringVal = node.left.value;
        } else {
          return;
        }

        if (!isUndefinedNode(typeofArg)) return;

        const isEqual = operator === "===" || operator === "==";
        const typeofResult = "undefined";
        const conditionTrue = typeofResult === stringVal;
        const result = isEqual ? conditionTrue : !conditionTrue;

        path.replaceWith(t.booleanLiteral(result));
        this.changes++;
      },
    };
  },
};
