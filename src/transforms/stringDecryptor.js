const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const {
  findStringArrays,
  findShuffleIIFEs,
  findDecoderFunctions,
} = require("../utils/astHelpers");
const {
  createSandbox,
  executeInSandbox,
  callFunctionInSandbox,
} = require("../utils/sandbox");

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
  return undefined;
}

function stringDecryptor(ast) {
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
  const { context } = createSandbox();
  try {
    executeInSandbox(context, bootstrapCode);
  } catch (err) {
    log("Sandbox execution error:", err.message);
    return { consumedPaths: [] };
  }
  log("Sandbox execution successful");

  // Step 4: Build alias map via iterative BFS
  const aliasMap = new Map(); // alias -> original decoder name
  for (const name of decoderNames) {
    aliasMap.set(name, name);
  }

  let changed = true;
  while (changed) {
    changed = false;
    traverse(ast, {
      VariableDeclarator(path) {
        const id = path.node.id;
        const init = path.node.init;
        if (
          t.isIdentifier(id) &&
          t.isIdentifier(init) &&
          aliasMap.has(init.name) &&
          !aliasMap.has(id.name)
        ) {
          aliasMap.set(id.name, aliasMap.get(init.name));
          changed = true;
        }
      },
      AssignmentExpression(path) {
        const left = path.node.left;
        const right = path.node.right;
        if (
          path.node.operator === "=" &&
          t.isIdentifier(left) &&
          t.isIdentifier(right) &&
          aliasMap.has(right.name) &&
          !aliasMap.has(left.name)
        ) {
          aliasMap.set(left.name, aliasMap.get(right.name));
          changed = true;
        }
      },
    });
  }
  log("Alias map size:", aliasMap.size);

  // Step 5: Replace decoder calls with resolved strings
  let replacedCount = 0;

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (!t.isIdentifier(callee)) return;
      if (!aliasMap.has(callee.name)) return;

      const originalDecoder = aliasMap.get(callee.name);
      const args = path.node.arguments;
      const evalArgs = args.map(evaluateArg);

      if (evalArgs.some((a) => a === undefined)) return;

      try {
        const result = callFunctionInSandbox(context, originalDecoder, evalArgs);
        if (typeof result === "string") {
          path.replaceWith(t.stringLiteral(result));
          replacedCount++;
        }
      } catch (err) {
        log("Call evaluation failed for", callee.name, ":", err.message);
      }
    },
  });

  log("Replaced", replacedCount, "decoder calls");

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
