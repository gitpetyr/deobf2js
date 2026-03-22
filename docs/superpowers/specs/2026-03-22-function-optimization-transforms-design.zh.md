# 函数优化 Transform 设计

日期：2026-03-22

## 概述

为去混淆管线新增三个 transform：通用函数内联、纯函数预执行、死函数消除。三者均通过现有 `taintedNames` 机制尊重 `--preserve` 设置。

## 1. 函数内联 (`src/transforms/functionInlining.js`)

**目的**：将函数调用替换为函数体，消除混淆器生成的包装函数层。

### 内联规则

- **调用点 <= 5**：无条件内联，不限函数体大小
- **调用点 > 5**：仅内联小函数（函数体 <= 3 条语句）
- **单 return 语句**：将调用表达式替换为 return 表达式（参数代入）
- **多语句函数**：将函数体语句插入调用点之前，调用表达式替换为最后的 return 值。仅当调用处是 ExpressionStatement 或 VariableDeclarator 时适用。

### 安全守卫

- 跳过 `taintedNames` 中的函数
- 跳过递归函数（函数体引用自身名称）
- 跳过包含 `this`、`arguments`、`yield`、`await` 的函数
- 跳过含默认参数值、剩余参数（`...args`）或解构参数（`{a, b}`）的函数
- 跳过闭包引用外部可变变量的函数（即作用域内 `binding.constant === false` 的绑定；`Math`、`console` 等全局引用不阻止内联）
- 跳过有副作用实参表达式映射到被多次引用形参的情况（避免重复执行副作用）。纯实参表达式无论大小均直接克隆。
- 内联后若函数引用计数降为零，由 deadFunctionElimination 负责删除声明
- 每个 transform 在 AST 变更后必须刷新作用域（`path.scope.crawl()`），与现有 transform 保持一致

### 与 objectProxyInlining 的关系

objectProxyInlining 处理 `obj.method()` 模式，本 transform 处理独立的 `function f(){}; f()` 模式，两者互补。

**Tags**: `['unsafe']`

## 2. 纯函数预执行 (`src/transforms/pureFunctionEvaluation.js`)

**目的**：检测纯函数 + 常量入参的调用，求值并替换为结果字面量。

### 两层求值策略

**第一层：AST 静态求值**
- 检测函数体为单 return 语句、return 表达式仅由参数和字面量构成的函数
- 将实参代入形参，得到纯字面量表达式
- 委托 `constantFolding.js` 中的 `tryEvaluate()` 和 `valueToNode()` 求值（这两个函数当前为模块私有，需重构为命名导出）
- 示例：`function add(a,b){return a+b}; add(1,2)` → 代入 → `1+2` → 折叠 → `3`
- 零风险，无需沙箱

**第二层：沙箱执行**（使用 `--sandbox` CLI 选项指定的 `sandboxType`，与 `stringDecryptor` 一致）
- 针对函数体更复杂但仍然纯净的函数（无外部变量引用、无副作用 API 调用）
- 将函数定义 + 调用表达式生成代码字符串，送入沙箱执行
- 通过 options 参数接收 `sandboxType`（如 `"playwright"`、`"jsdom"`、`"isolated-vm"`），遵循用户的 `--sandbox` 设置
- 这是一个**异步** transform：通过 `createSandboxInstance(sandboxType)` 创建自己的沙箱实例，执行后在 `finally` 块中关闭以防资源泄漏。在管线中通过 `await` 调用，与 `stringDecryptor` 类似。
- 示例：`function decode(n){var s="";for(var i=0;i<n;i++)s+=String.fromCharCode(65+i);return s} decode(3)` → 沙箱执行 → `"ABC"`

### 纯度判定

- 函数体不引用函数作用域外的任何可变变量（闭包中的自由变量）
- 不调用可能有副作用的 API（排除：DOM 操作、console、fetch、fs 等）
- 不修改参数对象的属性
- 白名单方式：允许 `Math.*`、`String.fromCharCode`、`parseInt`、`parseFloat`、`atob`、`btoa`、`decodeURIComponent`、`encodeURIComponent`、`Number()`、`Boolean()`、基本运算符和字面量方法。白名单定义为常量数组，易于扩展。

