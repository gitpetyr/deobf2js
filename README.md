# deobf2js

通用 JavaScript 反混淆框架。纯 Node.js + Babel AST 管线，支持反混淆、代码美化、现代语法还原、Bundle 解包、JSX 反编译和变量重命名，内置插件系统和多种沙箱后端。

## 快速开始

```bash
# 安装依赖
npm install

# 基本用法
node src/cli.js obfuscated.js -o clean.js

# 详细日志
node src/cli.js obfuscated.js -o clean.js -v

# 选择沙箱后端
node src/cli.js obfuscated.js -o clean.js --sandbox jsdom

# 限制迭代次数
node src/cli.js obfuscated.js -o clean.js --max-iterations 5

# 保留指定变量名不被传播
node src/cli.js obfuscated.js -o clean.js --preserve seed,config

# 跳过特定阶段
node src/cli.js obfuscated.js -o clean.js --no-unminify --no-transpile

# 启用变量名压缩
node src/cli.js obfuscated.js -o clean.js --mangle

# 通过 npm script 运行
npm run deobfuscate -- obfuscated.js -o clean.js -v
```

## CLI 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `<input>` | 输入文件路径 | (必填) |
| `-o, --output <path>` | 输出文件路径（省略则输出到 stdout） | - |
| `-v, --verbose` | 启用详细日志（输出到 stderr） | `false` |
| `--sandbox <type>` | 沙箱类型：`playwright` / `jsdom` / `isolated-vm` | `playwright` |
| `--max-iterations <n>` | 最大管线迭代次数 | `Infinity` |
| `--preserve <vars>` | 逗号分隔的种子变量名，不被传播优化 | - |
| `--ai-provider <p>` | AI 提供商：`openai` / `gemini` / `claude` | - |
| `--ai-model <m>` | AI 模型名称 | 取决于 provider |
| `--ai-base-url <url>` | AI API 地址 | - |
| `--no-deobfuscate` | 跳过反混淆阶段 | - |
| `--no-unminify` | 跳过代码美化阶段 | - |
| `--no-transpile` | 跳过语法还原阶段 | - |
| `--no-unpack` | 跳过 Bundle 解包 | - |
| `--no-jsx` | 跳过 JSX 反编译 | - |
| `-m, --mangle` | 启用变量名压缩 | `false` |
| `-f, --force` | 强制覆盖输出文件 | `false` |

## 处理能力

### 反混淆（Deobfuscate）

| 混淆技术 | 处理模块 | 示例 |
|----------|---------|------|
| 类型混淆 | `constantFolding` | `!![]` → `true`、`+[]` → `0` |
| 常量表达式折叠 | `constantFolding` | `1 + 2` → `3`、`"a" + "b"` → `"ab"` |
| 死分支消除 | `constantFolding` | `if (true) { A } else { B }` → `A` |
| 逻辑表达式简化 | `constantFolding` | `true && x` → `x`、`false \|\| x` → `x` |
| 常量对象内联 | `constantObjectInlining` | `obj.W` → `1204` |
| 对象方法代理内联 | `objectProxyInlining` | `obj['fn'](a, b)` → `a !== b` |
| 控制流反平坦化 | `controlFlowUnflattening` | `while-switch` 状态机 → 顺序语句 |
| 字符串阵列解密 | `stringDecryptor` | 数组 + shuffle + decoder 沙盒执行 |
| 复制传播 | `copyPropagation` | `var x = y; use(x)` → `use(y)` |
| 反调试剔除 | `antiDebugRemoval` | 移除 `debugger` 语句和定时器调试陷阱 |
| 逗号表达式拆分 | `commaExpressionSplitter` | `a(), b(), c()` → 三条独立语句 |
| 死代码消除 | `deadCodeElimination` | 移除解密基础设施和无引用声明 |
| 对象属性折叠 | `objectPropertyCollapse` | 合并重复属性赋值 |
| IIFE 解包 | `iifeUnwrap` | 自动剥离最多 10 层 IIFE 嵌套 |

