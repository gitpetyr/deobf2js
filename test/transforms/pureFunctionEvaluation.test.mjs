import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const pureFunctionEvaluation = require("../../src/transforms/pureFunctionEvaluation");

function transform(code, options = {}) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  return pureFunctionEvaluation.run(ast, state, options).then(() => ({
    code: generate(ast).code,
    changes: state.changes,
  }));
}

describe("pureFunctionEvaluation", () => {
  // === Layer 1: AST static evaluation ===

  it("evaluates single-return function with literal args (arithmetic)", async () => {
    const input = `
      function add(a, b) { return a + b; }
      var r = add(1, 2);
    `;
    const { code, changes } = await transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("r = 3");
  });

  it("evaluates string concatenation", async () => {
    const input = `
      function greet(a, b) { return a + b; }
      var r = greet("hello", " world");
    `;
    const { code, changes } = await transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain('"hello world"');
  });

  it("evaluates boolean logic", async () => {
    const input = `
      function negate(x) { return !x; }
      var r = negate(false);
    `;
    const { code, changes } = await transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("r = true");
  });

  it("evaluates nested binary expressions", async () => {
    const input = `
      function calc(a, b, c) { return (a + b) * c; }
      var r = calc(2, 3, 4);
    `;
    const { code, changes } = await transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("r = 20");
  });

  // === Layer 2: Sandbox execution ===

  it("evaluates complex pure function via sandbox", async () => {
    const input = `
      function decode(n) {
        var s = "";
        for (var i = 0; i < n; i++) s += String.fromCharCode(65 + i);
        return s;
      }
      var r = decode(3);
    `;
    const { code, changes } = await transform(input, { sandboxType: "jsdom" });
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain('"ABC"');
  });

  it("evaluates function returning array via sandbox", async () => {
    const input = `
      function makeArr(n) {
        var arr = [];
        for (var i = 0; i < n; i++) arr.push(i * 2);
        return arr;
      }
      var r = makeArr(3);
    `;
    const { code, changes } = await transform(input, { sandboxType: "jsdom" });
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("[0, 2, 4]");
  });

  // === Non-replaceable types ===

  it("does not replace NaN result", async () => {
    const input = `
      function bad(a) { return a / 0 * 0; }
      var r = bad(1);
    `;
    const { code, changes } = await transform(input, { sandboxType: "jsdom" });
    expect(code).toContain("bad(1)");
  });

  // === Skip rules ===

  it("skips function with side effects", async () => {
    const input = `
      function log(x) { console.log(x); return x; }
      var r = log(1);
    `;
    const { code, changes } = await transform(input, { sandboxType: "jsdom" });
    expect(changes).toBe(0);
    expect(code).toContain("log(1)");
  });

  it("skips function referencing external mutable variable", async () => {
    const input = `
      var base = 10;
      function addBase(x) { return x + base; }
      var r = addBase(5);
    `;
    const { code, changes } = await transform(input);
    expect(changes).toBe(0);
  });

  it("skips calls with non-literal arguments", async () => {
    const input = `
      function add(a, b) { return a + b; }
      var x = 1;
      var r = add(x, 2);
    `;
    const { code, changes } = await transform(input);
    expect(changes).toBe(0);
  });

  it("respects taintedNames", async () => {
    const input = `
      function decode(x) { return x + 1; }
      var r = decode(5);
    `;
    const taintedNames = new Set(["decode"]);
    const { code, changes } = await transform(input, { taintedNames });
    expect(changes).toBe(0);
    expect(code).toContain("decode(5)");
  });

  it("skips calls with tainted arguments", async () => {
    const input = `
      function add(a, b) { return a + b; }
      var r = add(seed, 2);
    `;
    const taintedNames = new Set(["seed"]);
    const { code, changes } = await transform(input, { taintedNames });
    expect(changes).toBe(0);
  });
});
