import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { deobfuscate } = require("../../src/index");

describe("function optimization integration", () => {
  it("inlines wrapper, evaluates pure call, removes dead function", async () => {
    const input = `
      function wrapper(a, b) { return helper(a, b); }
      function helper(x, y) { return x + y; }
      var result = wrapper(10, 20);
      console.log(result);
    `;
    const { code } = await deobfuscate(input, {
      sandboxType: "jsdom",
      maxIterations: 5,
      aggressiveDce: true,
    });
    // wrapper should be inlined, helper(10, 20) should evaluate to 30
    expect(code).toContain("30");
    // dead functions should be cleaned up in aggressive mode
    expect(code).not.toContain("function wrapper");
    expect(code).not.toContain("function helper");
  });

  it("respects --preserve through the full pipeline", async () => {
    const input = `
      var seed = 42;
      function compute(x) { return x + seed; }
      var result = compute(10);
      console.log(result);
    `;
    const { code } = await deobfuscate(input, {
      sandboxType: "jsdom",
      maxIterations: 5,
      preserveNames: new Set(["seed"]),
    });
    // seed is protected, compute references tainted seed, should not be evaluated
    expect(code).toContain("seed");
  });

  it("convergence: loop terminates with all transforms active", async () => {
    const input = `
      function a(x) { return x * 2; }
      function b(x) { return a(x) + 1; }
      var r = b(5);
    `;
    const { code, stats } = await deobfuscate(input, {
      sandboxType: "jsdom",
      maxIterations: 20,
    });
    expect(stats.iterations).toBeLessThan(20);
    expect(code).toContain("11");
  });
});
