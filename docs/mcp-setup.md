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
cd /path/to/deobf2js && npm install
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
