import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const objectProxyInlining = require("../../src/transforms/objectProxyInlining");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  objectProxyInlining.run(ast, state);
  return { code: generate(ast).code, changes: state.changes };
}

describe("objectProxyInlining", () => {
  it("inlines binary proxy function", () => {
    const input = `
      var obj = { ne: function(a, b) { return a !== b; } };
      var result = obj.ne(x, y);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("x !== y");
  });

  it("inlines call proxy function", () => {
    const input = `
      var obj = { call: function(fn, a) { return fn(a); } };
      obj.call(console.log, "hi");
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain('console.log("hi")');
  });

  it("inlines logical proxy function", () => {
    const input = `
      var obj = { and: function(a, b) { return a && b; } };
      var r = obj.and(x, y);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("x && y");
  });

  it("inlines unary proxy function", () => {
    const input = `
      var obj = { not: function(a) { return !a; } };
      var r = obj.not(x);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("!x");
  });

  it("does not inline non-proxy functions", () => {
    const input = `
      var obj = { complex: function(a) { var t = a + 1; return t * 2; } };
      obj.complex(5);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("handles computed property access", () => {
    const input = `
      var obj = { ne: function(a, b) { return a !== b; } };
      var result = obj["ne"](x, y);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("x !== y");
  });
});
