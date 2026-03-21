const t = require("@babel/types");

module.exports = {
  name: "stringLiteralCleanup",
  tags: ["safe"],
  visitor() {
    return {
      StringLiteral(path) {
        const { node } = path;
        if (!node.extra) return;
        if (!node.extra.raw) return;

        const expectedRaw = '"' + node.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
        if (node.extra.raw !== expectedRaw) {
          delete path.node.extra;
          this.changes++;
        }
      },
    };
  },
};
