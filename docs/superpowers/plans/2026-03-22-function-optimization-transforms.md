# 函数优化 Transform 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 实现三个新 transform（函数内联、纯函数预执行、死函数消除）并集成到去混淆管线。

**架构：** 三个独立 transform 文件，遵循现有 `{ name, tags, run(ast, state, options) }` 接口，插入 `src/index.js` 去混淆循环的对应位置。所有 transform 通过 `taintedNames` 参数尊重 `--preserve` 设置。

**技术栈：** Node.js, @babel/parser, @babel/traverse, @babel/types, @babel/generator, Vitest

**规格文档：** `docs/superpowers/specs/2026-03-22-function-optimization-transforms-design.md`

---

### Task 0: 前置修复与导出

**文件：**
- 修改：`src/transforms/constantFolding.js:90` — 导出 `tryEvaluate` 和 `valueToNode`
- 修改：`src/utils/sandbox.js:184` — 修复 `execute()` 缺少 return 的 bug
- 测试：`test/transforms/constantFolding.test.mjs`（现有测试应继续通过）

- [ ] **Step 1: 修复 sandbox.js 的 execute 方法**

在 `src/utils/sandbox.js` 第 184 行，`createJsdomInstance()` 的 `execute` 方法缺少 `return`：

```javascript
// 原代码：async execute(code) { executeInSandbox(context, code); },
// 修复为：
async execute(code) { return executeInSandbox(context, code); },
```

- [ ] **Step 2: 修改 constantFolding.js 导出**

在 `src/transforms/constantFolding.js` 中，当前的 `module.exports` 只导出 transform 对象。需要同时导出 `tryEvaluate` 和 `valueToNode`：

```javascript
// src/transforms/constantFolding.js 末尾（替换原有的 module.exports 行之后追加）
// 将原来的 module.exports = { name, tags, run } 改为：
const constantFolding = {
  name: "constantFolding",
  tags: ["safe"],
  run(ast, state) {
    // ... 现有代码不变
  },
};

module.exports = constantFolding;
module.exports.tryEvaluate = tryEvaluate;
module.exports.valueToNode = valueToNode;
```

具体来说：把 `module.exports = { name: "constantFolding", ... }` 改为先赋值给变量 `const constantFolding = { ... }`，再 `module.exports = constantFolding`，然后追加两行命名导出。

- [ ] **Step 3: 运行现有测试确认不破坏**

运行：`npm test -- --run test/transforms/constantFolding.test.mjs`
期望：全部通过

- [ ] **Step 4: 提交**

```bash
git add src/transforms/constantFolding.js src/utils/sandbox.js
git commit -m "refactor: export tryEvaluate/valueToNode from constantFolding, fix sandbox execute return"
```

---

### Task 1: 函数内联 — 测试

**文件：**
- 创建：`test/transforms/functionInlining.test.mjs`

- [ ] **Step 1: 创建测试文件，编写全部测试用例**

```javascript
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
    expect(code).not.toContain("function add");
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
    expect(code).not.toContain("function wrap");
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
```

- [ ] **Step 2: 运行测试确认全部失败**

运行：`npm test -- --run test/transforms/functionInlining.test.mjs`
期望：全部 FAIL（模块不存在）

- [ ] **Step 3: 提交测试**

```bash
git add test/transforms/functionInlining.test.mjs
git commit -m "test: add functionInlining test suite"
```

---

### Task 2: 函数内联 — 实现

**文件：**
- 创建：`src/transforms/functionInlining.js`

- [ ] **Step 1: 实现 functionInlining transform**

