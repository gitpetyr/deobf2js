const parser = require("@babel/parser");
const t = require("@babel/types");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

/**
 * @typedef {'afterParse' | 'afterPrepare' | 'afterDeobfuscate' | 'afterUnminify' | 'afterTranspile' | 'afterUnpack'} Stage
 *
 * @typedef {Object} PluginObject
 * @property {string} [name]
 * @property {function(Object): (void|Promise<void>)} [pre]
 * @property {function(Object): (void|Promise<void>)} [post]
 * @property {import("@babel/traverse").Visitor} [visitor]
 *
 * @typedef {Object} PluginAPI
 * @property {typeof parser.parse} parse
 * @property {typeof t} types
 * @property {typeof traverse} traverse
 * @property {typeof generate} generate
 *
 * @typedef {function(PluginAPI): PluginObject} Plugin
 */

/** @type {PluginAPI} */
const pluginAPI = {
  parse: parser.parse.bind(parser),
  types: t,
  traverse,
  generate,
};

/**
 * Run an array of plugins against an AST.
 * Executes: all pre() hooks → merged visitors → all post() hooks.
 *
 * @param {import("@babel/types").Node} ast
 * @param {Plugin[]} plugins
 * @returns {Promise<void>}
 */
async function runPlugins(ast, plugins) {
  if (!plugins || plugins.length === 0) return;

  const resolved = plugins.map((p) => p(pluginAPI));

  // Run pre hooks
  for (const plugin of resolved) {
    if (plugin.pre) {
      await plugin.pre({});
    }
  }

  // Merge and run visitors
  const visitors = resolved.filter((p) => p.visitor).map((p) => p.visitor);
  if (visitors.length > 0) {
    const { visitors: v } = require("@babel/traverse");
    const merged = v.merge(visitors);
    traverse(ast, merged);
  }

  // Run post hooks
  for (const plugin of resolved) {
    if (plugin.post) {
      await plugin.post({});
    }
  }
}

module.exports = { runPlugins, pluginAPI };
