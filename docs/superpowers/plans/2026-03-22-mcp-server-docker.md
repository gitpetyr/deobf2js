# MCP Server + Docker + GitHub Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an MCP server that exposes the deobf2js pipeline as tools for Claude Code, packaged in Docker with automated GitHub Actions builds.

**Architecture:** The MCP server (`src/mcp-server.mjs`) is an ESM entry point that imports the existing CJS library. It registers 4 tools (deobfuscate, unminify, transpile, unpack) using the `@modelcontextprotocol/server` SDK. Supports both stdio transport (primary, for Claude Code `docker run -i`) and HTTP transport (optional, via express). A multi-stage Dockerfile produces two image variants: `latest` (with Playwright/Chromium) and `slim` (JSDOM only). GitHub Actions auto-builds and pushes to GHCR on every push to main.

**Tech Stack:** @modelcontextprotocol/server, @modelcontextprotocol/node, @modelcontextprotocol/express, zod, express, Docker, GitHub Actions, GHCR

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/mcp-server.mjs` | MCP server entry point. Registers tools, selects transport based on args/env |
| `Dockerfile` | Multi-stage build: base → slim (JSDOM) → full (Playwright + Chromium) |
| `.github/workflows/docker.yml` | Build & push Docker images to GHCR on push to main |
| `docs/mcp-setup.md` | User-facing docs: how to configure Claude Code to use the MCP server |

---

### Task 1: Install MCP dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install MCP SDK and transport packages**

```bash
cd /home/liveless/workspace/deobf2js
npm install @modelcontextprotocol/server @modelcontextprotocol/node @modelcontextprotocol/express zod express
```

- [ ] **Step 2: Verify installation**

```bash
node -e "import('@modelcontextprotocol/server').then(m => console.log('McpServer:', typeof m.McpServer))"
```

Expected: `McpServer: function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add MCP server dependencies"
```

---

### Task 2: Create MCP server with stdio transport and 4 tools

**Files:**
- Create: `src/mcp-server.mjs`

- [ ] **Step 1: Create the MCP server file**

```javascript
#!/usr/bin/env node

// src/mcp-server.mjs
// MCP server entry point — ESM wrapper around CJS deobf2js library.
// Supports stdio (default) and HTTP transport.

import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Import CJS modules from the existing library
const { deobfuscate } = require("./index.js");
const { applyTransform } = require("./transforms/framework.js");
const unminify = require("./unminify/index.js");
const transpile = require("./transpile/index.js");
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const { unpack } = require("./unpack/index.js");

const server = new McpServer({
  name: "deobf2js",
  version: "1.0.0",
});

