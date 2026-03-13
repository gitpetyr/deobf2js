const fs = require("fs");
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const stringDecryptor = require("./transforms/stringDecryptor");
const copyPropagation = require("./transforms/copyPropagation");
const deadCodeElimination = require("./transforms/deadCodeElimination");
const constantObjectInlining = require("./transforms/constantObjectInlining");
const constantFolding = require("./transforms/constantFolding");
const objectProxyInlining = require("./transforms/objectProxyInlining");
const controlFlowUnflattening = require("./transforms/controlFlowUnflattening");
const antiDebugRemoval = require("./transforms/antiDebugRemoval");
const commaExpressionSplitter = require("./transforms/commaExpressionSplitter");
const objectPropertyCollapse = require("./transforms/objectPropertyCollapse");
const aiRefine = require("./transforms/aiRefine");

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

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    process.stderr.write("Usage: node src/deobfuscator.js <input> [output] [--sandbox jsdom|playwright] [--max-iterations N] [--ai-provider openai|gemini|claude] [--ai-model MODEL] [--ai-base-url URL]\n");
    process.exit(1);
  }

  // Parse --max-iterations flag
  let maxIterations = Infinity;
  const maxIterIdx = process.argv.indexOf("--max-iterations");
  if (maxIterIdx !== -1 && process.argv[maxIterIdx + 1]) {
    maxIterations = parseInt(process.argv[maxIterIdx + 1], 10);
    if (!Number.isFinite(maxIterations) || maxIterations < 1) {
      process.stderr.write("Error: --max-iterations must be a positive integer\n");
      process.exit(1);
    }
  }

  // Parse AI flags
  let aiProvider = null;
  let aiModel = null;
  let aiBaseURL = null;
  let sandboxType = "playwright";
  const sandboxIdx = process.argv.indexOf("--sandbox");
  if (sandboxIdx !== -1 && process.argv[sandboxIdx + 1]) {
    sandboxType = process.argv[sandboxIdx + 1];
    if (sandboxType !== "jsdom" && sandboxType !== "playwright") {
      process.stderr.write("Error: --sandbox must be 'jsdom' or 'playwright'\n");
      process.exit(1);
    }
  }
  const aiProviderIdx = process.argv.indexOf("--ai-provider");
  if (aiProviderIdx !== -1 && process.argv[aiProviderIdx + 1]) {
    aiProvider = process.argv[aiProviderIdx + 1];
  }
  const aiModelIdx = process.argv.indexOf("--ai-model");
  if (aiModelIdx !== -1 && process.argv[aiModelIdx + 1]) {
    aiModel = process.argv[aiModelIdx + 1];
  }
  const aiBaseURLIdx = process.argv.indexOf("--ai-base-url");
  if (aiBaseURLIdx !== -1 && process.argv[aiBaseURLIdx + 1]) {
    aiBaseURL = process.argv[aiBaseURLIdx + 1];
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

  // Step 2.6: Remove anti-debug traps before main pipeline
  log("Running anti-debug removal...");
  const antiDebugChanges = antiDebugRemoval(ast);
  log("Anti-debug removal complete,", antiDebugChanges, "changes");

  // Step 3: Multi-pass deobfuscation pipeline (iterate until no changes)
  const allConsumedPaths = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    log("=== Pipeline iteration", iteration, "===");
    let iterationChanges = 0;

    // Phase 1: Constant folding (!![] -> true, +[] -> 0)
    log("Running constant folding...");
    const foldChanges = constantFolding(ast);
    log("Constant folding complete,", foldChanges, "changes");
    iterationChanges += foldChanges;

    // Phase 1.5: Collapse M={}; M["k"]=v; into M={k:v}
    log("Running object property collapse...");
    const collapseChanges = objectPropertyCollapse(ast);
    log("Object property collapse complete,", collapseChanges, "changes");
    iterationChanges += collapseChanges;

    // Phase 2: Constant object inlining (Vg.W -> 1204)
    log("Running constant object inlining...");
    const inlineChanges = constantObjectInlining(ast);
    log("Constant object inlining complete,", inlineChanges, "changes");
    iterationChanges += inlineChanges;

    // Phase 3: Object proxy inlining (obj.fn(a,b) -> a !== b)
    log("Running object proxy inlining...");
    const proxyChanges = objectProxyInlining(ast);
    log("Object proxy inlining complete,", proxyChanges, "changes");
    iterationChanges += proxyChanges;

    // Phase 4: Control flow unflattening (while-switch -> sequential)
    log("Running control flow unflattening...");
    const cffChanges = controlFlowUnflattening(ast);
    log("Control flow unflattening complete,", cffChanges, "changes");
    iterationChanges += cffChanges;

    // Phase 5: String decryption
    log("Running string decryption...");
    const { consumedPaths } = await stringDecryptor(ast, { sandboxType });
    log("String decryption complete,", consumedPaths.length, "nodes consumed");
    allConsumedPaths.push(...consumedPaths);
    iterationChanges += consumedPaths.length;

    // Phase 6: Copy propagation
    log("Running copy propagation...");
    const copyChanges = copyPropagation(ast);
    log("Copy propagation complete,", copyChanges, "changes");
    iterationChanges += copyChanges;

    // Phase 7: Dead code elimination
    log("Running dead code elimination...");
    const deadRemoved = deadCodeElimination(ast, consumedPaths);
    log("Dead code elimination complete,", deadRemoved, "nodes removed");
    iterationChanges += deadRemoved;

    // Phase 8: Comma expression splitting (a(), b(), c() → separate statements)
    log("Running comma expression splitting...");
    const commaChanges = commaExpressionSplitter(ast);
    log("Comma expression splitting complete,", commaChanges, "changes");
    iterationChanges += commaChanges;

    log("Iteration", iteration, "total changes:", iterationChanges);
    if (iterationChanges === 0) break;
  }

  // AI refinement (optional, after all mechanical transforms)
  if (aiProvider) {
    log("Running AI refinement...");
    const aiChanges = await aiRefine(ast, { provider: aiProvider, model: aiModel, baseURL: aiBaseURL });
    log("AI refinement complete,", aiChanges, "functions refined");
  }

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

main().catch((err) => {
  process.stderr.write("[deobfuscator] Fatal error: " + err.message + "\n");
  process.exit(1);
});
