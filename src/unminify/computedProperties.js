const t = require("@babel/types");

module.exports = {
  name: "computedProperties",
  tags: ["safe"],
  visitor() {
    return {
      MemberExpression(path) {
        if (!path.node.computed) return;
        if (!t.isStringLiteral(path.node.property)) return;

        const key = path.node.property.value;
        if (!t.isValidIdentifier(key)) return;

        path.node.computed = false;
        path.node.property = t.identifier(key);
        this.changes++;
      },
      ObjectProperty(path) {
        if (!path.node.computed) return;
        if (!t.isStringLiteral(path.node.key)) return;

        const key = path.node.key.value;
        if (!t.isValidIdentifier(key)) return;

        path.node.computed = false;
        path.node.key = t.identifier(key);
        this.changes++;
      },
    };
  },
};
