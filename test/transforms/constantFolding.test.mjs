import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const constantFolding = require("../../src/transforms/constantFolding");
const { applyTransform } = require("../../src/transforms/framework");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  applyTransform(ast, constantFolding);
  return generate(ast).code;
}

describe("constantFolding", () => {
  it("folds !![] to true", () => {
    expect(transform("var x = !![];")).toBe("var x = true;");
  });

  it("folds ![] to false", () => {
    expect(transform("var x = ![];")).toBe("var x = false;");
  });

  it("folds +[] to 0", () => {
    expect(transform("var x = +[];")).toBe("var x = 0;");
  });

  it("folds +!![] to 1", () => {
    expect(transform("var x = +!![];")).toBe("var x = 1;");
  });

  it("folds binary arithmetic", () => {
    expect(transform("var x = 2 + 3;")).toBe("var x = 5;");
    expect(transform("var x = 10 - 4;")).toBe("var x = 6;");
    expect(transform("var x = 3 * 4;")).toBe("var x = 12;");
  });

  it("folds binary comparison", () => {
    expect(transform("var x = 1 === 1;")).toBe("var x = true;");
    expect(transform("var x = 1 !== 2;")).toBe("var x = true;");
    expect(transform("var x = 1 === 2;")).toBe("var x = false;");
  });

  it("folds bitwise operations", () => {
    expect(transform("var x = 5 | 3;")).toBe("var x = 7;");
    expect(transform("var x = 5 & 3;")).toBe("var x = 1;");
    expect(transform("var x = 5 ^ 3;")).toBe("var x = 6;");
  });

  it("eliminates dead branch if(true)", () => {
    const result = transform("if (true) { x(); } else { y(); }");
    expect(result).toContain("x()");
    expect(result).not.toContain("y()");
  });

  it("eliminates dead branch if(false)", () => {
    const result = transform("if (false) { x(); } else { y(); }");
    expect(result).not.toContain("x()");
    expect(result).toContain("y()");
  });

  it("eliminates dead branch if(false) without else", () => {
    const result = transform("if (false) { x(); }");
    expect(result).toBe("");
  });

  it("folds ternary with boolean test", () => {
    expect(transform("var x = true ? 1 : 2;")).toBe("var x = 1;");
    expect(transform("var x = false ? 1 : 2;")).toBe("var x = 2;");
  });

  it("simplifies logical expressions", () => {
    expect(transform("var x = true && y;")).toBe("var x = y;");
    expect(transform("var x = false || y;")).toBe("var x = y;");
  });

  it("does not fold NaN or Infinity", () => {
    expect(transform("var x = 0 / 0;")).toBe("var x = 0 / 0;");
    expect(transform("var x = 1 / 0;")).toBe("var x = 1 / 0;");
  });

  it("folds chained expressions across multiple passes", () => {
    // !![] -> true, then true ? 1 : 2 -> 1
    expect(transform("var x = !![] ? 1 : 2;")).toBe("var x = 1;");
  });

  it("folds typeof", () => {
    expect(transform('var x = typeof "hello";')).toBe('var x = "string";');
  });

  it("folds void 0", () => {
    expect(transform("var x = void 0;")).toBe("var x = undefined;");
  });

  it("folds unary negation", () => {
    expect(transform("var x = -5;")).toBe("var x = -5;");
    expect(transform("var x = ~0;")).toBe("var x = -1;");
  });
});
