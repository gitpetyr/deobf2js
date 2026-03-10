const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[commaExpressionSplitter] " + args.join(" ") + "\n");
}

function commaExpressionSplitter(ast) {
  let changes = 0;

  traverse(ast, {
    ExpressionStatement(path) {
      const expr = path.node.expression;
      if (!t.isSequenceExpression(expr)) return;

      // (a(), b(), c()) → a(); b(); c();
      const stmts = expr.expressions.map((e) => t.expressionStatement(e));
      path.replaceWithMultiple(stmts);
      changes++;
    },
  });

  log("Total changes:", changes);
  return changes;
}

module.exports = commaExpressionSplitter;
