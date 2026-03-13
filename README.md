# JS Deobfuscator

自动化 JavaScript 反混淆工具，针对 Cloudflare Turnstile 风格的混淆。基于 Babel AST 的多阶段处理管线，Python CLI + Node.js 混合架构。

## 快速开始

```bash
# 安装依赖
npm install

# 通过 Python CLI 运行
python main.py -i obfuscated.js -o clean.js -v

# 限制最多迭代 5 轮
python main.py -i obfuscated.js -o clean.js --max-iterations 5

# 或直接用 Node.js
node src/deobfuscator.js input.js output.js

# Node.js 也支持 --max-iterations
node src/deobfuscator.js input.js output.js --max-iterations 5

# 详细日志输出到 stderr
DEOBFUSCATOR_VERBOSE=1 node src/deobfuscator.js input.js output.js
```

## 处理能力

### 完全自动化

| 混淆技术 | 处理模块 | 示例 |
|----------|---------|------|
| 类型混淆 | `constantFolding` | `!![]` → `true`、`+[]` → `0`、`![]` → `false` |
| 常量表达式折叠 | `constantFolding` | `1 + 2` → `3`、`"a" + "b"` → `"ab"` |
| 死分支消除 | `constantFolding` | `if (true) { A } else { B }` → `A` |
| 逻辑表达式简化 | `constantFolding` | `true && x` → `x`、`false \|\| x` → `x` |
| 常量对象内联 | `constantObjectInlining` | `obj.W` → `1204`（支持混合对象） |
| 对象方法代理内联 | `objectProxyInlining` | `obj['fn'](a, b)` → `a !== b` |
| 控制流反平坦化 | `controlFlowUnflattening` | `while-switch` 状态机 → 顺序语句 |
| 字符串阵列解密 | `stringDecryptor` | 数组 + shuffle + decoder 沙盒执行 |
| 复制传播 | `copyPropagation` | `var x = y; use(x)` → `use(y)` |
| 反调试剔除 | `antiDebugRemoval` | 移除 `debugger` 语句和定时器调试陷阱 |
| 逗号表达式拆分 | `commaExpressionSplitter` | `a(), b(), c()` → 三条独立语句 |
| 死代码消除 | `deadCodeElimination` | 移除解密基础设施和无引用声明 |
| IIFE 解包 | `deobfuscator.js` | 自动剥离最多 10 层 IIFE 嵌套 |

### 安全边界（刻意不处理）

| 场景 | 原因 |
|------|------|
| `true \|\| sideEffect()` | 短路求值会吞掉副作用，不安全 |
| `return a(), b` 中的逗号 | 值语义不同于语句，拆分会改变行为 |
| `Function("debugger")()` | 需字符串拼接解密后才能识别，留给后续迭代 |
| 不透明谓词 `a == a*a/a` | NaN 陷阱，无法安全静态求值 |

## 处理管线

每次运行重复执行迭代，直到无变更为止：

```
                    ┌─ 预处理 ──────────────────┐
                    │  IIFE 解包 (最多 10 层)     │
                    │  反调试剔除                  │
                    └───────────────────────────┘
                                 │
                    ┌─ 迭代管线 (无变更时停止) ──┐
                    │                            │
                    │  1. 常量折叠                │
                    │     !![] → true, +[] → 0   │
                    │     死分支/逻辑简化          │
                    │                            │
                    │  2. 常量对象内联             │
                    │     obj.key → literal       │
                    │                            │
                    │  3. 对象代理内联             │
                    │     obj.fn(a,b) → a !== b   │
                    │                            │
                    │  4. 控制流反平坦化           │
                    │     while-switch → 顺序      │
                    │                            │
                    │  5. 字符串解密               │
                    │     sandbox 执行 decoder    │
                    │                            │
                    │  6. 复制传播                 │
                    │     消除变量间接引用          │
                    │                            │
                    │  7. 死代码消除               │
                    │     移除已消费节点            │
                    │                            │
                    │  8. 逗号表达式拆分           │
                    │     a(),b() → 独立语句       │
                    │                            │
                    │  无变更? → 退出循环          │
                    └───────────────────────────┘
                                 │
                    ┌─ AI 后处理（可选）────────┐
                    │  按函数粒度 AI 优化        │
                    │  变量重命名/逻辑简化/死代码  │
                    └───────────────────────────┘
                                 │
                    ┌─ 后处理 ──────────────────┐
                    │  重新包裹 IIFE              │
                    │  生成输出代码                │
                    └───────────────────────────┘
```

