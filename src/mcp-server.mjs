#!/usr/bin/env node

// src/mcp-server.mjs
// MCP server — exposes deobf2js pipeline as tools for Claude Code.
// Supports stdio (default) and HTTP transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
server.tool(
  "deobfuscate",
  "Run the full deobfuscation pipeline: string decryption, control flow unflattening, constant folding, copy propagation, dead code elimination, unminification, and transpilation.",
  {
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
  },
  async ({ code, sandboxType, maxIterations }) => {
    try {
      const options = { sandboxType, verbose: false };
      if (maxIterations) options.maxIterations = maxIterations;
      const result = await deobfuscate(code, options);
      return {
        content: [
          { type: "text", text: result.code },
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
server.tool(
  "unminify",
  "Apply 24 code beautification transforms: restore booleans, void→undefined, computed→dot properties, yoda flip, merge strings, split sequences, block statements, etc.",
  {
    code: z.string().describe("Minified JavaScript source code"),
  },
  async ({ code }) => {
    try {
      const ast = parser.parse(code, { sourceType: "script" });
      const state = applyTransform(ast, unminify);
      const output = generate(ast, {
        comments: true,
        jsescOption: { minimal: true },
      });
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
server.tool(
  "transpile",
  "Restore modern syntax: optional chaining, nullish coalescing, logical assignments, template literals, default parameters.",
  {
    code: z.string().describe("Transpiled/downleveled JavaScript source code"),
  },
  async ({ code }) => {
    try {
      const ast = parser.parse(code, { sourceType: "script" });
      const state = applyTransform(ast, transpile);
      const output = generate(ast, {
        comments: true,
        jsescOption: { minimal: true },
      });
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
server.tool(
  "unpack",
  "Detect and extract modules from Webpack 4/5 or Browserify bundles. Returns individual module source code.",
  {
    code: z.string().describe("Bundled JavaScript source code"),
  },
  async ({ code }) => {
    try {
      const ast = parser.parse(code, { sourceType: "script" });
      const bundle = unpack(ast);
      if (!bundle) {
        return {
          content: [
            {
              type: "text",
              text: "No bundle pattern detected (not Webpack or Browserify).",
            },
          ],
        };
      }
      const modules = {};
      for (const [id, mod] of bundle.modules) {
        modules[id] = generate(mod.ast, {
          comments: true,
          jsescOption: { minimal: true },
        }).code;
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
const transportArg = args.indexOf("--transport");
const transportType =
  transportArg !== -1 ? args[transportArg + 1] : process.env.MCP_TRANSPORT || "stdio";

if (transportType === "http") {
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("deobf2js MCP server (stdio) ready");
}
