const t = require("@babel/types");

function valueToAst(value) {
  if (value === null) {
    return t.nullLiteral();
  }
  if (typeof value === "string") {
    return t.stringLiteral(value);
  }
  if (typeof value === "number") {
    if (value < 0) {
      return t.unaryExpression("-", t.numericLiteral(-value));
    }
    return t.numericLiteral(value);
  }
  if (typeof value === "boolean") {
    return t.booleanLiteral(value);
  }
  if (Array.isArray(value)) {
    return t.arrayExpression(value.map(valueToAst));
  }
  if (typeof value === "object") {
    const properties = Object.keys(value).map((key) => {
      const keyNode = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
        ? t.identifier(key)
        : t.stringLiteral(key);
      return t.objectProperty(keyNode, valueToAst(value[key]));
    });
    return t.objectExpression(properties);
  }
  return t.identifier("undefined");
}

module.exports = {
  name: "jsonParse",
  tags: ["safe"],
  visitor() {
    return {
      CallExpression(path) {
        const { node } = path;
        if (!t.isMemberExpression(node.callee)) return;
        if (!t.isIdentifier(node.callee.object, { name: "JSON" })) return;
        if (!t.isIdentifier(node.callee.property, { name: "parse" })) return;
        if (node.callee.computed) return;
        if (node.arguments.length !== 1) return;
        if (!t.isStringLiteral(node.arguments[0])) return;

        try {
          const parsed = JSON.parse(node.arguments[0].value);
          const astNode = valueToAst(parsed);
          path.replaceWith(astNode);
          this.changes++;
        } catch (e) {
          // Invalid JSON, skip
        }
      },
    };
  },
};
