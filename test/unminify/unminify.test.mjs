import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const { applyTransform } = require("../../src/transforms/framework");

function transform(code, transformModule) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = applyTransform(ast, transformModule);
  return { code: generate(ast).code, changes: state.changes };
}

// --- Individual transform imports ---
const computedProperties = require("../../src/unminify/computedProperties");
const unminifyBooleans = require("../../src/unminify/unminifyBooleans");
const voidToUndefined = require("../../src/unminify/voidToUndefined");
const yoda = require("../../src/unminify/yoda");
const removeDoubleNot = require("../../src/unminify/removeDoubleNot");
const mergeStrings = require("../../src/unminify/mergeStrings");
const blockStatements = require("../../src/unminify/blockStatements");
const splitVariableDeclarations = require("../../src/unminify/splitVariableDeclarations");
const infinity = require("../../src/unminify/infinity");
const numberExpressions = require("../../src/unminify/numberExpressions");
const sequence = require("../../src/unminify/sequence");
const mergeElseIf = require("../../src/unminify/mergeElseIf");
const logicalToIf = require("../../src/unminify/logicalToIf");
const ternaryToIf = require("../../src/unminify/ternaryToIf");
const forToWhile = require("../../src/unminify/forToWhile");
const splitForLoopVars = require("../../src/unminify/splitForLoopVars");
const unaryExpressions = require("../../src/unminify/unaryExpressions");
const invertBooleanLogic = require("../../src/unminify/invertBooleanLogic");
const rawLiterals = require("../../src/unminify/rawLiterals");
const jsonParse = require("../../src/unminify/jsonParse");
const typeofUndefined = require("../../src/unminify/typeofUndefined");
const truncateNumberLiteral = require("../../src/unminify/truncateNumberLiteral");
const stringLiteralCleanup = require("../../src/unminify/stringLiteralCleanup");
const deadCode = require("../../src/unminify/deadCode");
const unminify = require("../../src/unminify/index");

