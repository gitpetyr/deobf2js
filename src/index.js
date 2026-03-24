const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const { applyTransform } = require("./transforms/framework");
const { unwrapIIFEs, rewrapIIFEs } = require("./transforms/iifeUnwrap");
const { runPlugins } = require("./plugin");
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
const unminify = require("./unminify");
const transpile = require("./transpile");
const { computeTaintedNames } = require("./utils/taintAnalysis");

/**
 * Main deobfuscation API.
 *
 * @param {string} code - JavaScript source code to deobfuscate
 * @param {Object} [options]
 * @param {string} [options.sandboxType="playwright"] - Sandbox type: "jsdom" or "playwright"
 * @param {number} [options.maxIterations=Infinity] - Maximum pipeline iterations
 * @param {Set<string>} [options.preserveNames] - Seed variable names to preserve
 * @param {{ provider: string, model?: string, baseURL?: string }} [options.aiConfig] - AI config
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {Object<import("./plugin").Stage, import("./plugin").Plugin[]>} [options.plugins] - Plugins keyed by stage
 * @returns {Promise<{ code: string, stats: { iterations: number, totalChanges: number } }>}
 */
async function deobfuscate(code, options = {}) {
  const {
    sandboxType = "playwright",
    maxIterations = Infinity,
    preserveNames = new Set(),
    aiConfig = null,
    verbose = false,
    plugins = {},
  } = options;

  if (verbose) {
    process.env.DEOBFUSCATOR_VERBOSE = "1";
  }

  const log = (...args) => {
    if (verbose) process.stderr.write("[deobfuscator] " + args.join(" ") + "\n");
  };

  // ── Stage: Parse ──
  log("Parsing...");
  let ast = parser.parse(code, { sourceType: "script" });

  // [afterParse] plugins
  if (plugins.afterParse) {
    await runPlugins(ast, plugins.afterParse);
  }

  // ── Stage: Prepare (IIFE unwrap + anti-debug) ──
  const { ast: unwrappedAst, iifeStack } = unwrapIIFEs(ast, { log });
  ast = unwrappedAst;

  log("Running anti-debug removal...");
  {
    const s = applyTransform(ast, antiDebugRemoval);
    log("Anti-debug removal complete,", s.changes, "changes");
  }

  // [afterPrepare] plugins
  if (plugins.afterPrepare) {
    await runPlugins(ast, plugins.afterPrepare);
  }

  // ── Stage: Deobfuscate (iterative fixed-point loop) ──
  let totalChanges = 0;
  let iterations = 0;
  let checkpointCode = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    log("=== Pipeline iteration", iteration, "===");
    iterations = iteration;
    let iterationChanges = 0;

    const taintedNames = computeTaintedNames(ast, preserveNames);

    log("Running constant folding...");
    {
      const s = applyTransform(ast, constantFolding);
      log("Constant folding complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }

    log("Running object property collapse...");
    {
      const s = applyTransform(ast, objectPropertyCollapse);
      log("Object property collapse complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }

    log("Running constant object inlining...");
    {
      const s = { changes: 0 };
      constantObjectInlining.run(ast, s);
      log("Constant object inlining complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }

    log("Running object proxy inlining...");
    {
      const s = { changes: 0 };
      objectProxyInlining.run(ast, s);
      log("Object proxy inlining complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }

    log("Running control flow unflattening...");
    {
      const s = { changes: 0 };
      controlFlowUnflattening.run(ast, s);
      log("Control flow unflattening complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }

    log("Running string decryption...");
    {
      const s = { changes: 0 };
      await stringDecryptor.run(ast, s, { sandboxType, taintedNames });
      const consumedPaths = s.consumedPaths || [];
      log("String decryption complete,", s.changes, "decoder calls replaced,", consumedPaths.length, "nodes consumed");
      iterationChanges += s.changes;

      log("Running copy propagation...");
      {
        const s2 = { changes: 0 };
        copyPropagation.run(ast, s2, { taintedNames });
        log("Copy propagation complete,", s2.changes, "changes");
        iterationChanges += s2.changes;
      }

      log("Running dead code elimination...");
      {
        const s3 = { changes: 0 };
        deadCodeElimination.run(ast, s3, { consumedPaths, taintedNames });
        log("Dead code elimination complete,", s3.changes, "nodes removed");
        iterationChanges += s3.changes;
      }
    }

    log("Running comma expression splitting...");
    {
      const s = applyTransform(ast, commaExpressionSplitter);
      log("Comma expression splitting complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }

    totalChanges += iterationChanges;
    log("Iteration", iteration, "total changes:", iterationChanges);
    if (iterationChanges === 0) break;

    // Checkpoint every 8 iterations, save and return to allow restart
    // Checkpoint at iteration 9 (when iteration >= 9), save and return to allow restart
    if (iteration >= 9 && iteration < maxIterations) {
      log("Checkpoint: saving state at iteration", iteration, "...");
      checkpointCode = generate(ast, {
        comments: true,
        jsescOption: { minimal: true },
      }).code;
      log("Checkpoint saved. Run again to continue deobfuscation.");
      break;
    }
  }

  // [afterDeobfuscate] plugins
  if (plugins.afterDeobfuscate) {
    await runPlugins(ast, plugins.afterDeobfuscate);
  }

  // ── Stage: Unminify ──
  log("Running unminify...");
  {
    const s = applyTransform(ast, unminify);
    log("Unminify complete,", s.changes, "changes");
    totalChanges += s.changes;
  }

  // [afterUnminify] plugins
  if (plugins.afterUnminify) {
    await runPlugins(ast, plugins.afterUnminify);
  }

  // ── Stage: Transpile ──
  log("Running transpile...");
  {
    const s = applyTransform(ast, transpile);
    log("Transpile complete,", s.changes, "changes");
    totalChanges += s.changes;
  }

  // [afterTranspile] plugins
  if (plugins.afterTranspile) {
    await runPlugins(ast, plugins.afterTranspile);
  }

  // AI refinement (optional)
  if (aiConfig && aiConfig.provider) {
    log("Running AI refinement...");
    const s = { changes: 0 };
    await aiRefine.run(ast, s, aiConfig);
    log("AI refinement complete,", s.changes, "functions refined");
    totalChanges += s.changes;
  }

  // ── Stage: Unpack (Phase 6 — placeholder) ──

  // [afterUnpack] plugins
  if (plugins.afterUnpack) {
    await runPlugins(ast, plugins.afterUnpack);
  }

  // Generate output
  log("Generating output...");
  const output = generate(ast, {
    comments: true,
    jsescOption: { minimal: true },
  });

  // Re-wrap IIFE layers
  const finalCode = rewrapIIFEs(output.code, iifeStack, { log });

  log("Done!");

  return {
    code: finalCode,
    stats: { iterations, totalChanges },
    checkpoint: checkpointCode || null,
  };
}

module.exports = { deobfuscate };