```javascript
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const generate = require("@babel/generator").default;
const { createLogger } = require("../utils/logger");
const { log } = createLogger("functionInlining");

const MAX_CALL_SITES_UNCONDITIONAL = 5;
const MAX_STATEMENTS_SMALL = 3;

/**
 * 检查函数是否包含不安全关键字（this、arguments、yield、await）
 */
function hasUnsafeKeywords(funcNode) {
  let found = false;
  traverse(
    t.file(t.program([t.isBlockStatement(funcNode.body)
      ? funcNode.body
      : t.expressionStatement(funcNode.body)
    ])),
    {
      ThisExpression() { found = true; },
      Identifier(path) {
        if (path.node.name === "arguments" && !path.scope.hasOwnBinding("arguments")) {
          found = true;
        }
      },
      YieldExpression() { found = true; },
      AwaitExpression() { found = true; },
      // 不进入嵌套函数
      FunctionDeclaration(path) { path.skip(); },
      FunctionExpression(path) { path.skip(); },
      ArrowFunctionExpression(path) { path.skip(); },
    },
    undefined,
    { noScope: true }
  );
  return found;
}

/**
 * 检查函数是否有非简单参数（默认值、剩余参数、解构参数）
 */
function hasComplexParams(funcNode) {
  return funcNode.params.some(
    (p) => !t.isIdentifier(p)
  );
}

/**
 * 检查函数体是否引用自身名称（递归）
 */
function isRecursive(funcName, funcNode) {
  let recursive = false;
  traverse(
    t.file(t.program([funcNode.body])),
    {
      Identifier(path) {
        if (path.node.name === funcName) recursive = true;
      },
      FunctionDeclaration(path) { path.skip(); },
      FunctionExpression(path) { path.skip(); },
      ArrowFunctionExpression(path) { path.skip(); },
    },
    undefined,
    { noScope: true }
  );
  return recursive;
}

/**
 * 检查函数是否引用外部可变绑定（闭包中的非常量变量）
 * 全局引用（Math, console 等）不阻止内联
 */
function hasExternalMutableRefs(funcPath) {
  let hasMutable = false;
  funcPath.traverse({
    Identifier(idPath) {
      if (hasMutable) return;
      // 排除属性访问的 key
      if (idPath.parentPath.isMemberExpression() && idPath.parentPath.node.property === idPath.node && !idPath.parentPath.node.computed) return;
      // 排除函数参数声明
      if (idPath.listKey === "params") return;
      // 排除声明位置
      if (idPath.parentPath.isVariableDeclarator() && idPath.parentPath.node.id === idPath.node) return;
      if (idPath.parentPath.isFunctionDeclaration() && idPath.parentPath.node.id === idPath.node) return;

      const name = idPath.node.name;
      const binding = idPath.scope.getBinding(name);
      if (!binding) return; // 全局变量，允许
      // 检查绑定是否在函数内部
      const funcScope = funcPath.scope;
      if (binding.scope === funcScope || binding.scope.path.isDescendant(funcPath)) return; // 函数内部绑定
      // 外部绑定且非常量
      if (!binding.constant) {
        hasMutable = true;
      }
    },
  });
  return hasMutable;
}

/**
 * 检查节点是否可能有副作用
 */
function isPureExpression(node) {
  if (t.isLiteral(node)) return true;
  if (t.isIdentifier(node)) return true;
  if (t.isUnaryExpression(node) && node.operator !== "delete") return isPureExpression(node.argument);
  if (t.isBinaryExpression(node)) return isPureExpression(node.left) && isPureExpression(node.right);
  if (t.isMemberExpression(node)) return isPureExpression(node.object) && (node.computed ? isPureExpression(node.property) : true);
  return false;
}

/**
 * 将实参代入形参，克隆表达式
 */
function substituteParams(node, paramMap) {
  const cloned = t.cloneDeep(node);
  replaceIdents(cloned, paramMap);
  return cloned;
}

function replaceIdents(node, paramMap) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key.startsWith("_")) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        if (t.isIdentifier(child[i]) && paramMap.has(child[i].name)) {
          child[i] = t.cloneDeep(paramMap.get(child[i].name));
        } else {
          replaceIdents(child[i], paramMap);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      if (t.isIdentifier(child) && paramMap.has(child.name)) {
        node[key] = t.cloneDeep(paramMap.get(child.name));
      } else {
        replaceIdents(child, paramMap);
      }
    }
  }
}

/**
 * 计算参数在函数体中的引用次数
 */
function countParamRefs(funcBody, paramNames) {
  const counts = new Map();
  for (const name of paramNames) counts.set(name, 0);

  traverse(
    t.file(t.program([funcBody])),
    {
      Identifier(path) {
        if (counts.has(path.node.name)) {
          counts.set(path.node.name, counts.get(path.node.name) + 1);
        }
      },
      FunctionDeclaration(path) { path.skip(); },
      FunctionExpression(path) { path.skip(); },
      ArrowFunctionExpression(path) { path.skip(); },
    },
    undefined,
    { noScope: true }
  );
  return counts;
}

module.exports = {
  name: "functionInlining",
  tags: ["unsafe"],
  run(ast, state, options = {}) {
    const taintedNames = options.taintedNames || new Set();
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      // Phase 1: 收集所有函数定义及其调用点
      const funcDefs = new Map(); // name -> { path, funcNode, callSites: [] }

      traverse(ast, {
        FunctionDeclaration(path) {
          const name = path.node.id && path.node.id.name;
          if (!name) return;
          if (taintedNames.has(name)) return;
          funcDefs.set(name, { path, funcNode: path.node, callSites: [] });
        },
        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const init = path.node.init;
          if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;
          const name = path.node.id.name;
          if (taintedNames.has(name)) return;
          funcDefs.set(name, { path, funcNode: init, callSites: [] });
        },
      });

      // Phase 2: 收集调用点
      traverse(ast, {
        CallExpression(path) {
          if (!t.isIdentifier(path.node.callee)) return;
          const name = path.node.callee.name;
          const def = funcDefs.get(name);
          if (def) def.callSites.push(path);
        },
      });

      // Phase 3: 对每个函数判断是否可内联并执行
      for (const [name, def] of funcDefs) {
        const { funcNode, callSites } = def;
        if (callSites.length === 0) continue;

        // 安全检查
        if (hasComplexParams(funcNode)) continue;
        if (hasUnsafeKeywords(funcNode)) continue;
        if (isRecursive(name, funcNode)) continue;
        if (hasExternalMutableRefs(def.path)) continue;

        const body = funcNode.body;
        if (!t.isBlockStatement(body)) continue; // 箭头函数表达式体暂不处理

        const stmts = body.body;
        const callCount = callSites.length;

        // 判断是否可内联
        const isSmall = stmts.length <= MAX_STATEMENTS_SMALL;
        if (callCount > MAX_CALL_SITES_UNCONDITIONAL && !isSmall) continue;

        // 单 return 语句 vs 多语句
        const isSingleReturn = stmts.length === 1 && t.isReturnStatement(stmts[0]) && stmts[0].argument;

        const paramNames = funcNode.params.map((p) => p.name);
        const paramRefCounts = countParamRefs(body, paramNames);

        // 检查副作用参数 + 多次引用
        let unsafeArgs = false;
        for (const callPath of callSites) {
          const args = callPath.node.arguments;
          for (let i = 0; i < paramNames.length; i++) {
            const arg = args[i];
            if (!arg) continue;
            const refCount = paramRefCounts.get(paramNames[i]) || 0;
            if (refCount > 1 && !isPureExpression(arg)) {
              unsafeArgs = true;
              break;
            }
          }
          if (unsafeArgs) break;
        }
        if (unsafeArgs) continue;

        // 执行内联
        let inlinedAny = false;
        for (const callPath of callSites) {
          if (!callPath.node) continue; // 可能已被移除
          const args = callPath.node.arguments;
          const paramMap = new Map();
          for (let i = 0; i < paramNames.length; i++) {
            paramMap.set(paramNames[i], args[i] || t.identifier("undefined"));
          }

          if (isSingleReturn) {
            // 单 return：替换调用为 return 表达式
            const replaced = substituteParams(stmts[0].argument, paramMap);
            callPath.replaceWith(replaced);
            inlinedAny = true;
          } else {
            // 多语句：需要调用处是 ExpressionStatement 或 VariableDeclarator
            const parent = callPath.parentPath;
            let insertionPath = null;
            let resultTarget = null;

            if (parent.isExpressionStatement()) {
              insertionPath = parent;
            } else if (parent.isVariableDeclarator() && parent.parentPath.isVariableDeclaration()) {
              insertionPath = parent.parentPath;
              resultTarget = parent.node.id;
            } else {
              continue; // 不支持的调用位置
            }

            // 构建替换语句
            const newStmts = [];
            for (let i = 0; i < stmts.length; i++) {
              const stmt = stmts[i];
              if (t.isReturnStatement(stmt)) {
                if (stmt.argument && resultTarget) {
                  // var result = compute(10) → ... result = t + 1
                  const assignment = t.expressionStatement(
                    t.assignmentExpression("=", t.cloneDeep(resultTarget), substituteParams(stmt.argument, paramMap))
                  );
                  newStmts.push(assignment);
                }
                // 无 return 值或无 resultTarget 时跳过 return
              } else {
                newStmts.push(substituteParams(stmt, paramMap));
              }
            }

            if (resultTarget) {
              // 替换 var result = compute(10) 为 var result; ... result = t + 1;
              insertionPath.replaceWithMultiple([
                t.variableDeclaration("var", [t.variableDeclarator(t.cloneDeep(resultTarget))]),
                ...newStmts,
              ]);
            } else {
              // 替换 ExpressionStatement
              insertionPath.replaceWithMultiple(newStmts);
            }
            inlinedAny = true;
          }
        }

        if (inlinedAny) {
          changes++;
        }
      }

      // 刷新作用域
      if (changes > 0) {
        traverse(ast, {
          Program(path) { path.scope.crawl(); },
        });
      }

      totalChanges += changes;
      log("Pass", pass, ":", changes, "functions inlined");
      if (changes === 0) break;
    }

    state.changes += totalChanges;
  },
};
```

