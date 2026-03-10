const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose)
    process.stderr.write("[deadCodeElimination] " + args.join(" ") + "\n");
}

function deadCodeElimination(ast, consumedPaths) {
  let removedCount = 0;

  // Step 1: Remove consumed paths (string arrays, wrappers, shuffle IIFEs, decoders)
  const consumedSet = new Set(consumedPaths.map((p) => p.node));
  traverse(ast, {
    enter(path) {
      if (consumedSet.has(path.node) && path.parent.type === "Program") {
        path.remove();
        removedCount++;
      }
    },
  });
  log("Removed", removedCount, "consumed nodes");

  // Refresh bindings after removal
  traverse(ast, {
    Program(path) {
      path.scope.crawl();
    },
  });

  // Step 2: Remove unreferenced declarations
  let deadCount = 0;
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.parent.type !== "Program") return;
      const binding = path.scope.getBinding(path.node.id.name);
      if (binding && binding.referencePaths.length === 0) {
        path.remove();
        deadCount++;
      }
    },
    VariableDeclaration(path) {
      if (path.parent.type !== "Program") return;
      const declarators = path.get("declarations");
      let allDead = true;

      for (const declarator of declarators) {
        if (!t.isIdentifier(declarator.node.id)) {
          allDead = false;
          continue;
        }
        const binding = path.scope.getBinding(declarator.node.id.name);
        if (!binding || binding.referencePaths.length > 0) {
          allDead = false;
        }
      }

      if (allDead) {
        path.remove();
        deadCount++;
      }
    },
  });

  log("Removed", deadCount, "unreferenced declarations");
  return removedCount + deadCount;
}

module.exports = deadCodeElimination;
