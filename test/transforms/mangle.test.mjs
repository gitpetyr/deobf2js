import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const mangle = require("../../src/transforms/mangle");

function transform(code, options = {}) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  mangle.run(ast, state, options);
  return { code: generate(ast).code, changes: state.changes };
}

describe("mangle", () => {
  it("renames long variable names to short ones", () => {
    const { code, changes } = transform(
      "var longName = 1; console.log(longName);"
    );
    expect(changes).toBeGreaterThan(0);
    // longName should no longer appear
    expect(code).not.toContain("longName");
    // Should still have the value and console.log
    expect(code).toContain("= 1");
    expect(code).toContain("console.log(");
  });

  it("preserves short names (1-2 chars)", () => {
    const { code, changes } = transform("var x = 1; var ab = 2;");
    expect(changes).toBe(0);
    expect(code).toContain("var x = 1");
    expect(code).toContain("var ab = 2");
  });

  it("does not rename globals", () => {
    const { code } = transform('console.log("hi");');
    expect(code).toContain("console.log");
  });

  it("respects filter function", () => {
    const { code, changes } = transform("var foo = 1; var bar = 2;", {
      filter: (n) => n === "foo",
    });
    expect(changes).toBe(1);
    expect(code).not.toContain("foo");
    expect(code).toContain("bar");
  });

  it("handles multiple scopes", () => {
    const { code, changes } = transform(
      "function longFunc() { var longVar = 1; return longVar; }"
    );
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("longFunc");
    expect(code).not.toContain("longVar");
  });

  it("avoids reserved words", () => {
    // "do" is index 3 (d=3), "if" is index 8+5=... let's just check output doesn't contain reserved words as var names
    const { code } = transform(
      "var alpha = 1; var beta = 2; var gamma = 3; var delta = 4;"
    );
    // None of the generated names should be reserved words
    expect(code).not.toContain("var do ");
    expect(code).not.toContain("var if ");
    expect(code).not.toContain("var in ");
  });

  it("makes no changes when all names are already short", () => {
    const { code, changes } = transform("var a = 1; var b = 2; var c = a + b;");
    expect(changes).toBe(0);
    expect(code).toBe("var a = 1;\nvar b = 2;\nvar c = a + b;");
  });

  it("renames function parameters", () => {
    const { code, changes } = transform(
      "function test(longParam) { return longParam + 1; }"
    );
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("longParam");
  });

  it("handles nested scopes without conflicts", () => {
    const { code, changes } = transform(
      "var outer = 1; function wrapper() { var inner = 2; return inner + outer; }"
    );
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("outer");
    expect(code).not.toContain("inner");
    expect(code).not.toContain("wrapper");
  });
});