- [ ] **Step 2: 运行测试**

运行：`npm test -- --run test/transforms/functionInlining.test.mjs`
期望：全部通过

- [ ] **Step 3: 调试并修复失败的测试**

根据测试失败情况调整实现。常见需要调整的点：
- `substituteParams` 对多语句块的处理
- `hasExternalMutableRefs` 对 `counter++` 等副作用模式的检测
- 函数声明 vs 函数表达式路径处理的差异

- [ ] **Step 4: 提交**

```bash
git add src/transforms/functionInlining.js
git commit -m "feat: implement functionInlining transform"
```

---

### Task 3: 纯函数预执行 — 测试

**文件：**
- 创建：`test/transforms/pureFunctionEvaluation.test.mjs`

- [ ] **Step 1: 创建测试文件**

```javascript
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const pureFunctionEvaluation = require("../../src/transforms/pureFunctionEvaluation");

function transform(code, options = {}) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  // run 是 async 的
  return pureFunctionEvaluation.run(ast, state, options).then(() => ({
    code: generate(ast).code,
    changes: state.changes,
  }));
}

describe("pureFunctionEvaluation", () => {
  // === 第一层：AST 静态求值 ===

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

  // === 第二层：沙箱执行 ===

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

  // === 不可替换类型 ===

  it("does not replace NaN result", async () => {
    const input = `
      function bad(a) { return a / 0 * 0; }
      var r = bad(1);
    `;
    const { code, changes } = await transform(input, { sandboxType: "jsdom" });
    expect(code).toContain("bad(1)");
  });

  // === 跳过规则 ===

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
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npm test -- --run test/transforms/pureFunctionEvaluation.test.mjs`
期望：全部 FAIL

