const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const {
  findStringArrays,
  findShuffleIIFEs,
  findDecoderFunctions,
} = require("../utils/astHelpers");
const { createJsdomInstance } = require("../utils/sandbox");
const { referencesAny } = require("../utils/taintAnalysis");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[stringDecryptor] " + args.join(" ") + "\n");
}

function evaluateArg(node) {
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isStringLiteral(node)) return node.value;
  if (
    t.isUnaryExpression(node, { operator: "-" }) &&
    t.isNumericLiteral(node.argument)
  ) {
    return -node.argument.value;
  }
  // Binary expressions with literal operands: e.g. 1204 + 0
  if (t.isBinaryExpression(node)) {
    const left = evaluateArg(node.left);
    const right = evaluateArg(node.right);
    if (left !== undefined && right !== undefined) {
      switch (node.operator) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right !== 0 ? left / right : undefined;
        case "%": return right !== 0 ? left % right : undefined;
        case "|": return left | right;
        case "&": return left & right;
        case "^": return left ^ right;
        case "<<": return left << right;
        case ">>": return left >> right;
        case ">>>": return left >>> right;
      }
    }
  }
  return undefined;
}

/**
 * Create a sandbox instance based on the requested type.
 * @param {string} sandboxType - "jsdom" (default) or "playwright"
 */
async function createSandboxInstance(sandboxType) {
  if (sandboxType === "playwright") {
    const { createPlaywrightInstance } = require("../utils/playwrightSandbox");
    return await createPlaywrightInstance();
  }
  return createJsdomInstance();
}

async function stringDecryptor(ast, options = {}) {
  const sandboxType = options.sandboxType || "jsdom";
  const taintedNames = options.taintedNames || new Set();

  // Step 1: Detect components
  const stringArrays = findStringArrays(ast);
  const arrayNames = stringArrays.map((sa) => sa.name);
  log("Found string arrays:", arrayNames.join(", ") || "(none)");

  if (arrayNames.length === 0) {
    log("No string arrays found, skipping");
    return { consumedPaths: [] };
  }

  const shuffleIIFEs = findShuffleIIFEs(ast, arrayNames);
  log("Found shuffle IIFEs:", shuffleIIFEs.length);

  const decoderFunctions = findDecoderFunctions(ast, arrayNames);
  const decoderNames = decoderFunctions.map((df) => df.name);
  log("Found decoder functions:", decoderNames.join(", ") || "(none)");

  if (decoderNames.length === 0) {
    log("No decoder functions found, skipping");
    return { consumedPaths: [] };
  }

  // Step 2: Extract source code in dependency order
  const codeParts = [];

  // Arrays first
  for (const sa of stringArrays) {
    codeParts.push(generate(sa.path.node).code);
  }

  // Wrapper functions
  const allWrapperPaths = [];
  for (const df of decoderFunctions) {
    for (const wp of df.wrapperPaths) {
      codeParts.push(generate(wp.node).code);
      allWrapperPaths.push(wp);
    }
  }

  // Shuffle IIFEs
  for (const si of shuffleIIFEs) {
    codeParts.push(generate(si.path.node).code);
  }

  // Decoder functions
  for (const df of decoderFunctions) {
    codeParts.push(generate(df.path.node).code);
  }

  const bootstrapCode = codeParts.join("\n");
  log("Bootstrap code length:", bootstrapCode.length);

  // Step 3: Execute in sandbox
  log("Creating sandbox (type:", sandboxType + ")...");
  const sandbox = await createSandboxInstance(sandboxType);
  try {
    await sandbox.execute(bootstrapCode);
  } catch (err) {
    log("Sandbox execution error:", err.message);
    await sandbox.close();
    return { consumedPaths: [] };
  }
  log("Sandbox execution successful");

  // Step 4: Build alias map via single traversal + iterative resolution
  const aliasMap = new Map(); // alias -> original decoder name
  for (const name of decoderNames) {
    aliasMap.set(name, name);
  }

  const candidates = [];
  traverse(ast, {
    VariableDeclarator(path) {
      const id = path.node.id;
      const init = path.node.init;
      if (t.isIdentifier(id) && t.isIdentifier(init)) {
        candidates.push({ target: id.name, source: init.name });
      }
    },
    AssignmentExpression(path) {
      const left = path.node.left;
      const right = path.node.right;
      if (
        path.node.operator === "=" &&
        t.isIdentifier(left) &&
        t.isIdentifier(right)
      ) {
        candidates.push({ target: left.name, source: right.name });
      }
    },
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const c of candidates) {
      if (aliasMap.has(c.source) && !aliasMap.has(c.target)) {
        aliasMap.set(c.target, aliasMap.get(c.source));
        changed = true;
      }
    }
  }
  log("Alias map size:", aliasMap.size);

  // Step 5: Replace decoder calls with resolved strings
  let replacedCount = 0;

  for (const calleeName of aliasMap.keys()) {
    const originalDecoder = aliasMap.get(calleeName);

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isIdentifier(callee)) return;
        if (callee.name !== calleeName) return;

        // Skip if any argument references a tainted (preserved) variable
        if (taintedNames.size > 0) {
          const argsTainted = path.node.arguments.some(arg => referencesAny(arg, taintedNames));
          if (argsTainted) {
            log("Skipping tainted decoder call:", calleeName);
            return;
          }
        }

        const args = path.node.arguments;
        const evalArgs = args.map(evaluateArg);
        if (evalArgs.some((a) => a === undefined)) return;

        // Mark for replacement (collect, don't await inside traverse)
        path.__pendingArgs = evalArgs;
        path.__pendingDecoder = originalDecoder;
      },
    });
  }

  // Batch-resolve all pending calls
  const pendingPaths = [];
  traverse(ast, {
    CallExpression(path) {
      if (path.__pendingArgs) {
        pendingPaths.push(path);
      }
    },
  });

  for (const path of pendingPaths) {
    try {
      const result = await sandbox.call(path.__pendingDecoder, path.__pendingArgs);
      if (typeof result === "string") {
        path.replaceWith(t.stringLiteral(result));
        replacedCount++;
      }
    } catch (err) {
      log("Call evaluation failed for", path.__pendingDecoder, ":", err.message);
    }
  }

  log("Replaced", replacedCount, "decoder calls");

  // Cleanup
  await sandbox.close();

  // Step 6: Collect consumed paths
  const consumedPaths = [];
  for (const sa of stringArrays) consumedPaths.push(sa.path);
  for (const si of shuffleIIFEs) consumedPaths.push(si.path);
  for (const df of decoderFunctions) {
    consumedPaths.push(df.path);
    for (const wp of df.wrapperPaths) consumedPaths.push(wp);
  }

  return { consumedPaths };
}

module.exports = stringDecryptor;
