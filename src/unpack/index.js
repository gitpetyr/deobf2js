const { detectWebpack } = require("./webpack/detect");
const { extractModules } = require("./webpack/extractModules");
const { rewriteRequire } = require("./webpack/rewriteRequire");
const { unpackBrowserify } = require("./browserify/index");
const { Bundle } = require("./bundle");

/**
 * Detect and unpack a bundled JavaScript file into individual modules.
 *
 * Supports:
 *   - Webpack 4 (array-based module list)
 *   - Webpack 5 (object-based __webpack_modules__)
 *   - Browserify (double-IIFE with module map)
 *
 * @param {Object} ast - Babel AST of the full bundle
 * @returns {Bundle|null} Bundle instance or null if no bundle pattern detected
 */
function unpack(ast) {
  // Try webpack first
  const wp = detectWebpack(ast);
  if (wp) {
    const modules = extractModules(wp.modulesNode, wp.type);
    for (const [id, mod] of modules) {
      rewriteRequire(mod.ast, modules);
    }
    return new Bundle(wp.type, wp.entryId, modules);
  }

  // Try browserify
  const bf = unpackBrowserify(ast);
  if (bf) return bf;

  return null;
}

module.exports = { unpack };
