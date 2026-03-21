const t = require("@babel/types");

module.exports = {
  name: "yoda",
  tags: ["safe"],
  visitor() {
    return {
      BinaryExpression(path) {
        const { node } = path;
        const swappable = ["===", "!==", "==", "!="];
        if (!swappable.includes(node.operator)) return;
        if (!t.isLiteral(node.left)) return;
        if (t.isLiteral(node.right)) return;

        const temp = node.left;
        node.left = node.right;
        node.right = temp;
        this.changes++;
      },
    };
  },
};