- [ ] **Step 3: 提交测试**

```bash
git add test/transforms/pureFunctionEvaluation.test.mjs
git commit -m "test: add pureFunctionEvaluation test suite"
```

---

### Task 4: 纯函数预执行 — 实现

**文件：**
- 创建：`src/transforms/pureFunctionEvaluation.js`

- [ ] **Step 1: 实现 pureFunctionEvaluation transform**

```javascript
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const { tryEvaluate, valueToNode } = require("./constantFolding");
const { createSandboxInstance } = require("../utils/sandbox");
const { referencesAny } = require("../utils/taintAnalysis");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("pureFunctionEvaluation");

/**
 * 副作用 API 黑名单（成员表达式的对象名）
 */
const SIDE_EFFECT_OBJECTS = new Set([
  "console", "document", "window", "fetch", "XMLHttpRequest",
  "localStorage", "sessionStorage", "indexedDB",
  "fs", "process", "require", "import",
]);

/**
 * 纯函数白名单（允许调用的全局函数/方法）
 */
const PURE_GLOBALS = new Set([
  "Math", "String", "Number", "Boolean", "parseInt", "parseFloat",
  "atob", "btoa", "decodeURIComponent", "encodeURIComponent",
  "isNaN", "isFinite",
]);

/**
 * 检查函数体是否为纯函数（无副作用）
 */
function isPureFunction(funcNode, funcPath) {
  let pure = true;

  funcPath.traverse({
    // 检查是否调用了副作用 API
    CallExpression(callPath) {
      if (!pure) return;
      const callee = callPath.node.callee;
      // console.log(...) 等
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
        if (SIDE_EFFECT_OBJECTS.has(callee.object.name)) {
          pure = false;
          return;
        }
      }
      // 直接调用全局副作用函数
      if (t.isIdentifier(callee) && SIDE_EFFECT_OBJECTS.has(callee.name)) {
        pure = false;
        return;
      }
    },
    // 赋值给外部变量
    AssignmentExpression(assignPath) {
      if (!pure) return;
      const left = assignPath.node.left;
      if (t.isIdentifier(left)) {
        const binding = assignPath.scope.getBinding(left.name);
        if (!binding || !binding.scope.path.isDescendant(funcPath)) {
          // 赋值给函数外部变量
          pure = false;
        }
      }
      if (t.isMemberExpression(left)) {
        // 修改对象属性可能有副作用
        // 但如果对象是函数内部声明的则可以
        if (t.isIdentifier(left.object)) {
          const binding = assignPath.scope.getBinding(left.object.name);
          if (!binding || !binding.scope.path.isDescendant(funcPath)) {
            pure = false;
          }
        }
      }
    },
    UpdateExpression(updatePath) {
      if (!pure) return;
      const arg = updatePath.node.argument;
      if (t.isIdentifier(arg)) {
        const binding = updatePath.scope.getBinding(arg.name);
        if (!binding || !binding.scope.path.isDescendant(funcPath)) {
          pure = false;
        }
      }
    },
    // 引用外部可变变量
    Identifier(idPath) {
      if (!pure) return;
      // 排除属性 key
      if (idPath.parentPath.isMemberExpression() && idPath.parentPath.node.property === idPath.node && !idPath.parentPath.node.computed) return;
      // 排除声明位置
      if (idPath.parentPath.isVariableDeclarator() && idPath.parentPath.node.id === idPath.node) return;
      if (idPath.listKey === "params") return;

      const name = idPath.node.name;
      const binding = idPath.scope.getBinding(name);
      if (!binding) {
        // 全局变量：仅允许白名单
        if (!PURE_GLOBALS.has(name) && name !== "undefined" && name !== "NaN" && name !== "Infinity") {
          // 非白名单全局变量，可能有副作用
          // 但如果是函数参数则OK
          if (!funcNode.params.some(p => t.isIdentifier(p) && p.name === name)) {
            pure = false;
          }
        }
        return;
      }
      // 外部可变绑定
      if (!binding.scope.path.isDescendant(funcPath) && binding.scope !== funcPath.scope) {
        if (!binding.constant) {
          pure = false;
        }
      }
    },
    ThisExpression() { pure = false; },
    // 不进入嵌套函数
    FunctionDeclaration(path) { path.skip(); },
    FunctionExpression(path) { path.skip(); },
    ArrowFunctionExpression(path) { path.skip(); },
  });

  return pure;
}

/**
 * 检查所有参数是否为字面量
 */
function allArgsLiteral(args) {
  return args.every((arg) => {
    if (t.isNumericLiteral(arg) || t.isStringLiteral(arg) || t.isBooleanLiteral(arg) || t.isNullLiteral(arg)) return true;
    if (t.isUnaryExpression(arg, { operator: "-" }) && t.isNumericLiteral(arg.argument)) return true;
    if (t.isUnaryExpression(arg, { operator: "!" }) && t.isBooleanLiteral(arg.argument)) return true;
    return false;
  });
}

/**
 * 检查函数是否为单 return 且 return 表达式仅含参数和字面量
 */
function isSingleReturnPure(funcNode) {
  if (!t.isBlockStatement(funcNode.body)) return false;
  const stmts = funcNode.body.body;
  if (stmts.length !== 1 || !t.isReturnStatement(stmts[0]) || !stmts[0].argument) return false;
  return true;
}

/**
 * 代入参数后检查是否可由 tryEvaluate 求值
 */
function tryStaticEval(funcNode, args) {
  if (!isSingleReturnPure(funcNode)) return null;

  const paramNames = funcNode.params.map((p) => p.name);
  const paramMap = new Map();
  for (let i = 0; i < paramNames.length; i++) {
    paramMap.set(paramNames[i], args[i] || t.identifier("undefined"));
  }

  // 代入参数
  const expr = t.cloneDeep(funcNode.body.body[0].argument);
  substituteIdentifiers(expr, paramMap);

  // 尝试求值
  const result = tryEvaluate(expr);
  if (result === null) return null;

  const node = valueToNode(result.value);
  return node;
}

function substituteIdentifiers(node, paramMap) {
  if (!node || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key.startsWith("_")) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        if (t.isIdentifier(child[i]) && paramMap.has(child[i].name)) {
          child[i] = t.cloneDeep(paramMap.get(child[i].name));
        } else {
          substituteIdentifiers(child[i], paramMap);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      if (t.isIdentifier(child) && paramMap.has(child.name)) {
        node[key] = t.cloneDeep(paramMap.get(child.name));
      } else {
        substituteIdentifiers(child, paramMap);
      }
    }
  }
}

/**
 * 将沙箱执行结果转换为 AST 节点
 */
function resultToNode(value) {
  if (value === null) return t.nullLiteral();
  if (value === undefined) return t.identifier("undefined");
  if (typeof value === "boolean") return t.booleanLiteral(value);
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    if (value < 0) return t.unaryExpression("-", t.numericLiteral(-value));
    return t.numericLiteral(value);
  }
  if (typeof value === "string") return t.stringLiteral(value);
  if (value instanceof RegExp) return t.regExpLiteral(value.source, value.flags);
  if (typeof value === "symbol" || typeof value === "function") return null;
  if (Array.isArray(value)) {
    const elems = value.map(resultToNode);
    if (elems.some((e) => e === null)) return null;
    return t.arrayExpression(elems);
  }
  if (typeof value === "object") {
    // 检测循环引用
    try { JSON.stringify(value); } catch { return null; }
    const props = Object.entries(value).map(([k, v]) => {
      const valNode = resultToNode(v);
      if (valNode === null) return null;
      return t.objectProperty(t.stringLiteral(k), valNode);
    });
    if (props.some((p) => p === null)) return null;
    return t.objectExpression(props);
  }
  return null;
}

module.exports = {
  name: "pureFunctionEvaluation",
  tags: ["unsafe"],
  async run(ast, state, options = {}) {
    const taintedNames = options.taintedNames || new Set();
    const sandboxType = options.sandboxType;
    let totalChanges = 0;

    // Phase 1: 收集候选函数定义
    const funcDefs = new Map(); // name -> { path, funcNode }

    traverse(ast, {
      FunctionDeclaration(path) {
        const name = path.node.id && path.node.id.name;
        if (!name || taintedNames.has(name)) return;
        funcDefs.set(name, { path, funcNode: path.node });
      },
      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id)) return;
        const init = path.node.init;
        if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;
        const name = path.node.id.name;
        if (taintedNames.has(name)) return;
        funcDefs.set(name, { path, funcNode: init });
      },
    });

    // Phase 2: 收集可求值的调用并尝试 AST 静态求值
    const sandboxCandidates = []; // 静态求值失败、需要沙箱的

    traverse(ast, {
      CallExpression(path) {
        if (!t.isIdentifier(path.node.callee)) return;
        const name = path.node.callee.name;
        const def = funcDefs.get(name);
        if (!def) return;

        // 检查参数是否全为字面量
        const args = path.node.arguments;
        if (!allArgsLiteral(args)) return;

        // 检查参数是否 tainted
        if (taintedNames.size > 0 && args.some(arg => referencesAny(arg, taintedNames))) return;

        // 尝试第一层：AST 静态求值
        const staticResult = tryStaticEval(def.funcNode, args);
        if (staticResult) {
          path.replaceWith(staticResult);
          totalChanges++;
          return;
        }

        // 收集为沙箱候选
        if (sandboxType && isPureFunction(def.funcNode, def.path)) {
          sandboxCandidates.push({ callPath: path, def, args });
        }
      },
    });

    // Phase 3: 沙箱执行
    if (sandboxCandidates.length > 0 && sandboxType) {
      log("Evaluating", sandboxCandidates.length, "candidates via sandbox (type:", sandboxType + ")");
      const sandbox = await createSandboxInstance(sandboxType);
      try {
        for (const { callPath, def, args } of sandboxCandidates) {
          if (!callPath.node) continue; // 可能已被替换
          try {
            // 生成函数定义 + 调用代码
            const funcCode = generate(def.funcNode.type === "FunctionDeclaration" ? def.funcNode : t.functionDeclaration(t.identifier("__fn"), def.funcNode.params, def.funcNode.body)).code;
            const fnName = def.funcNode.type === "FunctionDeclaration" ? def.funcNode.id.name : "__fn";
            const argsStr = args.map((a) => generate(a).code).join(", ");
            const code = funcCode + "\n" + fnName + "(" + argsStr + ")";

            const result = await sandbox.execute(code);
            const node = resultToNode(result);
            if (node) {
              callPath.replaceWith(node);
              totalChanges++;
            }
          } catch (err) {
            log("Sandbox evaluation failed:", err.message);
          }
        }
      } finally {
        await sandbox.close();
      }
    }

    log(totalChanges, "calls evaluated");
    state.changes += totalChanges;
  },
};
```

