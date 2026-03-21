const traverse = require("@babel/traverse").default;

const { createLogger } = require("../utils/logger");
const { log } = createLogger("mangle");

/**
 * Generate a short variable name from an index.
 * 0 -> a, 1 -> b, ..., 25 -> z, 26 -> aa, 27 -> ab, ...
 */
function generateName(index) {
  let name = "";
  do {
    name = String.fromCharCode(97 + (index % 26)) + name;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return name;
}

const RESERVED = new Set([
  "do", "if", "in", "of", "for", "let", "new", "try", "var", "case", "else",
  "enum", "eval", "null", "this", "true", "void", "with", "break", "catch",
  "class", "const", "false", "super", "throw", "while", "yield", "delete",
  "export", "import", "public", "return", "static", "switch", "typeof",
  "default", "extends", "finally", "package", "private", "continue",
  "debugger", "function", "arguments", "interface", "protected", "implements",
  "instanceof",
  // Common globals to avoid
  "undefined", "NaN", "Infinity",
]);

function isReserved(name) {
  return RESERVED.has(name);
}

module.exports = {
  name: "mangle",
  tags: ["safe"],
  scope: true,

  run(ast, state, options = {}) {
    const filter = options.filter || (() => true);
    let totalChanges = 0;

    traverse(ast, {
      Scope(path) {
        const bindings = path.scope.bindings;
        let nameIndex = 0;

        for (const [name, binding] of Object.entries(bindings)) {
          // Skip if name is already short (1-2 chars)
          if (name.length <= 2) continue;

          // Skip if filter says no
          if (!filter(name)) continue;

          // Generate a new name that doesn't conflict
          let newName;
          do {
            newName = generateName(nameIndex++);
          } while (
            path.scope.hasBinding(newName) ||
            path.scope.hasReference(newName) ||
            isReserved(newName)
          );

          // Rename using Babel's scope.rename which handles all references
          try {
            path.scope.rename(name, newName);
            totalChanges++;
            log("Renamed", name, "->", newName);
          } catch (e) {
            // Skip if rename fails (e.g., conflicts)
            log("Failed to rename", name, ":", e.message);
          }
        }
      },
    });

    log("Total changes:", totalChanges);
    state.changes += totalChanges;
  },
};
