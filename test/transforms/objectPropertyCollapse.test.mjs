import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const objectPropertyCollapse = require("../../src/transforms/objectPropertyCollapse");
const { applyTransform } = require("../../src/transforms/framework");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  const { changes } = applyTransform(ast, objectPropertyCollapse);
  return { code: generate(ast).code, changes };
}

describe("objectPropertyCollapse", () => {
  it("collapses computed property assignments into object literal", () => {
    const input = `
      var M = {};
      M["key1"] = 1;
      M["key2"] = 2;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(2);
    expect(code).toContain("key1: 1");
    expect(code).toContain("key2: 2");
    expect(code).not.toContain('M["key1"]');
  });

  it("collapses dot-notation assignments", () => {
    const input = `
      var M = {};
      M.a = 1;
      M.b = 2;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(2);
    expect(code).toContain("a: 1");
    expect(code).toContain("b: 2");
  });

  it("stops at non-matching statement", () => {
    const input = `
      var M = {};
      M.a = 1;
      console.log("break");
      M.b = 2;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(1); // only M.a
    expect(code).toContain("a: 1");
    expect(code).toContain("M.b = 2"); // not collapsed
  });

  it("skips non-empty objects", () => {
    const input = `
      var M = { existing: 1 };
      M.a = 2;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("handles assignment-style init (not var)", () => {
    const input = `
      M = {};
      M.x = 10;
      M.y = 20;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(2);
    expect(code).toContain("x: 10");
    expect(code).toContain("y: 20");
  });

  it("normalizes valid identifier keys", () => {
    const input = `
      var M = {};
      M["validName"] = 1;
    `;
    const { code } = transform(input);
    expect(code).toContain("validName: 1");
  });

  it("preserves string keys for non-identifier names", () => {
    const input = `
      var M = {};
      M["123invalid"] = 1;
    `;
    const { code } = transform(input);
    expect(code).toContain('"123invalid": 1');
  });
});
