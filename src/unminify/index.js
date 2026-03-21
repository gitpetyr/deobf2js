const { mergeTransforms } = require("../transforms/framework");

const computedProperties = require("./computedProperties");
const unminifyBooleans = require("./unminifyBooleans");
const voidToUndefined = require("./voidToUndefined");
const yoda = require("./yoda");
const removeDoubleNot = require("./removeDoubleNot");
const mergeStrings = require("./mergeStrings");
const blockStatements = require("./blockStatements");
const splitVariableDeclarations = require("./splitVariableDeclarations");
const infinity = require("./infinity");
const numberExpressions = require("./numberExpressions");
const sequence = require("./sequence");
const mergeElseIf = require("./mergeElseIf");
const logicalToIf = require("./logicalToIf");
const ternaryToIf = require("./ternaryToIf");
const forToWhile = require("./forToWhile");
const splitForLoopVars = require("./splitForLoopVars");
const unaryExpressions = require("./unaryExpressions");
const invertBooleanLogic = require("./invertBooleanLogic");
const rawLiterals = require("./rawLiterals");
const jsonParse = require("./jsonParse");
const typeofUndefined = require("./typeofUndefined");
const truncateNumberLiteral = require("./truncateNumberLiteral");
const stringLiteralCleanup = require("./stringLiteralCleanup");
const deadCode = require("./deadCode");

/**
 * All unminify transforms in recommended execution order.
 * Earlier transforms (literal cleanup) feed into later ones (dead code).
 */
const allTransforms = [
  // Literal normalization (run first — feeds into everything else)
  rawLiterals,
  stringLiteralCleanup,
  truncateNumberLiteral,
  unminifyBooleans,
  voidToUndefined,
  infinity,
  numberExpressions,
  mergeStrings,

  // Expression simplification
  computedProperties,
  yoda,
  removeDoubleNot,
  unaryExpressions,
  invertBooleanLogic,
  typeofUndefined,
  jsonParse,

  // Statement restructuring
  sequence,
  logicalToIf,
  ternaryToIf,
  mergeElseIf,
  blockStatements,
  splitVariableDeclarations,
  forToWhile,
  splitForLoopVars,

  // Dead code (run last — benefits from all simplifications above)
  deadCode,
];

/** Merged unminify transform — single traversal pass for all 24 transforms. */
const unminify = mergeTransforms({
  name: "unminify",
  tags: ["safe"],
  transforms: allTransforms,
});

module.exports = unminify;
module.exports.allTransforms = allTransforms;
