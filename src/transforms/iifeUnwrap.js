const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const t = require("@babel/types");

/**
 * Detect if the program body is a single IIFE and extract its inner code.
 * Supports classic `(function(){})()`, unary `!function(){}()`,
 * and arrow `(()=>{})()` patterns.
 *
 * @param {import("@babel/types").File} ast
 * @returns {{ innerCode: string, style: string, wrap: function(string): string } | null}
 */
function detectOuterIIFE(ast) {
  const body = ast.program.body;
  if (body.length !== 1 || !t.isExpressionStatement(body[0])) return null;

  const expr = body[0].expression;
  let callNode, fnNode, style, unaryOp;

  if (t.isCallExpression(expr) && t.isFunctionExpression(expr.callee)) {
    callNode = expr;
    fnNode = expr.callee;
    style = "classic";
  } else if (
    t.isUnaryExpression(expr) &&
    t.isCallExpression(expr.argument) &&
    t.isFunctionExpression(expr.argument.callee)
  ) {
    callNode = expr.argument;
    fnNode = expr.argument.callee;
    style = "unary";
    unaryOp = expr.operator;
  } else if (
    t.isCallExpression(expr) &&
    t.isArrowFunctionExpression(expr.callee) &&
    t.isBlockStatement(expr.callee.body)
  ) {
    callNode = expr;
    fnNode = expr.callee;
    style = "arrow";
  }

  if (!fnNode) return null;

  const parts = [];
  for (let i = 0; i < fnNode.params.length; i++) {
    const param = fnNode.params[i];
    if (t.isIdentifier(param)) {
      const init =
        i < callNode.arguments.length
          ? generate(callNode.arguments[i]).code
          : "undefined";
      parts.push(`var ${param.name} = ${init};`);
    }
  }
  for (const stmt of fnNode.body.body) {
    parts.push(generate(stmt).code);
  }

  const innerCode = parts.join("\n");
  const paramStr = fnNode.params.map((p) => generate(p).code).join(", ");
  const argStr = callNode.arguments.map((a) => generate(a).code).join(", ");

  function wrap(code) {
    if (style === "unary") {
      return `${unaryOp}function(${paramStr}) {\n${code}\n}(${argStr});`;
    } else if (style === "arrow") {
      return `((${paramStr}) => {\n${code}\n})(${argStr});`;
    } else {
      return `(function(${paramStr}) {\n${code}\n})(${argStr});`;
    }
  }

  return { innerCode, style, wrap };
}

/**
 * Unwrap up to `maxDepth` nested outer IIFE layers.
 * Returns the unwrapped AST and a stack for re-wrapping.
 *
 * @param {import("@babel/types").File} ast
 * @param {Object} [options]
 * @param {number} [options.maxDepth=10]
 * @param {function(...any): void} [options.log]
 * @returns {{ ast: import("@babel/types").File, iifeStack: Array<{ style: string, wrap: function(string): string }> }}
 */
function unwrapIIFEs(ast, options = {}) {
  const { maxDepth = 10, log = () => {} } = options;
  const iifeStack = [];

  for (let depth = 0; depth < maxDepth; depth++) {
    const iifeInfo = detectOuterIIFE(ast);
    if (!iifeInfo) break;
    iifeStack.push(iifeInfo);
    ast = parser.parse(iifeInfo.innerCode, { sourceType: "script" });
    log("Unwrapped outer IIFE layer", depth + 1, "(style:", iifeInfo.style + ")");
  }

  return { ast, iifeStack };
}

/**
 * Re-wrap code with IIFE layers from the stack (in reverse order).
 *
 * @param {string} code
 * @param {Array<{ style: string, wrap: function(string): string }>} iifeStack
 * @param {Object} [options]
 * @param {function(...any): void} [options.log]
 * @returns {string}
 */
function rewrapIIFEs(code, iifeStack, options = {}) {
  const { log = () => {} } = options;
  let result = code;
  while (iifeStack.length > 0) {
    const iifeInfo = iifeStack.pop();
    result = iifeInfo.wrap(result);
    log("Re-wrapped outer IIFE (style:", iifeInfo.style + ")");
  }
  return result;
}

module.exports = { detectOuterIIFE, unwrapIIFEs, rewrapIIFEs };