### 代码美化（Unminify）— 24 个 Transform

| Transform | 作用 | 示例 |
|-----------|------|------|
| `computedProperties` | 计算属性 → 点号 | `obj["foo"]` → `obj.foo` |
| `unminifyBooleans` | 布尔值还原 | `!0` → `true`、`!1` → `false` |
| `voidToUndefined` | void → undefined | `void 0` → `undefined` |
| `yoda` | Yoda 条件修正 | `"foo" === x` → `x === "foo"` |
| `removeDoubleNot` | 双重否定移除 | `!!expr` → `expr`（布尔上下文） |
| `mergeStrings` | 字符串合并 | `"a" + "b"` → `"ab"` |
| `blockStatements` | 补全花括号 | `if(x) y;` → `if(x) { y; }` |
| `splitVariableDeclarations` | 拆分声明 | `var a=1, b=2` → 两条 var |
| `infinity` | 无穷值还原 | `1/0` → `Infinity` |
| `numberExpressions` | 数值简化 | `+5` → `5`、`-0` → `0` |
| `sequence` | 序列表达式拆分 | `return a(), b` → `a(); return b;` |
| `mergeElseIf` | else if 合并 | `else { if(x) {} }` → `else if(x) {}` |
| `logicalToIf` | 逻辑 → if | `a && b()` → `if(a) b()` |
| `ternaryToIf` | 三元 → if/else | `a ? b() : c()` → if/else |
| `forToWhile` | for → while | `for(;x;) {}` → `while(x) {}` |
| `splitForLoopVars` | for 变量提取 | `for(var i=0;...)` → `var i=0; for(;...)` |
| `unaryExpressions` | 一元运算简化 | `-(-x)` → `x`、`~(~x)` → `x` |
| `invertBooleanLogic` | 布尔逻辑反转 | `!(a === b)` → `a !== b` |
| `rawLiterals` | 转义序列清理 | `\x41` → `A` |
| `jsonParse` | JSON.parse 内联 | `JSON.parse('{"a":1}')` → `{a: 1}` |
| `typeofUndefined` | typeof 简化 | `typeof undefined === "undefined"` → `true` |
| `truncateNumberLiteral` | 数值精简 | `1.0` → `1` |
| `stringLiteralCleanup` | 字符串规范化 | 统一引号、清理转义 |
| `deadCode` | 常量条件死代码 | `if("a" === "b") {...}` → 移除 |

### 现代语法还原（Transpile）— 6 个 Transform

| Transform | 作用 | 示例 |
|-----------|------|------|
| `optionalChaining` | 可选链还原 | `a && a.b && a.b.c` → `a?.b?.c` |
| `nullishCoalescing` | 空值合并 | `a != null ? a : b` → `a ?? b` |
| `nullishCoalescingAssignment` | 空值合并赋值 | `x = x ?? y` → `x ??= y` |
| `logicalAssignments` | 逻辑赋值 | `x && (x = y)` → `x &&= y` |
| `templateLiterals` | 模板字符串 | `a + " world"` → `` `${a} world` `` |
| `defaultParameters` | 默认参数还原 | `if(a === void 0) a = 1` → `function(a = 1)` |

### Bundle 解包（Unpack）

| 打包器 | 支持 | 说明 |
|--------|------|------|
| Webpack 4 | ✅ | IIFE + 模块数组格式 |
| Webpack 5 | ✅ | IIFE + `__webpack_modules__` 对象格式 |
| Browserify | ✅ | 双重 IIFE + 依赖映射格式 |

### JSX 反编译

| 模式 | 还原结果 |
|------|---------|
| `React.createElement("div", {className: "foo"}, "hello")` | `<div className="foo">hello</div>` |
| `React.createElement(Component, props)` | `<Component {...props} />` |
| `React.createElement(React.Fragment, null, a, b)` | `<>{a}{b}</>` |
| `_jsx("div", {children: "hello"})` | `<div>hello</div>` |
| `_jsxs("div", {children: [a, b]})` | `<div>{a}{b}</div>` |