### 可替换的结果类型

- 原始值：string、number、boolean、null
- 纯对象字面量（递归检查所有值均为可序列化类型）
- 纯数组字面量（递归检查所有元素均为可序列化类型）
- RegExp（作为 `/pattern/flags` 字面量）

### 不可替换的结果类型

- Function 值（脱离原上下文后闭包绑定丢失）
- Symbol（每次创建唯一，无字面量形式）
- 含循环引用的对象

注：`undefined` 可通过 `t.identifier("undefined")` 表示，`NaN` 可用 `0/0`，`Infinity` 可用 `1/0`。但 `undefined` 作为标识符可能在混淆代码中被遮蔽，因此仅通过现有 `valueToNode()` 工具处理（它已支持 `undefined`）。`NaN` 和 `Infinity` 不替换（现有 `constantFolding` 也跳过它们）。

### 安全守卫

- 跳过 `taintedNames` 中的函数
- 跳过含 tainted 实参的调用
- 沙箱执行使用现有超时机制
- 不可序列化的结果不替换
- 执行抛异常则跳过，不替换

**Tags**: `['unsafe']`

## 3. 死函数消除 (`src/transforms/deadFunctionElimination.js`)

**目的**：删除零引用的函数声明和函数表达式赋值。

### 两种模式

**保守模式（默认）**：
- 删除零引用的 `FunctionDeclaration`（非 export 的）
- 删除零引用的 `var f = function(){}`（VariableDeclarator 且 init 为函数表达式）
- 保留程序顶层作用域中的函数（可能被外部模块调用）
- 仅删除局部作用域内（函数体内、块级作用域内）的零引用函数

**激进模式**（CLI `--aggressive-dce`）：
- 同时删除顶层零引用函数
- 适用于确知代码是自包含的场景（如混淆后的单文件 bundle）

### 迭代删除

- 删除函数 A 后，A 体内调用的函数 B 可能变为零引用
- 循环执行直到无更多可删除函数（与去混淆大循环的定点迭代配合）

### 安全守卫

- 跳过 `taintedNames` 中的函数
- 跳过被动态模式引用的函数（`Object.defineProperty`、`addEventListener`、字符串形式的函数名引用）
- 跳过作为对象属性值的函数表达式（`{method: function(){}}` — 可能通过动态属性访问调用）

### 与现有 deadCodeElimination 的关系

现有 DCE 专注删除混淆基础设施关联的代码和死赋值。本 transform 专注函数级别的零引用消除，两者互补。

**Tags**: `['unsafe']`

注：Tags 是静态元数据。由于激进模式改变行为，tag 始终为 `['unsafe']`（取最坏情况分类）。模式在运行时通过 `aggressiveDce` 选项控制，不通过 tags。

## 4. 管线集成

### 去混淆循环中的执行顺序

实际循环具有嵌套结构：`copyPropagation` 和 `deadCodeElimination` 位于 `stringDecryptor` 块内部，因为它们共享 `consumedPaths`。新 transform 的集成方式如下：

```
每轮迭代：
  1.  constantFolding               （现有）
  2.  objectPropertyCollapse         （现有）
  3.  constantObjectInlining         （现有）
  4.  objectProxyInlining            （现有）
  5.  functionInlining               ← 新增（同步，在控制流展平之前）
  6.  controlFlowUnflattening        （现有）
  7.  stringDecryptor 块 {            （现有，异步）
        await stringDecryptor.run()
        consumedPaths = s.consumedPaths
        copyPropagation.run()         （现有，使用 taintedNames）
        deadCodeElimination.run()     （现有，使用 consumedPaths + taintedNames）
      }
  8.  await pureFunctionEvaluation   ← 新增（异步，在字符串解密块之后）
  9.  deadFunctionElimination        ← 新增（同步，在所有清理之后）
  10. commaExpressionSplitter        （现有）
```

