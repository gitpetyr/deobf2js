# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Universal JavaScript deobfuscation framework. Pure Node.js Babel AST pipeline with plugin system, supporting deobfuscation, unminification, transpilation, bundle unpacking, JSX decompilation, and variable mangling. Licensed AGPL-3.0.

## Commands

```bash
# Install Node.js dependencies
npm install

# Run deobfuscation via CLI
node src/cli.js input.js -o output.js -v

# Run with options
node src/cli.js input.js -o output.js --sandbox jsdom --no-unminify --no-transpile

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run against test fixtures
node src/cli.js test/fixtures/sample_obfuscated.js -o /tmp/out.js -v
```

## Architecture

**Entry points:**
- `src/cli.js` — Commander-based Node.js CLI with full option support.
- `src/index.js` — Library API. Exports `deobfuscate(code, options)`.

**Six-stage pipeline** (with plugin hooks at each stage boundary):

1. **Parse** → `[afterParse]`
2. **Prepare** (IIFE unwrap + anti-debug removal) → `[afterPrepare]`
3. **Deobfuscate** (iterative fixed-point loop: constant folding, object inlining, control flow unflattening, string decryption, copy propagation, dead code elimination, comma splitting) → `[afterDeobfuscate]`
4. **Unminify** (24 code beautification transforms) → `[afterUnminify]`
5. **Transpile** (6 modern syntax restoration transforms) → `[afterTranspile]`
6. **Unpack** (Webpack 4/5, Browserify bundle extraction) → `[afterUnpack]`

Optional stages: AI refinement, JSX decompilation, variable mangling.

**Transform interface** (`src/transforms/framework.js`):
- `{ name, tags: ['safe'|'unsafe'], run?(ast, state, opts), visitor?(opts) }`
- `applyTransform(ast, transform)` / `applyTransforms(ast, transforms)` / `mergeTransforms()`

**Plugin system** (`src/plugin.js`):
- `Plugin: function(api) → { name?, pre?, post?, visitor? }`
- `runPlugins(ast, plugins)` — pre hooks → merged visitors → post hooks

**Sandbox backends** (`src/utils/sandbox.js`):
- Playwright (most secure: OS process + browser sandbox)
- isolated-vm (optional: separate V8 isolate)
- JSDOM+VM (fastest: same-process VM)

**Key directories:**
- `src/transforms/` — Core deobfuscation transforms (11 transforms)
- `src/unminify/` — 24 code beautification transforms
- `src/transpile/` — 6 modern syntax restoration transforms
- `src/unpack/` — Bundle unpacking (Webpack 4/5, Browserify)
- `src/utils/` — Shared utilities (sandbox, taint analysis, AST helpers, logger)
- `test/` — Vitest test suite (200+ tests)
- `playground/` — Vue 3 + Vite web playground (scaffold)

## Requirements

- Node.js >= 18