### 其他功能

- **变量名压缩**（Mangle）：按作用域安全重命名为短变量名（a, b, c, ...）
- **AI 辅助优化**：按函数粒度发送 AI 做变量重命名和逻辑简化
- **污点分析**：追踪种子变量依赖链，保护不应被优化的代码路径

## 六阶段管线

```
Parse ──── 解析源码为 AST
  │         [afterParse 插件钩子]
  ▼
Prepare ── IIFE 解包 (最多 10 层) + 反调试剔除
  │         [afterPrepare 插件钩子]
  ▼
Deobfuscate ── 迭代至不动点 ──────────────────────┐
  │  常量折叠 → 对象属性折叠 → 常量对象内联         │
  │  → 对象代理内联 → 控制流反平坦化                │
  │  → 字符串解密 → 复制传播 → 死代码消除           │
  │  → 逗号表达式拆分                              │
  │  无变更? → 退出循环 ──────────────────────────┘
  │         [afterDeobfuscate 插件钩子]
  ▼
Unminify ── 24 个代码美化 Transform (单次遍历)
  │         [afterUnminify 插件钩子]
  ▼
Transpile ── 6 个现代语法还原 Transform
  │         [afterTranspile 插件钩子]
  ▼
AI Refine ── (可选) 按函数粒度 AI 优化
  │
  ▼
Unpack ──── Webpack 4/5 / Browserify 解包
  │         [afterUnpack 插件钩子]
  ▼
Generate ── IIFE 重新包裹 + 代码生成
```

## 插件系统

在管线的每个阶段边界可以插入自定义插件：

```js
const { deobfuscate } = require("./src/index");

// 定义插件
function myPlugin(api) {
  const { types: t, traverse } = api;
  return {
    name: "my-plugin",
    visitor: {
      Identifier(path) {
        // 自定义转换逻辑
      },
    },
  };
}

// 使用插件
const result = await deobfuscate(code, {
  plugins: {
    afterDeobfuscate: [myPlugin],  // 在反混淆后执行
    afterUnminify: [myPlugin],     // 在美化后执行
  },
});
```

支持的插件阶段：`afterParse`、`afterPrepare`、`afterDeobfuscate`、`afterUnminify`、`afterTranspile`、`afterUnpack`

## 编程 API

```js
const { deobfuscate } = require("./src/index");

const result = await deobfuscate(code, {
  sandboxType: "playwright",     // "playwright" | "jsdom" | "isolated-vm"
  maxIterations: 10,             // 最大迭代次数
  preserveNames: new Set(["seed"]),  // 保留的变量名
  verbose: true,                 // 详细日志
  plugins: {},                   // 各阶段插件
  aiConfig: {                    // AI 配置（可选）
    provider: "openai",
    model: "gpt-4o",
    baseURL: "https://api.openai.com/v1",
  },
});

console.log(result.code);
// result.stats: { iterations, totalChanges }
```

## 沙箱后端

字符串解密阶段需要执行混淆代码中的 decoder 函数，提供三种沙箱隔离级别：

| 后端 | 安全性 | 速度 | 适用场景 |
|------|--------|------|----------|
| Playwright | 最高（OS 进程 + 系统沙箱 + 浏览器内沙盒） | 慢 | 有反检测的代码（Turnstile） |
| isolated-vm | 高（独立 V8 Isolate） | 快 | 通用场景（需安装 `isolated-vm`） |
| JSDOM+VM | 低（同进程 VM） | 最快 | 简单场景 / 兼容后备 |

## 项目结构

