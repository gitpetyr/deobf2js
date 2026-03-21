import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const constantObjectInlining = require("../../src/transforms/constantObjectInlining");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  constantObjectInlining.run(ast, state);
  return { code: generate(ast).code, changes: state.changes };
}

describe("constantObjectInlining", () => {
  it("inlines object property access", () => {
    const input = `
      var obj = { W: 1204, X: 99 };
      var a = obj.W;
      var b = obj.X;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("var a = 1204");
    expect(code).toContain("var b = 99");
  });

  it("inlines computed property access with string key", () => {
    const input = `
      var obj = { key: "value" };
      var a = obj["key"];
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain('var a = "value"');
  });

  it("does not inline assignment target", () => {
    const input = `
      var obj = { x: 1 };
      obj.x = 2;
    `;
    const { code } = transform(input);
    expect(code).toContain("obj.x = 2");
  });

  it("respects reassignment invalidation", () => {
    const input = `
      var obj = { x: 1 };
      var a = obj.x;
      obj = { x: 2 };
      var b = obj.x;
    `;
    const { code } = transform(input);
    expect(code).toContain("var a = 1");
    expect(code).toContain("var b = 2");
  });

  it("skips objects with non-literal values", () => {
    const input = `
      var obj = { fn: someFunc };
      var a = obj.fn;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("skips objects with spread", () => {
    const input = `
      var obj = { ...other, x: 1 };
      var a = obj.x;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });
});
