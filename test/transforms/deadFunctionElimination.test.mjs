import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const deadFunctionElimination = require("../../src/transforms/deadFunctionElimination");

function transform(code, options = {}) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  deadFunctionElimination.run(ast, state, options);
  return { code: generate(ast).code, changes: state.changes };
}

describe("deadFunctionElimination", () => {
  // === Conservative mode ===

  it("removes local zero-reference function declaration", () => {
    const input = `
      function outer() {
        function unused() { return 1; }
        return 2;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("function unused");
  });

  it("removes local zero-reference function expression", () => {
    const input = `
      function outer() {
        var unused = function() { return 1; };
        return 2;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("unused");
  });

  it("preserves top-level zero-reference function in conservative mode", () => {
    const input = `
      function unused() { return 1; }
      var x = 2;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
    expect(code).toContain("function unused");
  });

  it("preserves called function", () => {
    const input = `
      function outer() {
        function used() { return 1; }
        return used();
      }
    `;
    const { code, changes } = transform(input);
    expect(code).toContain("function used");
  });

  // === Aggressive mode ===

  it("removes top-level zero-reference function in aggressive mode", () => {
    const input = `
      function unused() { return 1; }
      var x = 2;
    `;
    const { code, changes } = transform(input, { aggressiveDce: true });
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("function unused");
  });

  it("removes top-level var f = function() in aggressive mode", () => {
    const input = `
      var unused = function() { return 1; };
      var x = 2;
    `;
    const { code, changes } = transform(input, { aggressiveDce: true });
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("unused");
  });

  // === Iterative removal ===

  it("iteratively removes functions (A calls B, A removed → B also removed)", () => {
    const input = `
      function outer() {
        function a() { return b(); }
        function b() { return 1; }
        return 2;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("function a");
    expect(code).not.toContain("function b");
  });

  // === Safety guards ===

  it("respects taintedNames", () => {
    const input = `
      function outer() {
        function preserved() { return 1; }
        return 2;
      }
    `;
    const taintedNames = new Set(["preserved"]);
    const { code, changes } = transform(input, { taintedNames });
    expect(code).toContain("function preserved");
  });

  it("skips function used as object property", () => {
    const input = `
      function outer() {
        var handler = function() { return 1; };
        var obj = { method: handler };
        return obj;
      }
    `;
    const { code, changes } = transform(input);
    expect(code).toContain("handler");
  });
});