关键结构说明：
- **functionInlining** 是同步的，放在 controlFlowUnflattening 之前（位置 5）
- **pureFunctionEvaluation** 是异步的（沙箱层），放在 stringDecryptor 块**之外**（位置 8），在解密暴露新的常量参数调用之后
- **deadFunctionElimination** 是同步的，放在 pureFunctionEvaluation 之后（位置 9），**不需要** `consumedPaths` — 它只检查绑定引用计数
- stringDecryptor 块的内部嵌套（copyPropagation、deadCodeElimination 共享 consumedPaths）保持不变

### 顺序理由

- **functionInlining 靠前**：展开包装函数后暴露更多常量表达式和纯函数调用
- **pureFunctionEvaluation 在 stringDecryptor 之后**：解密后可能出现新的常量参数纯函数调用
- **deadFunctionElimination 最后**：等所有内联和传播完成后再统计引用计数

### `--preserve` 交互

三个新 transform 都接收 `taintedNames`（每轮迭代开头由 `computeTaintedNames()` 重新计算）：
- **functionInlining**：不内联 tainted 函数；不内联实参含 tainted 变量的调用
- **pureFunctionEvaluation**：不求值 tainted 函数；不求值入参含 tainted 变量的调用
- **deadFunctionElimination**：不删除 tainted 函数

### 新增 CLI 选项

- `--aggressive-dce` — 启用激进死函数消除模式
- 无需其他新选项，三个 transform 默认随去混淆流程启用

**传递路径**：`cli.js` 解析 `--aggressive-dce` → 设置 `deobfuscateOpts.aggressiveDce = true` → `deobfuscate()` 从 `options` 中解构 `aggressiveDce = false` → 通过 options 参数传递 `{ taintedNames, aggressiveDce }` 给 `deadFunctionElimination.run()`。

### 收敛性

三个新 transform 都递增 `state.changes`，参与定点迭代的收敛判断。

## 5. 测试策略

每个 transform 一个测试文件，遵循现有 `test/transforms/*.test.mjs` 约定。

### `functionInlining.test.mjs`

- 单 return 语句函数内联
- 多语句函数内联（语句插入 + return 值替换）
- 调用点 <= 5：无条件内联
- 调用点 > 5：小函数被内联 / 大函数不被内联
- 跳过递归函数
- 跳过含 `this`/`arguments`/`yield`/`await` 的函数
- 跳过闭包引用外部可变变量
- taintedNames 保护

### `pureFunctionEvaluation.test.mjs`

- AST 层：单 return + 字面量参数 → 常量结果
- 沙箱层：复杂纯函数 + 常量参数 → 执行结果
- 结果类型覆盖：number、string、boolean、null、对象、数组、RegExp
- 不可替换类型：NaN、Infinity、Function、Symbol（注：`undefined` 通过 `valueToNode()` 可替换）
- 跳过有副作用的函数
- 跳过引用外部可变变量的函数
- taintedNames 保护

### `deadFunctionElimination.test.mjs`

- 保守模式：删除局部零引用函数
- 保守模式：保留顶层零引用函数
- 激进模式：删除顶层零引用函数
- 迭代删除：A 调用 B，A 被删后 B 也被删
- 跳过对象属性上的函数
- taintedNames 保护

### 集成测试（在现有测试套件中）

- 端到端通过 `deobfuscate()`：函数内联暴露纯函数调用 → pureFunctionEvaluation 求值 → deadFunctionElimination 清理
- 收敛性：验证三个 transform 同时启用时循环能正常终止

## 6. 新建和修改的文件

### 新建文件

- `src/transforms/functionInlining.js`
- `src/transforms/pureFunctionEvaluation.js`
- `src/transforms/deadFunctionElimination.js`
- `test/transforms/functionInlining.test.mjs`
- `test/transforms/pureFunctionEvaluation.test.mjs`
- `test/transforms/deadFunctionElimination.test.mjs`

### 修改文件

- `src/index.js` — 将三个 transform 加入去混淆循环，从 options 中解构 `aggressiveDce`
- `src/cli.js` — 添加 `--aggressive-dce` 选项，传递到 `deobfuscateOpts`
- `src/transforms/constantFolding.js` — 将 `tryEvaluate` 和 `valueToNode` 导出为命名导出
