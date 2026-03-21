const traverse = require("@babel/traverse").default;
const visitors = require("@babel/traverse").visitors;

/**
 * @typedef {{ changes: number, [key: string]: any }} TransformState
 *
 * @typedef {'safe' | 'unsafe'} Tag
 *
 * @typedef {Object} Transform
 * @property {string} name
 * @property {Tag[]} tags
 * @property {boolean} [scope] - Whether visitor needs scope info
 * @property {function(import("@babel/types").Node, TransformState, *=): void} [run]
 * @property {function(*=): import("@babel/traverse").Visitor} [visitor]
 *
 * @typedef {Object} AsyncTransform
 * @property {string} name
 * @property {Tag[]} tags
 * @property {boolean} [scope]
 * @property {function(import("@babel/types").Node, TransformState, *=): Promise<void>} [run]
 * @property {function(*=): import("@babel/traverse").Visitor} [visitor]
 */

/**
 * Apply a synchronous transform to an AST.
 * @param {import("@babel/types").Node} ast
 * @param {Transform} transform
 * @param {*} [options]
 * @returns {TransformState}
 */
function applyTransform(ast, transform, options) {
  const state = { changes: 0 };

  if (transform.run) {
    transform.run(ast, state, options);
  }

  if (transform.visitor) {
    const visitorObj = transform.visitor(options);
    traverse(ast, visitorObj, undefined, state);
  }

  return state;
}

/**
 * Apply an async transform to an AST.
 * @param {import("@babel/types").Node} ast
 * @param {AsyncTransform} transform
 * @param {*} [options]
 * @returns {Promise<TransformState>}
 */
async function applyTransformAsync(ast, transform, options) {
  const state = { changes: 0 };

  if (transform.run) {
    await transform.run(ast, state, options);
  }

  if (transform.visitor) {
    const visitorObj = transform.visitor(options);
    traverse(ast, visitorObj, undefined, state);
  }

  return state;
}

/**
 * Apply multiple synchronous transforms in a single traversal pass.
 * Merges all visitors using @babel/traverse visitors.merge().
 * @param {import("@babel/types").Node} ast
 * @param {Transform[]} transforms
 * @returns {TransformState}
 */
function applyTransforms(ast, transforms) {
  const state = { changes: 0 };

  // Run imperative phases first
  for (const transform of transforms) {
    if (transform.run) {
      transform.run(ast, state);
    }
  }

  // Merge and run visitors
  const visitorList = transforms
    .filter((t) => t.visitor)
    .map((t) => t.visitor());

  if (visitorList.length > 0) {
    const merged = visitors.merge(visitorList);
    traverse(ast, merged, undefined, state);
  }

  return state;
}

/**
 * Compose multiple transforms into a single transform.
 * @param {{ name: string, tags: Tag[], transforms: Transform[] }} config
 * @returns {Transform}
 */
function mergeTransforms({ name, tags, transforms }) {
  return {
    name,
    tags,
    run(ast, state) {
      for (const transform of transforms) {
        if (transform.run) {
          transform.run(ast, state);
        }
      }
    },
    visitor() {
      const visitorList = transforms
        .filter((t) => t.visitor)
        .map((t) => t.visitor());

      if (visitorList.length === 0) return {};
      return visitors.merge(visitorList);
    },
  };
}

module.exports = { applyTransform, applyTransformAsync, applyTransforms, mergeTransforms };
