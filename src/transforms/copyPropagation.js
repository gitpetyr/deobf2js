const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[copyPropagation] " + args.join(" ") + "\n");
}

function copyPropagation(ast, taintedNames) {
  taintedNames = taintedNames || new Set();
  let totalChanges = 0;
  let pass = 0;

  while (true) {
    pass++;
    let changes = 0;

    traverse(ast, {
      VariableDeclarator(path) {
        const id = path.node.id;
        if (!t.isIdentifier(id)) return;

        // Skip tainted variables (preserve seed computation chains)
        if (taintedNames.has(id.name)) return;

        const init = path.node.init;
        if (!init) return;

        // Only propagate Identifiers and Literals
        if (!t.isIdentifier(init) && !t.isLiteral(init)) return;

        const binding = path.scope.getBinding(id.name);
        if (!binding) return;
        if (!binding.constant || binding.constantViolations.length > 0) return;

        const refs = binding.referencePaths;
        if (refs.length === 0) return;

        // Replace all references with the init value
        for (const ref of refs) {
          if (ref.node === id) continue; // skip the declarator's own id
          if (t.isIdentifier(init)) {
            ref.replaceWith(t.identifier(init.name));
          } else {
            ref.replaceWith(t.cloneNode(init));
          }
          changes++;
        }

        // Remove the declaration
        const declaration = path.parentPath;
        if (
          t.isVariableDeclaration(declaration.node) &&
          declaration.node.declarations.length === 1
        ) {
          declaration.remove();
        } else {
          path.remove();
        }
        changes++;
      },

      AssignmentExpression(path) {
        if (path.node.operator !== "=") return;
        const left = path.node.left;
        const right = path.node.right;

        if (!t.isIdentifier(left)) return;

        // Skip tainted variables
        if (taintedNames.has(left.name)) return;

        if (!t.isIdentifier(right) && !t.isLiteral(right)) return;

        const binding = path.scope.getBinding(left.name);
        if (!binding) return;

        if (binding.constant && binding.constantViolations.length === 0) {
          // Handle assignment expression aliases: a = b where b is known
          const refs = binding.referencePaths;
          for (const ref of refs) {
            if (ref.node === left) continue;
            if (t.isIdentifier(right)) {
              ref.replaceWith(t.identifier(right.name));
            } else {
              ref.replaceWith(t.cloneNode(right));
            }
            changes++;
          }
        } else if (binding.constantViolations.length === 1 && !binding.constant) {
          // Handle parameter reassignment with exactly 1 constant violation:
          // function(uz, ...) { uz = s; ... uz(...) ... }
          const violation = binding.constantViolations[0];
          if (!violation.isAssignmentExpression() || violation.node !== path.node) return;

          const assignLoc = path.node.start;
          const refs = binding.referencePaths;
          for (const ref of refs) {
            if (ref.node === left) continue;
            if (ref.node.start !== undefined && ref.node.start < assignLoc) continue;
            if (t.isIdentifier(right)) {
              ref.replaceWith(t.identifier(right.name));
            } else {
              ref.replaceWith(t.cloneNode(right));
            }
            changes++;
          }
        }
      },
    });

    log("Pass", pass, ":", changes, "changes");
    totalChanges += changes;

    if (changes === 0) break;

    // Refresh stale bindings
    traverse(ast, {
      Program(path) {
        path.scope.crawl();
      },
    });
  }

  log("Total changes:", totalChanges, "in", pass, "passes");
  return totalChanges;
}

module.exports = copyPropagation;