```
deobf2js/
├── src/
│   ├── cli.js                        # Commander CLI 入口
│   ├── index.js                      # 库 API：deobfuscate()
│   ├── plugin.js                     # 插件系统
│   ├── transforms/
│   │   ├── framework.js              # Transform 框架 (applyTransform, mergeTransforms)
│   │   ├── iifeUnwrap.js             # IIFE 检测/解包/恢复
│   │   ├── constantFolding.js        # 常量折叠 + 死分支 + 逻辑简化
│   │   ├── constantObjectInlining.js # 常量对象属性内联
│   │   ├── objectProxyInlining.js    # 对象代理函数内联
│   │   ├── objectPropertyCollapse.js # 对象属性折叠
│   │   ├── controlFlowUnflattening.js# 控制流反平坦化
│   │   ├── stringDecryptor.js        # 字符串阵列沙盒解密
│   │   ├── copyPropagation.js        # 多遍复制传播
│   │   ├── deadCodeElimination.js    # 死代码消除
│   │   ├── antiDebugRemoval.js       # 反调试陷阱移除
│   │   ├── commaExpressionSplitter.js# 逗号表达式拆分
│   │   ├── aiRefine.js              # AI 后处理优化
│   │   ├── mangle.js               # 变量名压缩
│   │   ├── jsx.js                   # React.createElement → JSX
│   │   └── jsxNew.js               # _jsx/_jsxs → JSX
│   ├── unminify/                    # 24 个代码美化 Transform
│   │   ├── index.js                 # 合并入口
│   │   ├── computedProperties.js
│   │   ├── unminifyBooleans.js
│   │   ├── voidToUndefined.js
│   │   └── ... (共 24 个)
│   ├── transpile/                   # 6 个现代语法还原 Transform
│   │   ├── index.js                 # 合并入口
│   │   ├── optionalChaining.js
│   │   ├── nullishCoalescing.js
│   │   └── ... (共 6 个)
│   ├── unpack/                      # Bundle 解包
│   │   ├── index.js                 # 检测 + 分发
│   │   ├── bundle.js                # Bundle 类
│   │   ├── module.js                # Module 类
│   │   ├── webpack/                 # Webpack 4/5 解包
│   │   └── browserify/             # Browserify 解包
│   ├── ai/                         # AI 客户端和提示词
│   └── utils/                      # 工具函数
│       ├── sandbox.js               # 沙箱工厂 (jsdom/playwright/isolated-vm)
│       ├── isolatedVmSandbox.js     # isolated-vm 后端
│       ├── astHelpers.js            # AST 模式匹配
│       ├── taintAnalysis.js         # 污点分析
│       └── logger.js               # 统一日志
├── test/                           # Vitest 测试 (200+ tests)
├── playground/                     # Vue 3 + Vite Web Playground
└── package.json
```

## 测试

```bash
# 运行全部测试
npm test

# 监听模式
npm run test:watch

# 运行特定测试
npx vitest run test/unminify/
npx vitest run test/transpile/
npx vitest run test/unpack/
```

## AI 优化（可选）

在全部确定性 AST 变换完成后，可启用 AI 后处理。按函数粒度发送给 AI 做变量重命名、逻辑简化和死代码清理。

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx node src/cli.js input.js -o output.js --ai-provider openai

# Gemini
GEMINI_API_KEY=xxx node src/cli.js input.js -o output.js --ai-provider gemini

# Claude
ANTHROPIC_API_KEY=xxx node src/cli.js input.js -o output.js --ai-provider claude

# 自定义模型和 API 地址
OPENAI_API_KEY=xxx node src/cli.js input.js -o output.js \
  --ai-provider openai --ai-model gpt-4-turbo --ai-base-url http://localhost:11434
```

| Provider | 环境变量 | 默认模型 |
|----------|---------|---------|
| openai | `OPENAI_API_KEY` | `gpt-4o` |
| gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| claude | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` |

## 环境要求

- Node.js >= 18
- 可选：`isolated-vm`（`npm install isolated-vm`，需要编译环境）
- 可选：Playwright 浏览器（`npx playwright install chromium`）

## 许可证

AGPL-3.0