- [ ] **Step 2: 运行测试**

运行：`npm test -- --run test/transforms/pureFunctionEvaluation.test.mjs`
期望：全部通过（沙箱测试需要 jsdom 可用）

- [ ] **Step 3: 调试并修复**

重点关注：
- `tryStaticEval` 的参数代入逻辑
- `isPureFunction` 对各种模式的检测
- `resultToNode` 对数组/对象的递归转换
- 沙箱 `execute` 返回值的行为（JSDOM 的 `vm.Script.runInContext` 返回最后一个表达式的值）

- [ ] **Step 4: 提交**

```bash
git add src/transforms/pureFunctionEvaluation.js
git commit -m "feat: implement pureFunctionEvaluation transform"
```

---

### Task 5: 死函数消除 — 测试

**文件：**
- 创建：`test/transforms/deadFunctionElimination.test.mjs`

- [ ] **Step 1: 创建测试文件**

```javascript
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const deadFunctionElimination = require("../../src/transforms/deadFunctionElimination");

function transform(code, options = {}) {
  const ast = parser.parse(code, { sourceType: "script" });
  const state = { changes: 0 };
  deadFunctionElimination.run(ast, state, options);
  return { code: generate(ast).code, changes: state.changes };
}

describe("deadFunctionElimination", () => {
  // === 保守模式 ===

  it("removes local zero-reference function declaration", () => {
    const input = `
      function outer() {
        function unused() { return 1; }
        return 2;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("function unused");
  });

  it("removes local zero-reference function expression", () => {
    const input = `
      function outer() {
        var unused = function() { return 1; };
        return 2;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("unused");
  });

  it("preserves top-level zero-reference function in conservative mode", () => {
    const input = `
      function unused() { return 1; }
      var x = 2;
    `;
    const { code, changes } = transform(input);
    expect(changes).toBe(0);
    expect(code).toContain("function unused");
  });

  it("preserves called function", () => {
    const input = `
      function outer() {
        function used() { return 1; }
        return used();
      }
    `;
    const { code, changes } = transform(input);
    expect(code).toContain("function used");
  });

  // === 激进模式 ===

  it("removes top-level zero-reference function in aggressive mode", () => {
    const input = `
      function unused() { return 1; }
      var x = 2;
    `;
    const { code, changes } = transform(input, { aggressiveDce: true });
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("function unused");
  });

  it("removes top-level var f = function() in aggressive mode", () => {
    const input = `
      var unused = function() { return 1; };
      var x = 2;
    `;
    const { code, changes } = transform(input, { aggressiveDce: true });
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("unused");
  });

  // === 迭代删除 ===

  it("iteratively removes functions (A calls B, A removed → B also removed)", () => {
    const input = `
      function outer() {
        function a() { return b(); }
        function b() { return 1; }
        return 2;
      }
    `;
    const { code, changes } = transform(input);
    expect(changes).toBeGreaterThan(0);
    expect(code).not.toContain("function a");
    expect(code).not.toContain("function b");
  });

  // === 安全守卫 ===

  it("respects taintedNames", () => {
    const input = `
      function outer() {
        function preserved() { return 1; }
        return 2;
      }
    `;
    const taintedNames = new Set(["preserved"]);
    const { code, changes } = transform(input, { taintedNames });
    expect(code).toContain("function preserved");
  });

  it("skips function used as object property", () => {
    const input = `
      function outer() {
        var handler = function() { return 1; };
        var obj = { method: handler };
        return obj;
      }
    `;
    const { code, changes } = transform(input);
    expect(code).toContain("handler");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npm test -- --run test/transforms/deadFunctionElimination.test.mjs`
期望：全部 FAIL

- [ ] **Step 3: 提交测试**

```bash
git add test/transforms/deadFunctionElimination.test.mjs
git commit -m "test: add deadFunctionElimination test suite"
```

---

### Task 6: 死函数消除 — 实现

**文件：**
- 创建：`src/transforms/deadFunctionElimination.js`

- [ ] **Step 1: 实现 deadFunctionElimination transform**

```javascript
const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("deadFunctionElimination");

module.exports = {
  name: "deadFunctionElimination",
  tags: ["unsafe"],
  run(ast, state, options = {}) {
    const taintedNames = options.taintedNames || new Set();
    const aggressiveDce = options.aggressiveDce || false;
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      traverse(ast, {
        // 处理 FunctionDeclaration
        FunctionDeclaration(path) {
          const name = path.node.id && path.node.id.name;
          if (!name) return;
          if (taintedNames.has(name)) return;

          // 保守模式下跳过顶层
          if (!aggressiveDce && path.parentPath.isProgram()) return;

          const binding = path.scope.getBinding(name);
          if (!binding) return;

          // 检查是否有引用
          if (binding.referencePaths.length > 0) return;

          path.remove();
          changes++;
        },

        // 处理 var f = function() {}
        VariableDeclarator(path) {
          if (!t.isIdentifier(path.node.id)) return;
          const init = path.node.init;
          if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;

          const name = path.node.id.name;
          if (taintedNames.has(name)) return;

          // 保守模式下跳过顶层
          if (!aggressiveDce) {
            const varDecl = path.parentPath;
            if (varDecl.parentPath && varDecl.parentPath.isProgram()) return;
          }

          const binding = path.scope.getBinding(name);
          if (!binding) return;

          // 检查引用是否都是在对象属性值中（动态调用风险）
          const hasObjPropRef = binding.referencePaths.some((refPath) => {
            return refPath.parentPath.isObjectProperty() && refPath.parentPath.node.value === refPath.node;
          });
          if (hasObjPropRef) return;

          // 检查是否有引用
          if (binding.referencePaths.length > 0) return;

          // 如果所在的 VariableDeclaration 只有这一个 declarator，移除整个声明
          const varDecl = path.parentPath;
          if (varDecl.node.declarations.length === 1) {
            varDecl.remove();
          } else {
            path.remove();
          }
          changes++;
        },
      });

      // 刷新作用域
      if (changes > 0) {
        traverse(ast, {
          Program(path) { path.scope.crawl(); },
        });
      }

      totalChanges += changes;
      log("Pass", pass, ":", changes, "functions removed");
      if (changes === 0) break;
    }

    state.changes += totalChanges;
  },
};
```

- [ ] **Step 2: 运行测试**

运行：`npm test -- --run test/transforms/deadFunctionElimination.test.mjs`
期望：全部通过

- [ ] **Step 3: 调试并修复**

重点关注：
- `binding.referencePaths` 在作用域刷新后的状态
- 顶层判定：`path.parentPath.isProgram()` 的准确性
- 迭代删除：A 的引用消失后 B 在下一轮变为零引用

- [ ] **Step 4: 提交**

```bash
git add src/transforms/deadFunctionElimination.js
git commit -m "feat: implement deadFunctionElimination transform"
```

---

### Task 7: 管线集成

**文件：**
- 修改：`src/cli.js`（添加 `--aggressive-dce` 选项）
- 修改：`src/index.js`（添加三个 transform 到循环）

- [ ] **Step 1: 修改 cli.js — 添加 `--aggressive-dce`**

在 `src/cli.js` 的选项定义区（现有 `--preserve` 之后）添加：

```javascript
.option("--aggressive-dce", "Enable aggressive dead function elimination (removes top-level unused functions)")
```

在构建 `deobfuscateOpts` 的代码块中添加：

```javascript
if (opts.aggressiveDce) {
  deobfuscateOpts.aggressiveDce = true;
}
```

- [ ] **Step 2: 修改 index.js — 导入新 transform**

在 `src/index.js` 顶部导入区追加：

```javascript
const functionInlining = require("./transforms/functionInlining");
const pureFunctionEvaluation = require("./transforms/pureFunctionEvaluation");
const deadFunctionElimination = require("./transforms/deadFunctionElimination");
```

在 `deobfuscate()` 函数的 options 解构中追加 `aggressiveDce`：

```javascript
const {
  sandboxType = "playwright",
  maxIterations = Infinity,
  preserveNames = new Set(),
  aiConfig = null,
  verbose = false,
  plugins = {},
  aggressiveDce = false,
} = options;
```

- [ ] **Step 3: 修改 index.js — 在循环中添加 transform 调用**

**位置 5（objectProxyInlining 之后、controlFlowUnflattening 之前）** 添加 functionInlining：

```javascript
    log("Running function inlining...");
    {
      const s = { changes: 0 };
      functionInlining.run(ast, s, { taintedNames });
      log("Function inlining complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }
```

**位置 8（stringDecryptor 块之后、commaExpressionSplitter 之前）** 添加 pureFunctionEvaluation：

```javascript
    log("Running pure function evaluation...");
    {
      const s = { changes: 0 };
      await pureFunctionEvaluation.run(ast, s, { taintedNames, sandboxType });
      log("Pure function evaluation complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }
```

**位置 9（pureFunctionEvaluation 之后、commaExpressionSplitter 之前）** 添加 deadFunctionElimination：

```javascript
    log("Running dead function elimination...");
    {
      const s = { changes: 0 };
      deadFunctionElimination.run(ast, s, { taintedNames, aggressiveDce });
      log("Dead function elimination complete,", s.changes, "changes");
      iterationChanges += s.changes;
    }
```

- [ ] **Step 4: 运行全部测试**

运行：`npm test`
期望：全部通过（包括所有新测试和现有测试）

- [ ] **Step 5: 提交**

```bash
git add src/cli.js src/index.js
git commit -m "feat: integrate function optimization transforms into pipeline"
```

---

### Task 8: 集成测试

**文件：**
- 修改：已有测试文件或创建 `test/integration/functionOptimization.test.mjs`

- [ ] **Step 1: 创建集成测试**

```javascript
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
    });
    // wrapper 应被内联，helper(10, 20) 应被求值为 30
    expect(code).toContain("30");
    // 死函数应被清理
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
    // seed 被保护，compute 引用了 tainted 的 seed，不应被求值
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
```

- [ ] **Step 2: 运行集成测试**

运行：`npm test -- --run test/integration/functionOptimization.test.mjs`
期望：全部通过

- [ ] **Step 3: 运行全部测试确认无回归**

运行：`npm test`
期望：全部通过

- [ ] **Step 4: 提交**

```bash
git add test/integration/functionOptimization.test.mjs
git commit -m "test: add function optimization integration tests"
```

---

### Task 9: 最终验证

- [ ] **Step 1: 用实际混淆文件测试**

如果 `test/fixtures/` 下有样本文件：

运行：`node src/cli.js test/fixtures/sample_obfuscated.js -o /tmp/out.js -v --sandbox jsdom`
检查：输出中有 function inlining、pure function evaluation、dead function elimination 的日志

- [ ] **Step 2: 测试 --aggressive-dce 选项**

运行：`node src/cli.js test/fixtures/sample_obfuscated.js -o /tmp/out.js -v --aggressive-dce`
检查：日志显示激进模式启用

- [ ] **Step 3: 测试 --preserve 选项**

运行：`node src/cli.js test/fixtures/sample_obfuscated.js -o /tmp/out.js -v --preserve someVar`
检查：someVar 及其依赖链不被内联/求值/删除

- [ ] **Step 4: 运行全部测试套件最终确认**

运行：`npm test`
期望：全部通过
