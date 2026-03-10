const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose)
    process.stderr.write("[deadCodeElimination] " + args.join(" ") + "\n");
}

function deadCodeElimination(ast, consumedPaths) {
  let removedCount = 0;

  // Collect consumed node names so Step 2 only removes related infrastructure
  const consumedNames = new Set();
  for (const p of consumedPaths) {
    const node = p.node;
    if (t.isFunctionDeclaration(node) && node.id) {
      consumedNames.add(node.id.name);
    } else if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (t.isIdentifier(d.id)) consumedNames.add(d.id.name);
      }
    }
  }

  // Step 1: Remove consumed paths (string arrays, wrappers, shuffle IIFEs, decoders)
  const consumedSet = new Set(consumedPaths.map((p) => p.node));
  traverse(ast, {
    enter(path) {
      if (consumedSet.has(path.node)) {
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

  // Step 2: Remove unreferenced declarations only if they referenced consumed infrastructure
  // This avoids deleting user code that happens to be unreferenced (e.g. exported functions)
  let deadCount = 0;
  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id.name;
      const binding = path.scope.getBinding(name);
      if (!binding || binding.referencePaths.length > 0) return;
      // Only remove if the function body referenced a consumed name
      const code = JSON.stringify(path.node);
      const refsConsumed = [...consumedNames].some((n) => code.includes('"' + n + '"'));
      if (refsConsumed) {
        path.remove();
        deadCount++;
      }
    },
    VariableDeclaration(path) {
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
          continue;
        }
        // Only count as dead if it referenced consumed infrastructure
        const code = JSON.stringify(declarator.node);
        const refsConsumed = [...consumedNames].some((n) => code.includes('"' + n + '"'));
        if (!refsConsumed) {
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