// ── Tool: deobfuscate ──
// Full pipeline: parse → prepare → deobfuscate → unminify → transpile → unpack
server.registerTool(
  "deobfuscate",
  {
    title: "Deobfuscate JavaScript",
    description:
      "Run the full deobfuscation pipeline on JavaScript code. Includes string decryption, control flow unflattening, constant folding, copy propagation, dead code elimination, unminification, and transpilation.",
    inputSchema: z.object({
      code: z.string().describe("Obfuscated JavaScript source code"),
      sandboxType: z
        .enum(["jsdom", "playwright"])
        .default("jsdom")
        .describe("Sandbox backend for eval-based decryption"),
      maxIterations: z
        .number()
        .positive()
        .optional()
        .describe("Maximum deobfuscation iterations (default: unlimited)"),
      stages: z
        .object({
          deobfuscate: z.boolean().default(true),
          unminify: z.boolean().default(true),
          transpile: z.boolean().default(true),
          unpack: z.boolean().default(true),
        })
        .optional()
        .describe("Toggle individual pipeline stages"),
    }),
  },
  async ({ code, sandboxType, maxIterations, stages }) => {
    try {
      const options = {
        sandboxType,
        verbose: false,
      };
      if (maxIterations) options.maxIterations = maxIterations;
      if (stages) {
        options.stages = stages;
      }

      const result = await deobfuscate(code, options);
      return {
        content: [
          {
            type: "text",
            text: result.code,
          },
          {
            type: "text",
            text: `\n--- Stats: ${result.stats.totalChanges} changes in ${result.stats.iterations} iteration(s) ---`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: unminify ──
// Beautify minified JavaScript (24 transforms: booleans, void, computed props, yoda, etc.)
server.registerTool(
  "unminify",
  {
    title: "Unminify JavaScript",
    description:
      "Apply 24 code beautification transforms: restore booleans, void→undefined, computed→dot properties, yoda flip, merge strings, split sequences, block statements, etc.",
    inputSchema: z.object({
      code: z.string().describe("Minified JavaScript source code"),
    }),
  },
  async ({ code }) => {
    try {
      const ast = parser.parse(code, { sourceType: "script" });
      const state = applyTransform(ast, unminify);
      const output = generate(ast, { comments: true, jsescOption: { minimal: true } });
      return {
        content: [
          { type: "text", text: output.code },
          { type: "text", text: `\n--- ${state.changes} changes ---` },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: transpile ──
// Restore modern JS syntax from transpiled/downleveled patterns
server.registerTool(
  "transpile",
  {
    title: "Transpile to Modern JavaScript",
    description:
      "Restore modern syntax: optional chaining, nullish coalescing, logical assignments, template literals, default parameters.",
    inputSchema: z.object({
      code: z.string().describe("Transpiled/downleveled JavaScript source code"),
    }),
  },
  async ({ code }) => {
    try {
      const ast = parser.parse(code, { sourceType: "script" });
      const state = applyTransform(ast, transpile);
      const output = generate(ast, { comments: true, jsescOption: { minimal: true } });
      return {
        content: [
          { type: "text", text: output.code },
          { type: "text", text: `\n--- ${state.changes} changes ---` },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: unpack ──
// Extract modules from Webpack 4/5 or Browserify bundles
server.registerTool(
  "unpack",
  {
    title: "Unpack JavaScript Bundle",
    description:
      "Detect and extract modules from Webpack 4/5 or Browserify bundles. Returns individual module source code.",
    inputSchema: z.object({
      code: z.string().describe("Bundled JavaScript source code"),
    }),
  },
  async ({ code }) => {
    try {
      const ast = parser.parse(code, { sourceType: "script" });
      const bundle = unpack(ast);
      if (!bundle) {
        return {
          content: [{ type: "text", text: "No bundle pattern detected (not Webpack or Browserify)." }],
        };
      }

      const modules = {};
      for (const [id, mod] of bundle.modules) {
        modules[id] = generate(mod.ast, { comments: true, jsescOption: { minimal: true } }).code;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                type: bundle.type,
                entryId: bundle.entryId,
                moduleCount: bundle.modules.size,
                modules,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Transport selection ──
const args = process.argv.slice(2);
const transportType =
  args.includes("--transport") ? args[args.indexOf("--transport") + 1] : process.env.MCP_TRANSPORT || "stdio";

if (transportType === "http") {
  // HTTP transport — lazy-import express and @modelcontextprotocol/node
  const { default: express } = await import("express");
  const { NodeStreamableHTTPServerTransport } = await import("@modelcontextprotocol/node");

  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Reject GET/DELETE for stateless mode
  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless mode)" },
      id: null,
    });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless mode)" },
      id: null,
    });
  });

  app.listen(port, () => {
    console.error(`deobf2js MCP server (HTTP) listening on port ${port}`);
  });
} else {
  // stdio transport (default) — used by Claude Code via `docker run -i`
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("deobf2js MCP server (stdio) ready");
}
```

- [ ] **Step 2: Test stdio transport locally**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node src/mcp-server.mjs
```

Expected: JSON response with server capabilities (tools list).

- [ ] **Step 3: Commit**

```bash
git add src/mcp-server.mjs
git commit -m "feat: add MCP server with deobfuscate/unminify/transpile/unpack tools"
```

---

### Task 3: Create Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
.git
learning
playground
test
docs
.claude
.github
*.md
!package.json
!package-lock.json
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# ── Stage 1: Base with dependencies ──
FROM node:22-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    rm -rf /root/.npm /tmp/*
COPY src/ src/

# ── slim: JSDOM sandbox only (~300MB) ──
FROM base AS slim
ENV MCP_TRANSPORT=stdio
ENTRYPOINT ["node", "src/mcp-server.mjs"]

# ── full: Playwright + Chromium (~1.5GB) ──
FROM base AS full
RUN npx playwright install --with-deps chromium && \
    rm -rf /root/.npm /tmp/*
ENV MCP_TRANSPORT=stdio
ENTRYPOINT ["node", "src/mcp-server.mjs"]
```

- [ ] **Step 3: Test Docker build (slim)**

```bash
docker build --target slim -t deobf2js-mcp:slim .
```

Expected: Successful build.

- [ ] **Step 4: Test Docker run (slim, stdio)**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | docker run -i --rm deobf2js-mcp:slim
```

Expected: JSON response with server info.

- [ ] **Step 5: Test Docker build (full)**

```bash
docker build --target full -t deobf2js-mcp:full .
```

Expected: Successful build (takes longer, installs Chromium).

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile with slim (JSDOM) and full (Playwright) targets"
```

---

### Task 4: Create GitHub Actions workflow

**Files:**
- Create: `.github/workflows/docker.yml`

- [ ] **Step 1: Create workflow directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create GitHub Actions workflow**

```yaml
# .github/workflows/docker.yml
name: Build and Push Docker Images

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'package.json'
      - 'package-lock.json'
      - 'Dockerfile'
      - '.github/workflows/docker.yml'
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}-mcp

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push slim image
        uses: docker/build-push-action@v6
        with:
          context: .
          target: slim
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:slim
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push full image
        uses: docker/build-push-action@v6
        with:
          context: .
          target: full
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:full
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docker.yml
git commit -m "ci: add GitHub Actions workflow for Docker image builds"
```

---

### Task 5: Create setup documentation

**Files:**
- Create: `docs/mcp-setup.md`

- [ ] **Step 1: Write the MCP setup guide**

```markdown
# deobf2js MCP Server Setup

## Quick Start (Docker + Claude Code)

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

### Slim image (JSDOM sandbox, ~300MB)

```json
{
  "mcpServers": {
    "deobf2js": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/gitpetyr/deobf2js-mcp:slim"]
    }
  }
}
```

### Full image (Playwright + Chromium, ~1.5GB)

```json
{
  "mcpServers": {
    "deobf2js": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/gitpetyr/deobf2js-mcp:latest"]
    }
  }
}
```

## Local (without Docker)

```bash
npm install
```

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "deobf2js": {
      "command": "node",
      "args": ["/absolute/path/to/deobf2js/src/mcp-server.mjs"]
    }
  }
}
```

## HTTP Transport

```bash
# Docker
docker run --rm -p 3000:3000 -e MCP_TRANSPORT=http ghcr.io/gitpetyr/deobf2js-mcp:slim

# Local
node src/mcp-server.mjs --transport http
```

Endpoint: `POST http://localhost:3000/mcp`

## Available Tools

| Tool | Description |
|------|-------------|
| `deobfuscate` | Full pipeline: string decryption, control flow, constant folding, unminify, transpile |
| `unminify` | 24 beautification transforms (booleans, void, computed props, yoda, etc.) |
| `transpile` | Modern syntax restoration (optional chaining, nullish coalescing, etc.) |
| `unpack` | Extract modules from Webpack 4/5 or Browserify bundles |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport: `stdio` or `http` |
| `MCP_PORT` | `3000` | HTTP listen port (only for http transport) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/mcp-setup.md
git commit -m "docs: add MCP server setup guide"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Run existing test suite to ensure no regressions**

```bash
npm test
```

Expected: All 200+ tests pass.

- [ ] **Step 2: Test MCP server stdio with a real deobfuscation call**

Send an initialize + tool call via stdio:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"unminify","arguments":{"code":"var a=!0;if(a){console[\"log\"](\"hello\")}"}}}' | node src/mcp-server.mjs
```

Expected: Response with `var a = true;\nif (a) {\n  console.log("hello");\n}`

- [ ] **Step 3: Test Docker slim build and run**

```bash
docker build --target slim -t deobf2js-mcp:slim . && \
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"unminify","arguments":{"code":"var a=!0;"}}}' | docker run -i --rm deobf2js-mcp:slim
```

Expected: Same output as local test.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during e2e testing"
```