## 项目结构

```
js-deobfuscator/
├── main.py                              # Python CLI 入口 (argparse, 60s/300s 超时)
├── src/
│   ├── deobfuscator.js                  # Node.js 主编排器
│   ├── ai/
│   │   ├── client.js                    # 统一 AI 客户端 (OpenAI/Gemini/Claude)
│   │   ├── prompts.js                   # AI 提示词模板
│   │   └── functionExtractor.js         # 函数提取与依赖分析
│   ├── transforms/
│   │   ├── constantFolding.js           # 常量折叠 + 死分支 + 逻辑简化
│   │   ├── constantObjectInlining.js    # 常量对象属性内联
│   │   ├── objectProxyInlining.js       # 对象代理函数内联
│   │   ├── controlFlowUnflattening.js   # 控制流反平坦化
│   │   ├── stringDecryptor.js           # 字符串阵列沙盒解密
│   │   ├── copyPropagation.js           # 多遍复制传播
│   │   ├── deadCodeElimination.js       # 死代码消除
│   │   ├── antiDebugRemoval.js          # 反调试陷阱移除
│   │   ├── commaExpressionSplitter.js   # 逗号表达式拆分
│   │   └── aiRefine.js                  # AI 后处理优化
│   └── utils/
│       ├── astHelpers.js                # AST 模式匹配辅助
│       └── sandbox.js                   # JSDOM + VM 沙盒执行
└── test/fixtures/                       # 测试样本
```

## 环境要求

- Python 3.6+
- Node.js >= 18

## AI 优化（可选）

在全部 AST 机械变换完成后，可启用 AI 后处理步骤，按函数粒度发送给 AI 做变量重命名、逻辑简化和死代码清理。支持 OpenAI / Gemini / Claude 三家 API。

### 配置

设置对应 provider 的 API key 环境变量：

| Provider | 环境变量 | 默认模型 |
|----------|---------|---------|
| openai | `OPENAI_API_KEY` | `gpt-4o` |
| gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| claude | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` |

### 用法

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx python main.py -i obfuscated.js -o clean.js -v --ai-provider openai

# Gemini
GEMINI_API_KEY=xxx python main.py -i obfuscated.js -o clean.js -v --ai-provider gemini

# Claude
ANTHROPIC_API_KEY=xxx python main.py -i obfuscated.js -o clean.js -v --ai-provider claude

# 自定义模型
OPENAI_API_KEY=xxx python main.py -i obfuscated.js -o clean.js --ai-provider openai --ai-model gpt-4-turbo

# 自定义 API 地址（兼容 OpenAI 协议的第三方服务）
OPENAI_API_KEY=xxx python main.py -i obfuscated.js -o clean.js --ai-provider openai --ai-base-url http://localhost:11434

# 直接用 Node.js
OPENAI_API_KEY=sk-xxx node src/deobfuscator.js input.js output.js --ai-provider openai
```

### 说明

- AI 步骤在所有确定性 AST 变换之后执行，不影响原有管线
- 不带 `--ai-provider` 参数时行为完全不变
- 每个函数独立发送，AI 返回的代码会经过语法验证、参数数量检查和外部依赖检查
- 任何验证失败的函数会跳过，保留 AST 原版
- 启用 AI 时 Python CLI 超时从 60s 提升到 300s

## 许可证

AGPL-3.0
