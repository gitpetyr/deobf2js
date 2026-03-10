# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated JavaScript deobfuscation tool targeting Cloudflare Turnstile-style obfuscation. Hybrid Python CLI + Node.js Babel AST pipeline. Licensed AGPL-3.0.

## Commands

```bash
# Install Node.js dependencies
npm install

# Run deobfuscation via Python CLI
python main.py -i obfuscated.js -o clean.js [-v]

# Run deobfuscation directly via Node.js
node src/deobfuscator.js input.js output.js  # set DEOBFUSCATOR_VERBOSE=1 for verbose

# Run against test fixtures
node src/deobfuscator.js test/fixtures/sample_obfuscated.js /tmp/out.js
node src/deobfuscator.js test/fixtures/sample_wrapped.js /tmp/out.js
```

No test framework is configured — verify changes by running against `test/fixtures/` samples and checking output.

## Architecture

**Entry points:**
- `main.py` — Python CLI wrapper. Validates environment, invokes Node.js with 60s timeout.
- `src/deobfuscator.js` — Node.js orchestrator. Runs the full pipeline.

**Three-phase deobfuscation pipeline** (executed in order):

1. **String Decryption** (`src/transforms/stringDecryptor.js`) — Detects string arrays, shuffle IIFEs, and decoder functions via AST pattern matching (`src/utils/astHelpers.js`). Executes decoder functions in a JSDOM+VM sandbox (`src/utils/sandbox.js`) to resolve encrypted strings. Tracks consumed infrastructure paths for later removal.

2. **Copy Propagation** (`src/transforms/copyPropagation.js`) — Multi-pass iterative propagation of `var x = y` and `x = literal` aliases until fixed point. Eliminates variable indirection chains.

3. **Dead Code Elimination** (`src/transforms/deadCodeElimination.js`) — Removes consumed infrastructure nodes (string arrays, shufflers, decoders) and unreferenced program-level declarations.

**IIFE unwrapping** happens before the pipeline — up to 10 nested IIFE layers are stripped, inner code is processed at top level, then wrappers are restored in reverse order. Supports classic `(function(){})()`, unary `!function(){}()`, and arrow `(()=>{})()` patterns.

**Key design decisions:**
- All transforms operate on Babel AST — no regex-based string manipulation
- Sandbox uses JSDOM with Chrome 120 user agent; `getInternalVMContext()` preferred, manual global copy as fallback
- `stringDecryptor` returns `consumedPaths` which `deadCodeElimination` uses to know what to remove
- Verbose logging goes to stderr, controlled by `DEOBFUSCATOR_VERBOSE=1` env var

## Requirements

- Python 3.6+
- Node.js >= 18
