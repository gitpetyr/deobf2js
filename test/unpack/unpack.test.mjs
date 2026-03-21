import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");

const { detectWebpack } = require("../../src/unpack/webpack/detect");
const { extractModules } = require("../../src/unpack/webpack/extractModules");
const { rewriteRequire } = require("../../src/unpack/webpack/rewriteRequire");
const { detectBrowserify } = require("../../src/unpack/browserify/detect");
const { unpack } = require("../../src/unpack/index");
const generate = require("@babel/generator").default;

const WEBPACK4_BUNDLE = `
(function(modules) {
  function __webpack_require__(moduleId) {
    var module = { exports: {} };
    modules[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
  }
  return __webpack_require__(0);
})([
  function(module, exports, __webpack_require__) {
    var dep = __webpack_require__(1);
    console.log(dep);
  },
  function(module, exports) {
    module.exports = "hello";
  }
]);
`;

const WEBPACK5_BUNDLE = `
(() => {
  var __webpack_modules__ = {
    123: (module, exports) => {
      module.exports = "hello";
    },
    456: (module, exports, __webpack_require__) => {
      var dep = __webpack_require__(123);
      console.log(dep);
    }
  };
  function __webpack_require__(moduleId) {
    var module = { exports: {} };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
  }
  __webpack_require__(456);
})();
`;

const BROWSERIFY_BUNDLE = `
(function(){function r(e,n,t){function s(o,u){if(!n[o]){if(!e[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};e[o][0].call(f.exports,function(e){return s(e)},f,f.exports,r,e,n,t)}return n[o].exports}return s}return r})()({
  1: [function(require, module, exports) {
    var dep = require("./dep");
    console.log(dep);
  }, {"./dep": 2}],
  2: [function(require, module, exports) {
    module.exports = "hello";
  }, {}]
}, {}, [1]);
`;

function parse(code) {
  return parser.parse(code, { sourceType: "script", plugins: [] });
}

describe("Bundle Unpacking", () => {
  describe("Webpack 4", () => {
    it("should detect webpack 4 bundle", () => {
      const ast = parse(WEBPACK4_BUNDLE);
      const result = detectWebpack(ast);
      expect(result).not.toBeNull();
      expect(result.type).toBe("webpack4");
      expect(result.entryId).toBe(0);
      expect(result.modulesNode).toBeDefined();
    });

    it("should extract modules from webpack 4 bundle", () => {
      const ast = parse(WEBPACK4_BUNDLE);
      const result = detectWebpack(ast);
      const modules = extractModules(result.modulesNode, result.type);
      expect(modules.size).toBe(2);
      expect(modules.has(0)).toBe(true);
      expect(modules.has(1)).toBe(true);
    });

    it("should rewrite __webpack_require__ calls", () => {
      const ast = parse(WEBPACK4_BUNDLE);
      const result = detectWebpack(ast);
      const modules = extractModules(result.modulesNode, result.type);
      for (const [id, mod] of modules) {
        rewriteRequire(mod.ast, modules);
      }
      const code0 = generate(modules.get(0).ast, { comments: true }).code;
      expect(code0).toContain('require("./module_1")');
      expect(code0).not.toContain("__webpack_require__");
    });
  });

  describe("Webpack 5", () => {
    it("should detect webpack 5 bundle", () => {
      const ast = parse(WEBPACK5_BUNDLE);
      const result = detectWebpack(ast);
      expect(result).not.toBeNull();
      expect(result.type).toBe("webpack5");
      expect(result.entryId).toBe(456);
      expect(result.modulesNode).toBeDefined();
    });

    it("should extract modules from webpack 5 bundle", () => {
      const ast = parse(WEBPACK5_BUNDLE);
      const result = detectWebpack(ast);
      const modules = extractModules(result.modulesNode, result.type);
      expect(modules.size).toBe(2);
      expect(modules.has(123)).toBe(true);
      expect(modules.has(456)).toBe(true);
    });
  });

  describe("Browserify", () => {
    it("should detect browserify bundle", () => {
      const ast = parse(BROWSERIFY_BUNDLE);
      const result = detectBrowserify(ast);
      expect(result).not.toBeNull();
      expect(result.modulesNode).toBeDefined();
      expect(result.entryIds).toContain(1);
    });

    it("should unpack browserify bundle with dependency rewriting", () => {
      const ast = parse(BROWSERIFY_BUNDLE);
      const bundle = unpack(ast);
      expect(bundle).not.toBeNull();
      expect(bundle.type).toBe("browserify");
      expect(bundle.modules.size).toBe(2);

      const code1 = bundle.generateCode(1);
      expect(code1).toContain("require(");
      expect(code1).toContain("module_2");
    });
  });

  describe("Full unpack", () => {
    it("should unpack webpack 4 bundle via main unpack()", () => {
      const ast = parse(WEBPACK4_BUNDLE);
      const bundle = unpack(ast);
      expect(bundle).not.toBeNull();
      expect(bundle.type).toBe("webpack4");
      expect(bundle.entryId).toBe(0);
      expect(bundle.modules.size).toBe(2);
      expect(bundle.modules.get(0).path).toBe("module_0.js");
      expect(bundle.modules.get(1).path).toBe("module_1.js");
    });

    it("should return null for non-bundled code", () => {
      const ast = parse("var x = 1; console.log(x);");
      const bundle = unpack(ast);
      expect(bundle).toBeNull();
    });

    it("should produce valid toJSON output", () => {
      const ast = parse(WEBPACK4_BUNDLE);
      const bundle = unpack(ast);
      const json = bundle.toJSON();
      expect(json.type).toBe("webpack4");
      expect(json.entryId).toBe(0);
      expect(json.modules).toBeDefined();
      expect(json.modules[0].path).toBe("module_0.js");
    });
  });
});
