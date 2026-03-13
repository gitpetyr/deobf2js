const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { createClient, chat } = require("../ai/client");
const { getSystemPrompt, buildUserPrompt } = require("../ai/prompts");
const { extractFunctions } = require("../ai/functionExtractor");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) {
    process.stderr.write("[ai-refine] " + args.join(" ") + "\n");
  }
}

/**
 * Extract the first function node from parsed code.
 * Handles FunctionDeclaration, or VariableDeclaration with FunctionExpression/ArrowFunctionExpression.
 */
function extractFunctionNode(ast) {
  let found = null;
  traverse(ast, {
    FunctionDeclaration(path) {
      if (!found) {
        found = { node: path.node, paramCount: path.node.params.length };
        path.stop();
      }
    },
    VariableDeclarator(path) {
      if (
        !found &&
        (t.isFunctionExpression(path.node.init) ||
          t.isArrowFunctionExpression(path.node.init))
      ) {
        found = {
          node: path.parent, // The full VariableDeclaration
          fnNode: path.node.init,
          paramCount: path.node.init.params.length,
        };
        path.stop();
      }
    },
  });
  return found;
}

/**
 * Collect all referenced identifiers in a function node.
 */
function collectReferences(ast) {
  const refs = new Set();
  traverse(ast, {
    ReferencedIdentifier(path) {
      refs.add(path.node.name);
    },
  });
  return refs;
}

/**
 * AI refinement transform. Sends each function to AI for improvement.
 * @param {import("@babel/types").File} ast
 * @param {{ provider: string, model?: string, baseURL?: string }} aiConfig
 * @returns {Promise<number>} Number of functions refined
 */
async function aiRefine(ast, aiConfig) {
  const handle = createClient(aiConfig.provider, aiConfig);
  const { model } = handle;
  const systemPrompt = getSystemPrompt();
  const functions = extractFunctions(ast);

  log(`Extracted ${functions.length} functions for AI refinement (model: ${model})`);

  let changeCount = 0;

  for (const func of functions) {
    log(`Processing: ${func.name} (${func.code.split("\n").length} lines)`);

    try {
      const userPrompt = buildUserPrompt(
        func.code,
        func.externalDeps,
        func.callees
      );

      const response = await chat(handle, model, systemPrompt, userPrompt);

      if (!response || response.trim().length === 0) {
        log(`  Skipped ${func.name}: empty AI response`);
        continue;
      }

      // Validate: parse the returned code
      let returnedAST;
      try {
        returnedAST = parser.parse(response, { sourceType: "script" });
      } catch (parseErr) {
        log(`  Skipped ${func.name}: AI response has syntax errors - ${parseErr.message}`);
        continue;
      }

      // Extract function node from response
      const extracted = extractFunctionNode(returnedAST);
      if (!extracted) {
        log(`  Skipped ${func.name}: no function found in AI response`);
        continue;
      }

      // Validate: parameter count must match
      const originalParamCount = t.isFunctionDeclaration(func.node)
        ? func.node.params.length
        : func.node.params.length;

      if (extracted.paramCount !== originalParamCount) {
        log(
          `  Skipped ${func.name}: param count mismatch (original: ${originalParamCount}, returned: ${extracted.paramCount})`
        );
        continue;
      }

      // Validate: no new external dependencies introduced
      const originalRefs = new Set(func.externalDeps);
      const newRefs = collectReferences(returnedAST);
      let hasNewDeps = false;
      for (const ref of newRefs) {
        if (!originalRefs.has(ref) && !isLocalOrBuiltin(ref, returnedAST)) {
          log(`  Skipped ${func.name}: new external dependency "${ref}" introduced`);
          hasNewDeps = true;
          break;
        }
      }
      if (hasNewDeps) continue;

      // All validations passed — replace the node
      const replacementNode = extracted.fnNode
        ? extracted.node // VariableDeclaration
        : extracted.node; // FunctionDeclaration

      if (t.isFunctionDeclaration(func.node) && t.isFunctionDeclaration(replacementNode)) {
        func.path.replaceWith(replacementNode);
        changeCount++;
        log(`  Refined: ${func.name}`);
      } else if (
        t.isVariableDeclarator(func.path.node) &&
        t.isVariableDeclaration(replacementNode)
      ) {
        func.path.parentPath.replaceWith(replacementNode);
        changeCount++;
        log(`  Refined: ${func.name}`);
      } else if (t.isFunctionDeclaration(replacementNode)) {
        // AI returned FunctionDeclaration for what was a VariableDeclarator — still usable
        func.path.parentPath.replaceWith(replacementNode);
        changeCount++;
        log(`  Refined: ${func.name} (converted to FunctionDeclaration)`);
      } else {
        log(`  Skipped ${func.name}: node type mismatch`);
      }
    } catch (err) {
      log(`  Error refining ${func.name}: ${err.message}`);
    }
  }

  return changeCount;
}

/**
 * Check if a reference name is locally defined or a known builtin.
 */
function isLocalOrBuiltin(name, ast) {
  const BUILTINS = new Set([
    "console", "Math", "JSON", "Object", "Array", "String", "Number",
    "Boolean", "Date", "RegExp", "Error", "TypeError", "RangeError",
    "Promise", "Symbol", "parseInt", "parseFloat", "isNaN", "isFinite",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
    "eval", "undefined", "NaN", "Infinity", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "globalThis", "window", "document",
    "navigator", "location", "fetch", "URL", "atob", "btoa", "crypto",
    "performance", "arguments", "this",
  ]);

  if (BUILTINS.has(name)) return true;

  // Check if locally defined in the returned code
  let found = false;
  traverse(ast, {
    "FunctionDeclaration|VariableDeclarator"(path) {
      const id = path.node.id;
      if (t.isIdentifier(id) && id.name === name) {
        found = true;
        path.stop();
      }
    },
    "FunctionExpression|ArrowFunctionExpression"(path) {
      for (const param of path.node.params) {
        if (t.isIdentifier(param) && param.name === name) {
          found = true;
          path.stop();
        }
      }
    },
  });

  return found;
}

module.exports = aiRefine;
