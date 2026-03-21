import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const copyPropagation = require("../../src/transforms/copyPropagation");

function transform(code, taintedNames) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  copyPropagation.run(ast, state, { taintedNames });
  return { code: generate(ast).code, changes: state.changes };
}

describe("copyPropagation", () => {
  it("propagates var x = y", () => {
    const { code, changes } = transform("var y = 1; var x = y; console.log(x);");
    expect(changes).toBeGreaterThan(0);
    expect(code).toContain("console.log(1)");
  });

  it("propagates var x = literal", () => {
    const { code } = transform('var x = "hello"; console.log(x);');
    expect(code).toContain('console.log("hello")');
  });

  it("removes propagated declaration", () => {
    const { code } = transform("var x = 42; foo(x);");
    expect(code).not.toContain("var x");
    expect(code).toContain("foo(42)");
  });

  it("does not propagate non-constant variables", () => {
    const { code } = transform("var x = 1; x = 2; foo(x);");
    expect(code).toContain("var x");
  });

  it("respects tainted variables", () => {
    const tainted = new Set(["seed"]);
    const { code } = transform("var seed = 42; foo(seed);", tainted);
    expect(code).toContain("var seed = 42");
    expect(code).toContain("foo(seed)");
  });

  it("propagates through multiple passes", () => {
    const { code } = transform("var a = 1; var b = a; var c = b; foo(c);");
    expect(code).toContain("foo(1)");
  });

  it("does not propagate non-literal non-identifier init", () => {
    const { code } = transform("var x = foo(); bar(x);");
    expect(code).toContain("var x = foo()");
  });
});
