import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const antiDebugRemoval = require("../../src/transforms/antiDebugRemoval");
const { applyTransform } = require("../../src/transforms/framework");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  const { changes } = applyTransform(ast, antiDebugRemoval);
  return { code: generate(ast).code, changes };
}

describe("antiDebugRemoval", () => {
  it("removes standalone debugger statement", () => {
    const { code, changes } = transform("debugger;");
    expect(changes).toBe(1);
    expect(code).toBe("");
  });

  it("removes debugger inside function", () => {
    const { code, changes } = transform("function f() { debugger; return 1; }");
    expect(changes).toBe(1);
    expect(code).not.toContain("debugger");
    expect(code).toContain("return 1");
  });

  it("removes setInterval debugger trap", () => {
    const { code, changes } = transform("setInterval(function() { debugger; }, 1000);");
    expect(changes).toBe(2); // debugger + setInterval call
    expect(code).not.toContain("setInterval");
  });

  it("removes setTimeout debugger trap", () => {
    const { code, changes } = transform("setTimeout(() => { debugger; }, 500);");
    expect(changes).toBe(2); // debugger + setTimeout call
    expect(code).not.toContain("setTimeout");
  });

  it("does not remove setInterval with non-debugger callback", () => {
    const { code, changes } = transform("setInterval(function() { console.log(1); }, 1000);");
    expect(changes).toBe(0);
    expect(code).toContain("setInterval");
  });

  it("does not affect normal code", () => {
    const { code, changes } = transform("var x = 1; console.log(x);");
    expect(changes).toBe(0);
    expect(code).toContain("var x = 1");
  });
});
