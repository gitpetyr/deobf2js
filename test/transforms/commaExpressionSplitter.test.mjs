import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const commaExpressionSplitter = require("../../src/transforms/commaExpressionSplitter");
const { applyTransform } = require("../../src/transforms/framework");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  const { changes } = applyTransform(ast, commaExpressionSplitter);
  return { code: generate(ast).code, changes };
}

describe("commaExpressionSplitter", () => {
  it("splits sequence expression in expression statement", () => {
    const { code, changes } = transform("a(), b(), c();");
    expect(changes).toBe(1);
    expect(code).toContain("a();");
    expect(code).toContain("b();");
    expect(code).toContain("c();");
  });

  it("splits two-element sequence", () => {
    const { code, changes } = transform("x = 1, y = 2;");
    expect(changes).toBe(1);
    expect(code).toContain("x = 1;");
    expect(code).toContain("y = 2;");
  });

  it("does not split non-sequence expressions", () => {
    const { code, changes } = transform("foo();");
    expect(changes).toBe(0);
    expect(code).toBe("foo();");
  });

  it("does not touch sequence inside for loop", () => {
    const { code, changes } = transform("for (a(), b();;) {}");
    expect(changes).toBe(0);
  });

  it("handles multiple sequence statements", () => {
    const { changes } = transform("a(), b(); c(), d();");
    expect(changes).toBe(2);
  });
});
