import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const { applyTransform } = require("../../src/transforms/framework");

function transform(code, mod) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = applyTransform(ast, mod);
  return { code: generate(ast).code, changes: state.changes };
}

// --- Individual transform imports ---
const optionalChaining = require("../../src/transpile/optionalChaining");
const nullishCoalescing = require("../../src/transpile/nullishCoalescing");
const nullishCoalescingAssignment = require("../../src/transpile/nullishCoalescingAssignment");
const logicalAssignments = require("../../src/transpile/logicalAssignments");
const templateLiterals = require("../../src/transpile/templateLiterals");
const defaultParameters = require("../../src/transpile/defaultParameters");
const transpile = require("../../src/transpile/index");

// ============================================================
// 1. optionalChaining
// ============================================================
describe("optionalChaining", () => {
  it("converts a && a.b to a?.b in expression context", () => {
    const result = transform("var x = a && a.b;", optionalChaining);
    expect(result.code).toContain("a?.b");
    expect(result.changes).toBe(1);
  });

  it("converts a != null && a.b to a?.b", () => {
    const result = transform("var x = a != null && a.b;", optionalChaining);
    expect(result.code).toContain("a?.b");
    expect(result.changes).toBe(1);
  });

  it("does not convert standalone a && a.b (ExpressionStatement)", () => {
    const result = transform("a && a.b;", optionalChaining);
    expect(result.code).toContain("&&");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 2. nullishCoalescing
// ============================================================
describe("nullishCoalescing", () => {
  it("converts a != null ? a : b to a ?? b", () => {
    const result = transform("var x = a != null ? a : b;", nullishCoalescing);
    expect(result.code).toContain("a ?? b");
    expect(result.changes).toBe(1);
  });

  it("converts a !== null && a !== void 0 ? a : b to a ?? b", () => {
    const result = transform("var x = a !== null && a !== void 0 ? a : b;", nullishCoalescing);
    expect(result.code).toContain("a ?? b");
    expect(result.changes).toBe(1);
  });

  it("does not convert unrelated ternary", () => {
    const result = transform("var x = a > 0 ? a : b;", nullishCoalescing);
    expect(result.code).toContain("?");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 3. nullishCoalescingAssignment
// ============================================================
describe("nullishCoalescingAssignment", () => {
  it("converts x = x ?? y to x ??= y", () => {
    const result = transform("x = x ?? y;", nullishCoalescingAssignment);
    expect(result.code).toContain("??=");
    expect(result.changes).toBe(1);
  });

  it("converts if (x == null) x = y to x ??= y", () => {
    const result = transform("if (x == null) x = y;", nullishCoalescingAssignment);
    expect(result.code).toContain("??=");
    expect(result.changes).toBe(1);
  });

  it("does not convert if with else branch", () => {
    const result = transform("if (x == null) x = y; else x = z;", nullishCoalescingAssignment);
    expect(result.code).toContain("if");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 4. logicalAssignments
// ============================================================
describe("logicalAssignments", () => {
  it("converts x && (x = y); to x &&= y;", () => {
    const result = transform("x && (x = y);", logicalAssignments);
    expect(result.code).toContain("&&=");
    expect(result.changes).toBe(1);
  });

  it("converts x || (x = y); to x ||= y;", () => {
    const result = transform("x || (x = y);", logicalAssignments);
    expect(result.code).toContain("||=");
    expect(result.changes).toBe(1);
  });

  it("does not convert when left and right identifiers differ", () => {
    const result = transform("x && (z = y);", logicalAssignments);
    expect(result.code).toContain("&&");
    expect(result.code).not.toContain("&&=");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 5. templateLiterals
// ============================================================
describe("templateLiterals", () => {
  it('converts a + " world" to template literal', () => {
    const result = transform('var x = a + " world";', templateLiterals);
    expect(result.code).toContain("`");
    expect(result.code).toContain("${a}");
    expect(result.changes).toBe(1);
  });

  it('converts "hello " + a + " world" to template literal', () => {
    const result = transform('var x = "hello " + a + " world";', templateLiterals);
    expect(result.code).toContain("`");
    expect(result.code).toContain("${a}");
    expect(result.changes).toBe(1);
  });

  it("does not convert all-string concatenation", () => {
    const result = transform('var x = "hello" + " world";', templateLiterals);
    expect(result.code).not.toContain("`");
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// 6. defaultParameters
// ============================================================
describe("defaultParameters", () => {
  it("converts if (a === void 0) a = 1 to default param", () => {
    const result = transform("function f(a) { if (a === void 0) a = 1; return a; }", defaultParameters);
    expect(result.code).toContain("function f(a = 1)");
    expect(result.changes).toBe(1);
  });

  it("converts ternary default pattern to default param", () => {
    const result = transform("function f(a) { a = a === void 0 ? 1 : a; return a; }", defaultParameters);
    expect(result.code).toContain("a = 1");
    expect(result.changes).toBe(1);
  });

  it("does not convert non-parameter default patterns", () => {
    const result = transform("function f() { var a; if (a === void 0) a = 1; }", defaultParameters);
    expect(result.changes).toBe(0);
  });
});

// ============================================================
// Merged transpile (all transforms in one pass)
// ============================================================
describe("merged transpile", () => {
  it("applies multiple transpile transforms in a single pass", () => {
    const result = transform('x && (x = y); var z = a + " world";', transpile);
    expect(result.code).toContain("&&=");
    expect(result.code).toContain("`");
    expect(result.changes).toBeGreaterThanOrEqual(2);
  });
});
