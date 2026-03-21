import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const deadCodeElimination = require("../../src/transforms/deadCodeElimination");

function transform(code, consumedNodeNames = []) {
  const ast = parser.parse(code, { sourceType: "script" });

  // Collect paths for nodes matching consumed names
  const traverse = require("@babel/traverse").default;
  const consumedPaths = [];
  if (consumedNodeNames.length > 0) {
    traverse(ast, {
      FunctionDeclaration(path) {
        if (consumedNodeNames.includes(path.node.id.name)) {
          consumedPaths.push(path);
        }
      },
      VariableDeclaration(path) {
        for (const d of path.node.declarations) {
          if (d.id && consumedNodeNames.includes(d.id.name)) {
            consumedPaths.push(path);
            break;
          }
        }
      },
    });
  }

  const state = { changes: 0 };
  deadCodeElimination.run(ast, state, { consumedPaths });
  return { code: generate(ast).code, removed: state.changes };
}

describe("deadCodeElimination", () => {
  it("removes consumed nodes", () => {
    const input = `
      var arr = [1, 2, 3];
      function decoder(x) { return arr[x]; }
      console.log("keep");
    `;
    const { code, removed } = transform(input, ["arr", "decoder"]);
    expect(removed).toBeGreaterThan(0);
    expect(code).not.toContain("arr");
    expect(code).not.toContain("decoder");
    expect(code).toContain("console.log");
  });

  it("removes unreferenced declarations that reference consumed infrastructure", () => {
    const input = `
      var arr = [1, 2, 3];
      function helper() { return arr[0]; }
      console.log("keep");
    `;
    const { code, removed } = transform(input, ["arr"]);
    expect(removed).toBeGreaterThan(0);
    expect(code).not.toContain("helper");
    expect(code).toContain("console.log");
  });

  it("does not remove unreferenced code unrelated to consumed", () => {
    const input = `
      function unused() { return 42; }
      console.log("keep");
    `;
    const { code, removed } = transform(input, []);
    expect(code).toContain("unused");
  });

  it("eliminates dead stores in functions", () => {
    const input = `
      function f() {
        var x = 1;
        var y = 2;
        return y;
      }
    `;
    const { code, removed } = transform(input, []);
    expect(removed).toBeGreaterThan(0);
    expect(code).not.toContain("var x");
    expect(code).toContain("var y = 2");
  });

  it("respects tainted names", () => {
    const input = `
      var arr = [1, 2, 3];
      var seed = arr;
      console.log("keep");
    `;
    const tainted = new Set(["seed"]);
    const ast = parser.parse(input, { sourceType: "script" });
    const traverse = require("@babel/traverse").default;
    const consumedPaths = [];
    traverse(ast, {
      VariableDeclaration(path) {
        for (const d of path.node.declarations) {
          if (d.id && d.id.name === "arr") {
            consumedPaths.push(path);
          }
        }
      },
    });
    const state = { changes: 0 };
    deadCodeElimination.run(ast, state, { consumedPaths, taintedNames: tainted });
    const code = generate(ast).code;
    expect(code).toContain("seed");
  });
});
