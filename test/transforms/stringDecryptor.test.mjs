import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const stringDecryptor = require("../../src/transforms/stringDecryptor");

function parse(code) {
  return parser.parse(code, { sourceType: "script" });
}

describe("stringDecryptor", () => {
  it("returns empty consumedPaths when no string arrays found", async () => {
    const ast = parse("var x = 1; console.log(x);");
    const state = { changes: 0 };
    await stringDecryptor.run(ast, state, { sandboxType: "jsdom" });
    expect(state.consumedPaths).toEqual([]);
  });

  it("detects and decrypts simple string array with decoder", async () => {
    const input = `
      var _arr = ["hello", "world", "foo"];
      function _decode(index) {
        return _arr[index];
      }
      var a = _decode(0);
      var b = _decode(1);
      var c = _decode(2);
    `;
    const ast = parse(input);
    const state = { changes: 0 };
    await stringDecryptor.run(ast, state, { sandboxType: "jsdom" });

    // Should have consumed the array and decoder
    expect(state.consumedPaths.length).toBeGreaterThan(0);

    const code = generate(ast).code;
    expect(code).toContain('"hello"');
    expect(code).toContain('"world"');
    expect(code).toContain('"foo"');
  });

  it("respects tainted names", async () => {
    const input = `
      var _arr = ["hello", "world", "foo"];
      function _decode(index) {
        return _arr[index];
      }
      var a = _decode(seed);
    `;
    const ast = parse(input);
    const taintedNames = new Set(["seed"]);
    const state = { changes: 0 };
    await stringDecryptor.run(ast, state, { sandboxType: "jsdom", taintedNames });

    const code = generate(ast).code;
    // The call with tainted arg should be preserved
    expect(code).toContain("_decode(seed)");
  });
});
