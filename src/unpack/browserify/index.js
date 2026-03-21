const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { detectBrowserify } = require("./detect");
const { Module } = require("../module");
const { Bundle } = require("../bundle");

/**
 * Unpack a Browserify bundle into a Bundle of individual modules.
 *
 * @param {Object} ast - Babel AST of the full bundle
 * @returns {Bundle|null}
 */
function unpackBrowserify(ast) {
  const detected = detectBrowserify(ast);
  if (!detected) return null;

  const { modulesNode, entryIds } = detected;
  const modules = new Map();
  const depMaps = new Map();

  // Extract each module
  for (const prop of modulesNode.properties) {
    let id;
    if (t.isNumericLiteral(prop.key)) {
      id = prop.key.value;
    } else if (t.isStringLiteral(prop.key)) {
      id = prop.key.value;
    } else if (t.isIdentifier(prop.key)) {
      id = prop.key.name;
    } else {
      continue;
    }

    const [funcNode, depsNode] = prop.value.elements;

    // Extract body statements from the module function
    let bodyStatements;
    if (t.isBlockStatement(funcNode.body)) {
      bodyStatements = funcNode.body.body.map((stmt) => t.cloneNode(stmt, true));
    } else {
      bodyStatements = [t.expressionStatement(t.cloneNode(funcNode.body, true))];
    }

    const programAst = t.file(t.program(bodyStatements));
    modules.set(id, new Module(id, programAst));

    // Build dependency map: { "depName": targetId, ... }
    const depMap = {};
    for (const depProp of depsNode.properties) {
      if (!t.isObjectProperty(depProp)) continue;

      let depName;
      if (t.isStringLiteral(depProp.key)) {
        depName = depProp.key.value;
      } else if (t.isIdentifier(depProp.key)) {
        depName = depProp.key.name;
      } else {
        continue;
      }

      let targetId;
      if (t.isNumericLiteral(depProp.value)) {
        targetId = depProp.value.value;
      } else if (t.isStringLiteral(depProp.value)) {
        targetId = depProp.value.value;
      } else {
        continue;
      }

      depMap[depName] = targetId;
    }
    depMaps.set(id, depMap);
  }

  // Rewrite require() calls using dependency maps
  for (const [id, mod] of modules) {
    const depMap = depMaps.get(id) || {};
    rewriteBrowserifyRequire(mod.ast, depMap, modules);
  }

  const entryId = entryIds.length > 0 ? entryIds[0] : null;
  return new Bundle("browserify", entryId, modules);
}

/**
 * Rewrite require("depName") calls in a browserify module using its dependency map.
 *
 * @param {Object} moduleAst - Babel AST of the module
 * @param {Object} depMap - Dependency map { depName: targetId }
 * @param {Map} modules - All modules (for path lookup)
 */
function rewriteBrowserifyRequire(moduleAst, depMap, modules) {
  traverse(moduleAst, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;

      if (
        t.isIdentifier(callee, { name: "require" }) &&
        args.length === 1 &&
        t.isStringLiteral(args[0])
      ) {
        const depName = args[0].value;
        if (depName in depMap) {
          const targetId = depMap[depName];
          const targetMod = modules.get(targetId);
          const targetPath = targetMod
            ? `./${targetMod.path.replace(/\.js$/, "")}`
            : `./module_${targetId}`;
          args[0] = t.stringLiteral(targetPath);
        }
      }
    },
  });
}

module.exports = { unpackBrowserify };
