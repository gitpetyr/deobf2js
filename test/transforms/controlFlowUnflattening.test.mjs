import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const controlFlowUnflattening = require("../../src/transforms/controlFlowUnflattening");

function transform(code) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  controlFlowUnflattening.run(ast, state);
  return { code: generate(ast).code, changes: state.changes };
}

describe("controlFlowUnflattening", () => {
  it("unflattens while-switch with string split order", () => {
    const input = `
      var order = "2|0|1"["split"]("|");
      var idx = 0;
      while (true) {
        switch (order[idx++]) {
          case "0": a(); continue;
          case "1": b(); continue;
          case "2": c(); continue;
        }
        break;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(1);
    // Order is "2|0|1" so: c(), a(), b()
    const lines = code.split("\n").map(l => l.trim()).filter(Boolean);
    const callOrder = lines.filter(l => /^[abc]\(\);$/.test(l));
    expect(callOrder).toEqual(["c();", "a();", "b();"]);
  });

  it("removes infrastructure (order array and index variable)", () => {
    const input = `
      var order = "1|0"["split"]("|");
      var idx = 0;
      while (true) {
        switch (order[idx++]) {
          case "0": foo(); continue;
          case "1": bar(); continue;
        }
        break;
      }
    `;
    const { code } = transform(input);
    expect(code).not.toContain("order");
    expect(code).not.toContain("idx");
    expect(code).not.toContain("while");
    expect(code).not.toContain("switch");
  });

  it("does not transform non-matching while loops", () => {
    const input = "while (x > 0) { x--; }";
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
    expect(code).toContain("while");
  });

  it("handles single case", () => {
    const input = `
      var order = "0"["split"]("|");
      var idx = 0;
      while (true) {
        switch (order[idx++]) {
          case "0": only(); continue;
        }
        break;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(1);
    expect(code).toContain("only()");
  });
});
