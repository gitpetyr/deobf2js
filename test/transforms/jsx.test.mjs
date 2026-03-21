import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const { applyTransform } = require("../../src/transforms/framework");
const jsx = require("../../src/transforms/jsx");
const jsxNew = require("../../src/transforms/jsxNew");

function transformJsx(code) {
  const ast = parser.parse(code, { sourceType: "module" });
  applyTransform(ast, jsx);
  return generate(ast, {}).code;
}

function transformJsxNew(code) {
  const ast = parser.parse(code, { sourceType: "module" });
  applyTransform(ast, jsxNew);
  return generate(ast, {}).code;
}

describe("jsx (React.createElement)", () => {
  it("converts React.createElement with no children to self-closing tag", () => {
    const result = transformJsx('React.createElement("div", null)');
    expect(result).toBe("<div />;");
  });

  it("converts React.createElement with props and string child", () => {
    const result = transformJsx(
      'React.createElement("div", {className: "foo"}, "hello")'
    );
    expect(result).toBe('<div className="foo">hello</div>;');
  });

  it("converts React.createElement with component identifier", () => {
    const result = transformJsx("React.createElement(Component, {x: 1})");
    expect(result).toBe("<Component x={1} />;");
  });

  it("converts React.Fragment to JSX fragment", () => {
    const result = transformJsx(
      "React.createElement(React.Fragment, null, a, b)"
    );
    expect(result).toBe("<>{a}{b}</>;");
  });

  it("does not transform non-React.createElement calls", () => {
    const result = transformJsx('foo("div", null)');
    expect(result).toBe('foo("div", null);');
  });

  it("converts MemberExpression tag to JSXMemberExpression", () => {
    const result = transformJsx("React.createElement(Foo.Bar, null)");
    expect(result).toBe("<Foo.Bar />;");
  });

  it("converts spread props", () => {
    const result = transformJsx("React.createElement(\"div\", {...props})");
    expect(result).toBe("<div {...props} />;");
  });
});

describe("jsxNew (_jsx / _jsxs)", () => {
  it("converts _jsx with empty props to self-closing tag", () => {
    const result = transformJsxNew('_jsx("div", {})');
    expect(result).toBe("<div />;");
  });

  it("converts _jsx with children string", () => {
    const result = transformJsxNew('_jsx("div", {children: "hello"})');
    expect(result).toBe("<div>hello</div>;");
  });

  it("converts _jsxs with array children", () => {
    const result = transformJsxNew('_jsxs("div", {children: [a, b]})');
    expect(result).toBe("<div>{a}{b}</div>;");
  });

  it("converts _jsx with component identifier", () => {
    const result = transformJsxNew("_jsx(Component, {x: 1})");
    expect(result).toBe("<Component x={1} />;");
  });

  it("converts _Fragment to JSX fragment", () => {
    const result = transformJsxNew('_jsx(_Fragment, {children: "hi"})');
    expect(result).toBe("<>hi</>;");
  });

  it("handles numbered variants like _jsx$1", () => {
    const result = transformJsxNew('_jsx1("div", {})');
    expect(result).toBe("<div />;");
  });

  it("converts _jsxs with props and children", () => {
    const result = transformJsxNew(
      '_jsxs("ul", {className: "list", children: [a, b]})'
    );
    expect(result).toBe('<ul className="list">{a}{b}</ul>;');
  });
});
