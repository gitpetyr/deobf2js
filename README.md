# JS Deobfuscator

自动化 JS 反混淆工具，针对 Cloudflare Turnstile 风格的混淆代码。所有转换均在 AST 层面通过 Babel 完成，严禁使用正则处理 JS 逻辑。

## 架构

**Python CLI 入口 + Node.js AST 核心**（Babel + vm 沙箱 + JSDOM）

转换管道：

1. **字符串解密** — 检测字符串数组、洗牌 IIFE 和解码函数，在 JSDOM+VM 沙箱中执行，将所有解码调用替换为解密后的字符串字面量。
2. **拷贝传播** — 多轮迭代传播标识符别名和字面量值，直到不动点。
3. **死代码消除** — 移除已消费的解码器基础设施和零引用声明。

## 环境要求

- Python 3.6+
- Node.js >= 18

## 安装

```bash
npm install
```

## 使用

```bash
python main.py -i obfuscated.js -o clean.js

# 详细输出模式
python main.py -i obfuscated.js -o clean.js -v
```

## 示例

输入：
```javascript
var Gg = ["document", "Hello", "log", "World"];
(function (arr, num) {
  while (--num) { arr.push(arr.shift()); }
})(Gg, 4);
function Xj(a, b) { a = a - 0; var c = Gg[a]; return c; }
var a = Xj;
var b = a;
!function () { var c = b("1"); window[c]; }();
```

输出：
```javascript
!function () {
  window["document"];
}();
```

## 许可证

AGPL-3.0 — Copyright (C) 2026 Liveless
