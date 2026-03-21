const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const { createLogger } = require("../utils/logger");
const { log } = createLogger("constantObjectInlining");

function extractStaticProps(objExpr) {
  const propMap = new Map();
  for (const prop of objExpr.properties) {
    if (t.isSpreadElement(prop)) return null; // spreads make all props unpredictable
    if (!t.isObjectProperty(prop)) continue;  // skip methods, don't bail
    if (prop.computed) continue;              // skip computed keys

    let key;
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      key = prop.key.value;
    } else {
      continue;
    }

    if (!t.isLiteral(prop.value)) continue;
    propMap.set(key, prop.value);
  }
  if (propMap.size === 0) return null;
  return propMap;
}

module.exports = {
  name: "constantObjectInlining",
  tags: ["safe"],

  run(ast, state) {
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      // Phase 1: Collect ALL object literal definitions with position info
      const definitions = [];

      traverse(ast, {
        VariableDeclarator(path) {
          const id = path.node.id;
          if (!t.isIdentifier(id)) return;
          const init = path.node.init;
          if (!init || !t.isObjectExpression(init)) return;

          const propMap = extractStaticProps(init);
          if (!propMap) return;

          definitions.push({
            name: id.name,
            propMap,
            start: path.node.start,
            end: Infinity,
          });
        },
        AssignmentExpression(path) {
          if (path.node.operator !== "=") return;
          const left = path.node.left;
          const right = path.node.right;
          if (!t.isIdentifier(left)) return;
          if (!right || !t.isObjectExpression(right)) return;

          const propMap = extractStaticProps(right);
          if (!propMap) return;

          definitions.push({
            name: left.name,
            propMap,
            start: path.node.start,
            end: Infinity,
          });
        },
      });

      if (definitions.length === 0) break;

      // Phase 2: Collect ALL assignments to each variable name (for invalidation)
      const assignmentPositions = new Map(); // name -> sorted [start]

      traverse(ast, {
        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const name = path.node.id.name;
          if (!assignmentPositions.has(name)) assignmentPositions.set(name, []);
          assignmentPositions.get(name).push(path.node.start);
        },
        AssignmentExpression(path) {
          if (path.node.operator !== "=") return;
          if (!t.isIdentifier(path.node.left)) return;
          const name = path.node.left.name;
          if (!assignmentPositions.has(name)) assignmentPositions.set(name, []);
          assignmentPositions.get(name).push(path.node.start);
        },
      });

      for (const positions of assignmentPositions.values()) {
        positions.sort((a, b) => a - b);
      }

      // Phase 3: Compute validity range for each definition
      for (const def of definitions) {
        const positions = assignmentPositions.get(def.name) || [];
        // Find the first assignment to this name that comes AFTER this definition
        for (const pos of positions) {
          if (pos > def.start) {
            def.end = pos;
            break;
          }
        }
      }

      log("Pass", pass, ": found", definitions.length, "constant object definitions");

      // Phase 4: Replace MemberExpression lookups using position-aware matching
      traverse(ast, {
        MemberExpression(path) {
          const obj = path.node.object;
          if (!t.isIdentifier(obj)) return;

          // Resolve position: try node itself, then walk up parents for cloned nodes
          let refPos = path.node.start;
          if (refPos === undefined) {
            let pp = path.parentPath;
            while (pp && pp.node && pp.node.start === undefined) pp = pp.parentPath;
            if (pp && pp.node) refPos = pp.node.start;
          }

          const varName = obj.name;

          // Find the most recent applicable definition for this reference
          let bestDef = null;
          if (refPos !== undefined) {
            for (const def of definitions) {
              if (def.name !== varName) continue;
              if (def.start >= refPos) continue;
              if (refPos >= def.end) continue;
              if (!bestDef || def.start > bestDef.start) {
                bestDef = def;
              }
            }
          } else {
            // No position available: only safe if there's exactly one definition for this name
            const matching = definitions.filter(d => d.name === varName);
            if (matching.length === 1) bestDef = matching[0];
          }

          if (!bestDef) return;

          let key = null;
          if (!path.node.computed && t.isIdentifier(path.node.property)) {
            key = path.node.property.name;
          } else if (path.node.computed && t.isStringLiteral(path.node.property)) {
            key = path.node.property.value;
          }

          if (key === null) return;
          if (!bestDef.propMap.has(key)) return;

          // Don't replace if it's an assignment target
          if (path.parentPath.isAssignmentExpression() && path.parentPath.node.left === path.node) return;

          const value = bestDef.propMap.get(key);
          path.replaceWith(t.cloneNode(value));
          changes++;
        },
      });

      log("Pass", pass, ":", changes, "replacements");
      totalChanges += changes;

      if (changes === 0) break;

      // Refresh scopes
      traverse(ast, {
        Program(path) {
          path.scope.crawl();
        },
      });
    }

    log("Total changes:", totalChanges, "in", pass, "passes");
    state.changes += totalChanges;
  },
};
