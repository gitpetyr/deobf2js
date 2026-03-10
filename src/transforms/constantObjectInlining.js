const traverse = require("@babel/traverse").default;
const t = require("@babel/types");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[constantObjectInlining] " + args.join(" ") + "\n");
}

function constantObjectInlining(ast) {
  let totalChanges = 0;
  let pass = 0;

  while (true) {
    pass++;
    let changes = 0;

    // Collect constant object declarations: var Vg = { W: 1204, M: 1453, ... }
    const objectMaps = new Map(); // name -> { propMap, bindingScope }

    traverse(ast, {
      VariableDeclarator(path) {
        const id = path.node.id;
        if (!t.isIdentifier(id)) return;
        const init = path.node.init;
        if (!init || !t.isObjectExpression(init)) return;

        const propMap = extractStaticProps(init);
        if (!propMap) return;

        objectMaps.set(id.name, { propMap, scope: path.scope });
      },
      // Also handle parameter reassignment: Vg = { W: 1204, ... }
      AssignmentExpression(path) {
        if (path.node.operator !== "=") return;
        const left = path.node.left;
        const right = path.node.right;
        if (!t.isIdentifier(left)) return;
        if (!right || !t.isObjectExpression(right)) return;

        const propMap = extractStaticProps(right);
        if (!propMap) return;

        objectMaps.set(left.name, { propMap, scope: path.scope });
      },
    });

    if (objectMaps.size === 0) break;
    log("Pass", pass, ": found", objectMaps.size, "constant objects");

    // Replace MemberExpression lookups with literal values
    traverse(ast, {
      MemberExpression(path) {
        const obj = path.node.object;
        if (!t.isIdentifier(obj)) return;

        const entry = objectMaps.get(obj.name);
        if (!entry) return;

        let key = null;
        if (!path.node.computed && t.isIdentifier(path.node.property)) {
          key = path.node.property.name;
        } else if (path.node.computed && t.isStringLiteral(path.node.property)) {
          key = path.node.property.value;
        }

        if (key === null) return;
        if (!entry.propMap.has(key)) return;

        // Don't replace if it's an assignment target
        if (path.parentPath.isAssignmentExpression() && path.parentPath.node.left === path.node) return;

        const value = entry.propMap.get(key);
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
  return totalChanges;
}

function extractStaticProps(objExpr) {
  const propMap = new Map();
  for (const prop of objExpr.properties) {
    if (!t.isObjectProperty(prop)) return null;
    if (prop.computed) return null;

    let key;
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      key = prop.key.value;
    } else {
      return null;
    }

    if (!t.isLiteral(prop.value)) continue;
    propMap.set(key, prop.value);
  }
  if (propMap.size === 0) return null;
  return propMap;
}

module.exports = constantObjectInlining;
