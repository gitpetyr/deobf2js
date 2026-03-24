# 环境变量配置 - 设计文档

## 概述

在 README.md 快速开始部分添加环境变量配置说明，包括临时设置、全局设置和 .env 文件三种方式。

## 项目环境变量清单

| 环境变量 | 用途 | 示例值 |
|---------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | `sk-xxx` |
| `GEMINI_API_KEY` | Google Gemini API 密钥 | `xxx` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 密钥 | `sk-ant-xxx` |
| `DEOBFUSCATOR_VERBOSE` | 开启详细日志 | `1` |
| `CHROMIUM_NO_SANDBOX` | Chromium 无沙箱模式（Docker 环境） | `1` |
| `MCP_TRANSPORT` | MCP Server 传输模式 | `http` / `stdio` |
| `MCP_PORT` | MCP Server HTTP 端口 | `3000` |

## 修改内容

在 README.md 快速开始部分（第 5-34 行之后）添加：

```markdown
## 环境变量配置

### 临时设置（单次命令）

```bash
# OpenAI
OPENAI_API_KEY=sk-xxx node src/cli.js input.js -o output.js

# Gemini
GEMINI_API_KEY=xxx node src/cli.js input.js -o output.js

# Claude
ANTHROPIC_API_KEY=sk-ant-xxx node src/cli.js input.js -o output.js

# 开启详细日志
DEOBFUSCATOR_VERBOSE=1 node src/cli.js input.js -o output.js
```

### 全局设置（Linux/macOS）

```bash
# 添加到 ~/.bashrc 或 ~/.zshrc
echo 'export OPENAI_API_KEY="sk-xxx"' >> ~/.bashrc
echo 'export DEOBFUSCATOR_VERBOSE=1' >> ~/.bashrc
source ~/.bashrc
```

### .env 文件方式

```bash
# 创建 .env 文件
cat > .env << EOF
OPENAI_API_KEY=sk-xxx
DEOBFUSCATOR_VERBOSE=1
EOF

# 使用 dotenv
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d '=' -f2) node src/cli.js input.js -o output.js
```

> 注意：不要将包含 API Key 的 .env 文件提交到版本控制，应添加到 .gitignore。
```

## 实现方式

直接修改 README.md 文件，在快速开始代码块之后、CLI 选项表格之前插入新小节。

## 验证方式

- README.md 语法正确
- 代码块可正常渲染
