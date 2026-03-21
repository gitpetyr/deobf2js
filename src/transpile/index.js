const { mergeTransforms } = require("../transforms/framework");

const optionalChaining = require("./optionalChaining");
const nullishCoalescing = require("./nullishCoalescing");
const nullishCoalescingAssignment = require("./nullishCoalescingAssignment");
const logicalAssignments = require("./logicalAssignments");
const templateLiterals = require("./templateLiterals");
const defaultParameters = require("./defaultParameters");

/**
 * All transpile transforms in recommended execution order.
 * Restores modern JS syntax from transpiled/downleveled patterns.
 */
const allTransforms = [
  optionalChaining,
  nullishCoalescing,
  nullishCoalescingAssignment,
  logicalAssignments,
  templateLiterals,
  defaultParameters,
];

/** Merged transpile transform — single traversal pass for all 6 transforms. */
const transpile = mergeTransforms({
  name: "transpile",
  tags: ["safe"],
  transforms: allTransforms,
});

module.exports = transpile;
module.exports.allTransforms = allTransforms;
