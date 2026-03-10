const fs = require("fs");
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const stringDecryptor = require("./transforms/stringDecryptor");
const copyPropagation = require("./transforms/copyPropagation");
const deadCodeElimination = require("./transforms/deadCodeElimination");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  process.stderr.write("[deobfuscator] " + args.join(" ") + "\n");
}

/**
 * Detect if the program body is a single IIFE and extract its inner code.
 * Returns { innerCode, wrap } or null if no outer IIFE is found.
 */
function detectOuterIIFE(ast) {
  const body = ast.program.body;
  if (body.length !== 1 || !t.isExpressionStatement(body[0])) return null;

  const expr = body[0].expression;
  let callNode, fnNode, style, unaryOp;

  // (function(...){...})(...)
  if (t.isCallExpression(expr) && t.isFunctionExpression(expr.callee)) {
    callNode = expr;
    fnNode = expr.callee;
    style = "classic";
  }
  // !function(...){...}(...) and other unary-prefix IIFEs
  else if (
    t.isUnaryExpression(expr) &&
    t.isCallExpression(expr.argument) &&
    t.isFunctionExpression(expr.argument.callee)
  ) {
    callNode = expr.argument;
    fnNode = expr.argument.callee;
    style = "unary";
    unaryOp = expr.operator;
  }
  // (() => {...})(...)
  else if (
    t.isCallExpression(expr) &&
    t.isArrowFunctionExpression(expr.callee) &&
    t.isBlockStatement(expr.callee.body)
  ) {
    callNode = expr;
    fnNode = expr.callee;
    style = "arrow";
  }

  if (!fnNode) return null;

  // Generate inner code: param-to-var declarations + function body
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

  // Save wrap metadata for re-wrapping after transforms
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

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    process.stderr.write("Usage: node src/deobfuscator.js <input> [output]\n");
    process.exit(1);
  }

  // Step 1: Read input
  log("Reading input:", inputPath);
  const code = fs.readFileSync(inputPath, "utf-8");
  log("Input size:", code.length, "bytes");

  // Step 2: Parse
  log("Parsing...");
  let ast = parser.parse(code, { sourceType: "script" });
  log("Parsed successfully");

  // Step 2.5: Unwrap nested outer IIFEs so transforms can see top-level nodes
  const iifeStack = [];
  for (let depth = 0; depth < 10; depth++) {
    const iifeInfo = detectOuterIIFE(ast);
    if (!iifeInfo) break;
    iifeStack.push(iifeInfo);
    ast = parser.parse(iifeInfo.innerCode, { sourceType: "script" });
    log("Unwrapped outer IIFE layer", depth + 1, "(style:", iifeInfo.style + ")");
  }

  // Step 3: String decryption
  log("Running string decryption...");
  const { consumedPaths } = stringDecryptor(ast);
  log("String decryption complete,", consumedPaths.length, "nodes consumed");

  // Step 4: Copy propagation
  log("Running copy propagation...");
  const copyChanges = copyPropagation(ast);
  log("Copy propagation complete,", copyChanges, "changes");

  // Step 5: Dead code elimination
  log("Running dead code elimination...");
  const deadRemoved = deadCodeElimination(ast, consumedPaths);
  log("Dead code elimination complete,", deadRemoved, "nodes removed");

  // Step 6: Generate output
  log("Generating output...");
  const output = generate(ast, {
    comments: true,
    jsescOption: { minimal: true },
  });

  // Step 6.5: Re-wrap IIFE layers in reverse order
  let finalCode = output.code;
  while (iifeStack.length > 0) {
    const iifeInfo = iifeStack.pop();
    finalCode = iifeInfo.wrap(finalCode);
    log("Re-wrapped outer IIFE (style:", iifeInfo.style + ")");
  }

  // Step 7: Write output
  if (outputPath) {
    fs.writeFileSync(outputPath, finalCode, "utf-8");
    log("Output written to:", outputPath);
  } else {
    process.stdout.write(finalCode);
  }

  log("Done!");
}

main();
