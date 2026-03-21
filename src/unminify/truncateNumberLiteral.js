const t = require("@babel/types");

module.exports = {
  name: "truncateNumberLiteral",
  tags: ["safe"],
  visitor() {
    return {
      NumericLiteral(path) {
        const { node } = path;
        if (!node.extra) return;
        if (!node.extra.raw) return;
        if (!Number.isInteger(node.value)) return;
        if (!node.extra.raw.includes(".")) return;

        delete path.node.extra;
        this.changes++;
      },
    };
  },
};
