const t = require("@babel/types");

module.exports = {
  name: "rawLiterals",
  tags: ["safe"],
  visitor() {
    return {
      StringLiteral(path) {
        const { node } = path;
        if (!node.extra) return;
        if (!node.extra.raw) return;

        const raw = node.extra.raw;
        if (/\\x[0-9a-fA-F]{2}/.test(raw) || /\\u[0-9a-fA-F]{4}/.test(raw)) {
          delete path.node.extra;
          this.changes++;
        }
      },
    };
  },
};
