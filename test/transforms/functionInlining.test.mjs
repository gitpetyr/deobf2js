import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const functionInlining = require("../../src/transforms/functionInlining");

function transform(code, options = {}) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  functionInlining.run(ast, state, options);
  return { code: generate(ast).code, changes: state.changes };
}

describe("functionInlining", () => {
  it("inlines single-return function with one call site", () => {
    const input = `
      function add(a, b) { return a + b; }
      var r = add(1, 2);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("1 + 2");
    // function declaration left for deadFunctionElimination to remove
  });

  it("inlines function expression assignment", () => {
    const input = `
      var mul = function(a, b) { return a * b; };
      var r = mul(3, 4);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("3 * 4");
  });

  it("inlines multi-statement function at ExpressionStatement call site", () => {
    const input = `
      function doStuff(x) {
        var y = x + 1;
        console.log(y);
      }
      doStuff(5);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("var y = 5 + 1");
    expect(code).toContain("console.log(y)");
  });

  it("inlines multi-statement function at VariableDeclarator call site", () => {
    const input = `
      function compute(x) {
        var t = x * 2;
        return t + 1;
      }
      var result = compute(10);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("var t = 10 * 2");
    expect(code).toContain("result = t + 1");
  });

  it("inlines function with <= 5 call sites unconditionally", () => {
    const input = `
      function wrap(x) {
        var a = x + 1;
        var b = a * 2;
        var c = b - 3;
        var d = c / 4;
        return d;
      }
      var r1 = wrap(1);
      var r2 = wrap(2);
      var r3 = wrap(3);
      var r4 = wrap(4);
      var r5 = wrap(5);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    // function declaration left for deadFunctionElimination
    // verify call sites were inlined
    expect(code).toContain("1 + 1");
  });

  it("does not inline large function with > 5 call sites", () => {
    const input = `
      function big(x) {
        var a = x + 1;
        var b = a * 2;
        var c = b - 3;
        var d = c / 4;
        return d;
      }
      var r1 = big(1);
      var r2 = big(2);
      var r3 = big(3);
      var r4 = big(4);
      var r5 = big(5);
      var r6 = big(6);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
    expect(code).toContain("function big");
  });

  it("inlines small function with > 5 call sites", () => {
    const input = `
      function inc(x) { return x + 1; }
      var a = inc(1);
      var b = inc(2);
      var c = inc(3);
      var d = inc(4);
      var e = inc(5);
      var f = inc(6);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("1 + 1");
  });

  it("skips recursive functions", () => {
    const input = `
      function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
      var r = fact(5);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
    expect(code).toContain("function fact");
  });

  it("skips functions containing this", () => {
    const input = `
      function getVal() { return this.value; }
      var r = getVal();
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("skips functions containing arguments", () => {
    const input = `
      function first() { return arguments[0]; }
      var r = first(1);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("skips functions with default parameters", () => {
    const input = `
      function add(a, b = 10) { return a + b; }
      var r = add(1);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("skips functions with rest parameters", () => {
    const input = `
      function sum(...args) { return args.reduce((a, b) => a + b, 0); }
      var r = sum(1, 2, 3);
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("skips functions with destructured parameters", () => {
    const input = `
      function get({a, b}) { return a + b; }
      var r = get({a: 1, b: 2});
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });

  it("respects taintedNames", () => {
    const input = `
      function decode(x) { return x + 1; }
      var r = decode(seed);
    `;
    const taintedNames = new Set(["decode"]);
    const { code, changes } = transform(input, { taintedNames });
    expect(changes).toBe(0);
    expect(code).toContain("function decode");
  });

  it("skips functions referencing external mutable variables", () => {
    const input = `
      var counter = 0;
      function inc() { counter++; return counter; }
      var r = inc();
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
  });
});