// ============================================================
// 1. computedProperties
// ============================================================
describe("computedProperties", () => {
  it('converts obj["foo"] to obj.foo', () => {
    const result = transform('obj["foo"];', computedProperties);
    expect(result.code).toBe("obj.foo;");
    expect(result.changes).toBe(1);
  });

  it("converts computed object property keys to identifiers", () => {
    const result = transform('var o = { ["bar"]: 1 };', computedProperties);
    expect(result.code).toBe("var o = {\n  bar: 1\n};");
    expect(result.changes).toBe(1);
  });

  it('skips invalid identifiers like obj["not-valid"]', () => {
    const result = transform('obj["not-valid"];', computedProperties);
    expect(result.code).toBe('obj["not-valid"];');
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 2. unminifyBooleans
// ============================================================
describe("unminifyBooleans", () => {
  it("converts !0 to true", () => {
    const result = transform("!0;", unminifyBooleans);
    expect(result.code).toBe("true;");
    expect(result.changes).toBe(1);
  });

  it("converts !1 to false", () => {
    const result = transform("!1;", unminifyBooleans);
    expect(result.code).toBe("false;");
    expect(result.changes).toBe(1);
  });

  it("does not change !x (non-numeric argument)", () => {
    const result = transform("!x;", unminifyBooleans);
    expect(result.code).toBe("!x;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 3. voidToUndefined
// ============================================================
describe("voidToUndefined", () => {
  it("converts void 0 to undefined", () => {
    const result = transform("void 0;", voidToUndefined);
    expect(result.code).toBe("undefined;");
    expect(result.changes).toBe(1);
  });

  it('converts void "anything" to undefined', () => {
    const result = transform('void "anything";', voidToUndefined);
    expect(result.code).toBe("undefined;");
    expect(result.changes).toBe(1);
  });

  it("does not change void with non-literal argument", () => {
    const result = transform("void f();", voidToUndefined);
    expect(result.code).toBe("void f();");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 4. yoda
// ============================================================
describe("yoda", () => {
  it('swaps "foo" === x to x === "foo"', () => {
    const result = transform('"foo" === x;', yoda);
    expect(result.code).toBe('x === "foo";');
    expect(result.changes).toBe(1);
  });

  it("swaps null !== x to x !== null", () => {
    const result = transform("null !== x;", yoda);
    expect(result.code).toBe("x !== null;");
    expect(result.changes).toBe(1);
  });

  it('does not change x === "foo" (already correct order)', () => {
    const result = transform('x === "foo";', yoda);
    expect(result.code).toBe('x === "foo";');
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 5. removeDoubleNot
// ============================================================
describe("removeDoubleNot", () => {
  it("removes !!x in boolean context (if test)", () => {
    const result = transform("if (!!x) {}", removeDoubleNot);
    expect(result.code).toBe("if (x) {}");
    expect(result.changes).toBe(1);
  });

  it("removes !!x in while test", () => {
    const result = transform("while (!!x) {}", removeDoubleNot);
    expect(result.code).toBe("while (x) {}");
    expect(result.changes).toBe(1);
  });

  it("does not remove !!x in non-boolean context (var assignment)", () => {
    const result = transform("var y = !!x;", removeDoubleNot);
    expect(result.code).toBe("var y = !!x;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 6. mergeStrings
// ============================================================
describe("mergeStrings", () => {
  it('merges "a" + "b" into "ab"', () => {
    const result = transform('"a" + "b";', mergeStrings);
    expect(result.code).toBe('"ab";');
    expect(result.changes).toBe(1);
  });

  it('merges "hello" + " " + "world" into "hello world"', () => {
    const result = transform('"hello" + " " + "world";', mergeStrings);
    expect(result.code).toBe('"hello world";');
    expect(result.changes).toBeGreaterThanOrEqual(1);
  });

  it("does not merge string + non-string", () => {
    const result = transform('"a" + x;', mergeStrings);
    expect(result.code).toBe('"a" + x;');
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 7. blockStatements
// ============================================================
describe("blockStatements", () => {
  it("wraps if consequent in block statement", () => {
    const result = transform("if (x) y();", blockStatements);
    expect(result.code).toContain("{");
    expect(result.code).toContain("y()");
    expect(result.changes).toBe(1);
  });

  it("wraps while body in block statement", () => {
    const result = transform("while (x) y();", blockStatements);
    expect(result.code).toContain("{");
    expect(result.code).toContain("y()");
    expect(result.changes).toBe(1);
  });

  it("does not change already-braced if", () => {
    const result = transform("if (x) { y(); }", blockStatements);
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 8. splitVariableDeclarations
// ============================================================
describe("splitVariableDeclarations", () => {
  it("splits var a = 1, b = 2 into two declarations", () => {
    const result = transform("var a = 1, b = 2;", splitVariableDeclarations);
    expect(result.code).toContain("var a = 1;");
    expect(result.code).toContain("var b = 2;");
    expect(result.changes).toBe(1);
  });

  it("does not split single declarator", () => {
    const result = transform("var a = 1;", splitVariableDeclarations);
    expect(result.code).toBe("var a = 1;");
    expect(result.changes).toBe(0);
  });

  it("does not split for-loop init", () => {
    const result = transform("for (var i = 0, j = 1;;) {}", splitVariableDeclarations);
    expect(result.code).toContain("var i = 0, j = 1");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 9. infinity
// ============================================================
describe("infinity", () => {
  it("converts 1 / 0 to Infinity", () => {
    const result = transform("1 / 0;", infinity);
    expect(result.code).toBe("Infinity;");
    expect(result.changes).toBe(1);
  });

  it("converts -(1 / 0) to -Infinity", () => {
    const result = transform("-(1 / 0);", infinity);
    expect(result.code).toBe("-Infinity;");
    expect(result.changes).toBe(1);
  });

  it("does not change 2 / 0", () => {
    const result = transform("2 / 0;", infinity);
    expect(result.code).toBe("2 / 0;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 10. numberExpressions
// ============================================================
describe("numberExpressions", () => {
  it("converts +5 to 5 (redundant positive)", () => {
    const result = transform("+5;", numberExpressions);
    expect(result.code).toBe("5;");
    expect(result.changes).toBe(1);
  });

  it("converts -0 to 0", () => {
    const result = transform("-0;", numberExpressions);
    expect(result.code).toBe("0;");
    expect(result.changes).toBe(1);
  });

  it("does not change -5 (meaningful negation)", () => {
    const result = transform("-5;", numberExpressions);
    expect(result.code).toBe("-5;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 11. sequence
// ============================================================
describe("sequence", () => {
  it("splits return a(), b into a(); return b;", () => {
    const result = transform("function f() { return a(), b; }", sequence);
    expect(result.code).toContain("a();");
    expect(result.code).toContain("return b;");
    expect(result.changes).toBe(1);
  });

  it("splits throw with sequence expression", () => {
    const result = transform("function f() { throw (a(), b); }", sequence);
    expect(result.code).toContain("a();");
    expect(result.code).toContain("throw b;");
    expect(result.changes).toBe(1);
  });

  it("does not change return without sequence", () => {
    const result = transform("function f() { return x; }", sequence);
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 12. mergeElseIf
// ============================================================
describe("mergeElseIf", () => {
  it("merges else { if (x) {} } into else if (x) {}", () => {
    const result = transform("if (a) {} else { if (b) {} }", mergeElseIf);
    expect(result.code).toContain("else if (b)");
    expect(result.changes).toBe(1);
  });

  it("does not merge when else block has multiple statements", () => {
    const result = transform("if (a) {} else { x(); if (b) {} }", mergeElseIf);
    expect(result.changes).toBe(0);
  });

  it("does not change already-correct else if", () => {
    const result = transform("if (a) {} else if (b) {}", mergeElseIf);
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 13. logicalToIf
// ============================================================
describe("logicalToIf", () => {
  it("converts a && b() to if (a) b()", () => {
    const result = transform("a && b();", logicalToIf);
    expect(result.code).toContain("if (a)");
    expect(result.code).toContain("b()");
    expect(result.changes).toBe(1);
  });

  it("converts a || b() to if (!a) b()", () => {
    const result = transform("a || b();", logicalToIf);
    expect(result.code).toContain("if (!a)");
    expect(result.code).toContain("b()");
    expect(result.changes).toBe(1);
  });

  it("does not convert logical expression inside assignment", () => {
    const result = transform("var x = a && b;", logicalToIf);
    expect(result.code).toBe("var x = a && b;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 14. ternaryToIf
// ============================================================
describe("ternaryToIf", () => {
  it("converts a ? b() : c() statement to if/else", () => {
    const result = transform("a ? b() : c();", ternaryToIf);
    expect(result.code).toContain("if (a)");
    expect(result.code).toContain("b()");
    expect(result.code).toContain("c()");
    expect(result.changes).toBe(1);
  });

  it("converts return a ? b : c to if/else return", () => {
    const result = transform("function f() { return a ? b : c; }", ternaryToIf);
    expect(result.code).toContain("if (a)");
    expect(result.code).toContain("return b;");
    expect(result.code).toContain("return c;");
    expect(result.changes).toBe(1);
  });

  it("does not convert ternary in assignment", () => {
    const result = transform("var x = a ? b : c;", ternaryToIf);
    expect(result.code).toBe("var x = a ? b : c;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 15. forToWhile
// ============================================================
describe("forToWhile", () => {
  it("converts for (;x;) {} to while (x) {}", () => {
    const result = transform("for (;x;) {}", forToWhile);
    expect(result.code).toBe("while (x) {}");
    expect(result.changes).toBe(1);
  });

  it("converts for (;;) {} to while (true) {}", () => {
    const result = transform("for (;;) {}", forToWhile);
    expect(result.code).toBe("while (true) {}");
    expect(result.changes).toBe(1);
  });

  it("does not convert for loop with init or update", () => {
    const result = transform("for (var i = 0; i < n; i++) {}", forToWhile);
    expect(result.code).toContain("for");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 16. splitForLoopVars
// ============================================================
describe("splitForLoopVars", () => {
  it("hoists var init out of for loop", () => {
    const result = transform("for (var i = 0; i < n; i++) {}", splitForLoopVars);
    expect(result.code).toContain("var i = 0;");
    expect(result.code).toContain("for (;");
    expect(result.changes).toBe(1);
  });

  it("does not change for loop without var init", () => {
    const result = transform("for (i = 0; i < n; i++) {}", splitForLoopVars);
    expect(result.changes).toBe(0);
  });

  it("does not change for-in loop", () => {
    const result = transform("for (var k in obj) {}", splitForLoopVars);
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 17. unaryExpressions
// ============================================================
describe("unaryExpressions", () => {
  it("simplifies -(-x) to x", () => {
    const result = transform("-(-x);", unaryExpressions);
    expect(result.code).toBe("x;");
    expect(result.changes).toBe(1);
  });

  it("simplifies ~(~x) to x", () => {
    const result = transform("~(~x);", unaryExpressions);
    expect(result.code).toBe("x;");
    expect(result.changes).toBe(1);
  });

  it('converts typeof undefined to "undefined"', () => {
    const result = transform("typeof undefined;", unaryExpressions);
    expect(result.code).toBe('"undefined";');
    expect(result.changes).toBe(1);
  });

  it("does not simplify single negation -x", () => {
    const result = transform("-x;", unaryExpressions);
    expect(result.code).toBe("-x;");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 18. invertBooleanLogic
// ============================================================
describe("invertBooleanLogic", () => {
  it("inverts !(a === b) to a !== b", () => {
    const result = transform("!(a === b);", invertBooleanLogic);
    expect(result.code).toBe("a !== b;");
    expect(result.changes).toBe(1);
  });

  it("inverts !(a < b) to a >= b", () => {
    const result = transform("!(a < b);", invertBooleanLogic);
    expect(result.code).toBe("a >= b;");
    expect(result.changes).toBe(1);
  });

  it("applies De Morgan: !(a && b) to !a || !b for simple operands", () => {
    const result = transform("!(a && b);", invertBooleanLogic);
    expect(result.code).toBe("!a || !b;");
    expect(result.changes).toBe(1);
  });

  it("does not apply De Morgan for complex operands", () => {
    const result = transform("!(f() && g());", invertBooleanLogic);
    expect(result.code).toBe("!(f() && g());");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 19. rawLiterals
// ============================================================
describe("rawLiterals", () => {
  it("cleans up hex escape sequences in string extras", () => {
    const ast = parser.parse('var x = "A";', { sourceType: "script" });
    // Simulate hex-escaped raw: '\x41'
    ast.program.body[0].declarations[0].init.extra = { rawValue: "A", raw: "'\\x41'" };
    const state = applyTransform(ast, rawLiterals);
    expect(state.changes).toBe(1);
    expect(ast.program.body[0].declarations[0].init.extra).toBeUndefined();
  });

  it("cleans up unicode escape sequences in string extras", () => {
    const ast = parser.parse('var x = "A";', { sourceType: "script" });
    ast.program.body[0].declarations[0].init.extra = { rawValue: "A", raw: "'\\u0041'" };
    const state = applyTransform(ast, rawLiterals);
    expect(state.changes).toBe(1);
    expect(ast.program.body[0].declarations[0].init.extra).toBeUndefined();
  });

  it("does not modify strings without escape sequences", () => {
    const result = transform('var x = "hello";', rawLiterals);
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 20. jsonParse
// ============================================================
describe("jsonParse", () => {
  it("converts JSON.parse('{\"a\":1}') to object literal", () => {
    const result = transform("JSON.parse('{\"a\":1}');", jsonParse);
    expect(result.code).toContain("a: 1");
    expect(result.changes).toBe(1);
  });

  it("converts JSON.parse with array to array literal", () => {
    const result = transform("JSON.parse('[1,2,3]');", jsonParse);
    expect(result.code).toBe("[1, 2, 3];");
    expect(result.changes).toBe(1);
  });

  it("skips invalid JSON", () => {
    const result = transform("JSON.parse('{invalid}');", jsonParse);
    expect(result.code).toBe("JSON.parse('{invalid}');");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 21. typeofUndefined
// ============================================================
describe("typeofUndefined", () => {
  it('converts typeof undefined === "undefined" to true', () => {
    const result = transform('typeof undefined === "undefined";', typeofUndefined);
    expect(result.code).toBe("true;");
    expect(result.changes).toBe(1);
  });

  it('converts typeof undefined !== "undefined" to false', () => {
    const result = transform('typeof undefined !== "undefined";', typeofUndefined);
    expect(result.code).toBe("false;");
    expect(result.changes).toBe(1);
  });

  it('converts typeof undefined === "object" to false', () => {
    const result = transform('typeof undefined === "object";', typeofUndefined);
    expect(result.code).toBe("false;");
    expect(result.changes).toBe(1);
  });

  it("does not change typeof x for non-undefined identifier", () => {
    const result = transform('typeof x === "undefined";', typeofUndefined);
    expect(result.code).toBe('typeof x === "undefined";');
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 22. truncateNumberLiteral
// ============================================================
describe("truncateNumberLiteral", () => {
  it("removes extra.raw containing .0 from integer literals", () => {
    const ast = parser.parse("5;", { sourceType: "script" });
    // Simulate a numeric literal that was written as 5.0
    ast.program.body[0].expression.extra = { rawValue: 5, raw: "5.0" };
    const state = applyTransform(ast, truncateNumberLiteral);
    expect(state.changes).toBe(1);
    expect(ast.program.body[0].expression.extra).toBeUndefined();
  });

  it("does not modify numeric literal without extra", () => {
    const result = transform("5;", truncateNumberLiteral);
    expect(result.changes).toBe(0);
  });

  it("does not modify non-integer numeric literals", () => {
    const ast = parser.parse("5.5;", { sourceType: "script" });
    // 5.5 is not integer, so even with extra.raw it should not be truncated
    ast.program.body[0].expression.extra = { rawValue: 5.5, raw: "5.5" };
    const state = applyTransform(ast, truncateNumberLiteral);
    expect(state.changes).toBe(0);
  });
});

// ============================================================
// 23. stringLiteralCleanup
// ============================================================
describe("stringLiteralCleanup", () => {
  it("removes extra.raw when it does not match the expected form", () => {
    const ast = parser.parse('var x = "hello";', { sourceType: "script" });
    // Simulate single-quoted raw that doesn't match expected double-quoted form
    ast.program.body[0].declarations[0].init.extra = { rawValue: "hello", raw: "'hello'" };
    const state = applyTransform(ast, stringLiteralCleanup);
    expect(state.changes).toBe(1);
    expect(ast.program.body[0].declarations[0].init.extra).toBeUndefined();
  });

  it("does not modify string literal with matching extra.raw", () => {
    const ast = parser.parse('var x = "hello";', { sourceType: "script" });
    // Set extra.raw to the expected double-quoted form
    ast.program.body[0].declarations[0].init.extra = { rawValue: "hello", raw: '"hello"' };
    const state = applyTransform(ast, stringLiteralCleanup);
    expect(state.changes).toBe(0);
  });

  it("does not modify string literal without extra", () => {
    const ast = parser.parse('var x = "hello";', { sourceType: "script" });
    delete ast.program.body[0].declarations[0].init.extra;
    const state = applyTransform(ast, stringLiteralCleanup);
    expect(state.changes).toBe(0);
  });
});

// ============================================================
// 24. deadCode
// ============================================================
describe("deadCode", () => {
  it('removes if ("a" === "b") { x(); } (always-false branch)', () => {
    const result = transform('if ("a" === "b") { x(); }', deadCode);
    expect(result.code).toBe("");
    expect(result.changes).toBe(1);
  });

  it("unwraps if (true) { x(); } else { y(); } to x()", () => {
    const result = transform("if (true) { x(); } else { y(); }", deadCode);
    expect(result.code).toBe("x();");
    expect(result.changes).toBe(1);
  });

  it("resolves conditional expression with known test", () => {
    const result = transform('var r = "a" === "a" ? 1 : 2;', deadCode);
    expect(result.code).toBe("var r = 1;");
    expect(result.changes).toBe(1);
  });

  it("does not remove if with dynamic condition", () => {
    const result = transform("if (x) { y(); }", deadCode);
    expect(result.code).toBe("if (x) {\n  y();\n}");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// Merged unminify (all transforms in one pass)
// ============================================================
describe("merged unminify", () => {
  it("applies multiple transforms in a single pass", () => {
    const result = transform('!0; void 0; obj["foo"];', unminify);
    expect(result.code).toContain("true;");
    expect(result.code).toContain("undefined;");
    expect(result.code).toContain("obj.foo;");
    expect(result.changes).toBeGreaterThanOrEqual(3);
  });

  it("chains literal normalization and dead code elimination", () => {
    const result = transform('if ("a" === "b") { x(); }', unminify);
    expect(result.code).toBe("");
    expect(result.changes).toBeGreaterThanOrEqual(1);
  });

  it("handles code that needs no unminification", () => {
    const result = transform("var x = 1;", unminify);
    expect(result.code).toBe("var x = 1;");
    expect(result.changes).toBe(0);
  });
});
