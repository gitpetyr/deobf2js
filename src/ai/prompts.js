const SYSTEM_PROMPT = `You are a JavaScript code clarity expert. Your task is to improve deobfuscated JavaScript functions for readability while preserving exact behavior.

Rules:
1. Rename obfuscated variables and parameters to meaningful, descriptive names based on usage context.
2. Simplify control flow: merge nested conditions, use early returns, replace simple if/else with ternary where appropriate.
3. Remove redundant logic: dead branches, unused assignments, no-op statements.
4. Eliminate dead code: unreferenced local variables, unreachable code after return/throw.
5. Normalize property access: convert bracket notation obj["prop"] to dot notation obj.prop where the key is a valid identifier.

Strict constraints:
- Do NOT change the function signature (name, parameter count, parameter order).
- Do NOT change the function's return value semantics.
- Do NOT add, remove, or modify external dependencies (calls to functions/objects defined outside this function).
- Do NOT add comments or type annotations.
- Output ONLY the raw JavaScript function. No markdown, no explanation, no wrapping.`;

/**
 * Build the user prompt for a single function.
 * @param {string} functionCode - The function source code
 * @param {string[]} externalDeps - Names of external variables referenced
 * @param {{ name: string, snippet: string }[]} callees - External functions called, with code snippets
 * @returns {string}
 */
function buildUserPrompt(functionCode, externalDeps, callees) {
  const parts = ["Improve this function:\n"];
  parts.push(functionCode);

  if (externalDeps.length > 0) {
    parts.push("\nExternal variables referenced: " + externalDeps.join(", "));
  }

  if (callees.length > 0) {
    parts.push("\nExternal functions called:");
    for (const c of callees) {
      parts.push(`\n// ${c.name}:\n${c.snippet}`);
    }
  }

  return parts.join("\n");
}

function getSystemPrompt() {
  return SYSTEM_PROMPT;
}

module.exports = { getSystemPrompt, buildUserPrompt };
