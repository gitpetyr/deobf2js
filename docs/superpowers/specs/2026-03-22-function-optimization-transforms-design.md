# Function Optimization Transforms Design

Date: 2026-03-22

## Overview

Three new transforms for the deobfuscation pipeline: general function inlining, pure function pre-execution, and dead function elimination. All three respect `--preserve` via the existing `taintedNames` mechanism.

## 1. Function Inlining (`src/transforms/functionInlining.js`)

**Purpose**: Replace function calls with function bodies, eliminating obfuscator-generated wrapper layers.

### Inlining Rules

- **Call sites <= 5**: Unconditionally inline regardless of function body size
- **Call sites > 5**: Only inline small functions (body <= 3 statements)
- **Single return statement**: Replace call expression with the return expression (parameter substitution)
- **Multi-statement functions**: Insert body statements before call site, replace call with last return value. Only when call site is an ExpressionStatement or VariableDeclarator.

### Safety Guards

- Skip functions in `taintedNames`
- Skip recursive functions (body references own name)
- Skip functions containing `this`, `arguments`, `yield`, `await`
- Skip functions with default parameter values, rest parameters (`...args`), or destructured parameters (`{a, b}`)
- Skip functions with closure references to external mutable variables (i.e., in-scope bindings where `binding.constant === false`; global references like `Math`, `console` do not block inlining)
- Skip cases where side-effectful argument expressions map to multiply-referenced parameters (avoids duplicating side effects). Pure argument expressions are cloned verbatim regardless of size.
- After inlining, if function reaches zero references, deadFunctionElimination handles removal
- Each transform must refresh scopes (`path.scope.crawl()`) after AST mutations, consistent with existing transforms

### Relationship to objectProxyInlining

objectProxyInlining handles `obj.method()` patterns. This transform handles standalone `function f(){}; f()` patterns. They are complementary.

**Tags**: `['unsafe']`

## 2. Pure Function Evaluation (`src/transforms/pureFunctionEvaluation.js`)

**Purpose**: Detect pure function calls with constant arguments, evaluate them, and replace with result literals.

### Two-Layer Evaluation Strategy

**Layer 1: AST Static Evaluation**
- Detect functions with single return statement where return expression consists only of parameters and literals
- Substitute actual arguments for formal parameters, producing a pure literal expression
- Delegate to `tryEvaluate()` and `valueToNode()` from `constantFolding.js` (these are currently module-private; refactor to export them as named exports alongside the transform)
- Example: `function add(a,b){return a+b}; add(1,2)` -> substitute -> `1+2` -> fold -> `3`
- Zero risk, no sandbox needed

**Layer 2: Sandbox Execution** (only when `sandboxType` is available)
- For functions with more complex bodies that are still pure (no external variable references, no side-effect API calls)
- Generate code string of function definition + call expression, send to existing sandbox
- This is an **async** transform: creates its own sandbox instance via `createSandboxInstance(sandboxType)`, executes, then closes it in a `finally` block to prevent resource leaks. Called with `await` in the pipeline, similar to `stringDecryptor`.
- Example: `function decode(n){var s="";for(var i=0;i<n;i++)s+=String.fromCharCode(65+i);return s} decode(3)` -> sandbox -> `"ABC"`

### Purity Detection

- Function body must not reference any mutable variables outside its own scope (free variables in closure)
- Must not call potentially side-effectful APIs (exclude: DOM ops, console, fetch, fs, etc.)
- Must not modify argument object properties
- Whitelist approach: allow `Math.*`, `String.fromCharCode`, `parseInt`, `parseFloat`, `atob`, `btoa`, `decodeURIComponent`, `encodeURIComponent`, `Number()`, `Boolean()`, basic operators and literal methods. The whitelist is defined as a constant array, easy to extend.

### Replaceable Result Types

- Primitive values: string, number, boolean, null
- Pure object literals (recursively check all values are serializable)
- Pure array literals (recursively check all elements are serializable)
- RegExp (as `/pattern/flags` literal)

### Non-replaceable Result Types

- Function values (closure bindings lost when detached from original context)
- Symbol (unique per creation, no literal form)
- Objects with circular references

Note: `undefined` is representable as `t.identifier("undefined")`, `NaN` as `0/0`, `Infinity` as `1/0`. However, `undefined` as an identifier can be shadowed in obfuscated code, so these are replaced only via the existing `valueToNode()` utility which already handles `undefined`. `NaN` and `Infinity` are not replaced (existing `constantFolding` also skips them).

### Safety Guards

- Skip functions in `taintedNames`
- Skip calls with tainted arguments
- Sandbox execution uses existing timeout mechanism
- Non-serializable results are not replaced
- Execution exceptions cause skip, no replacement

**Tags**: `['unsafe']`

## 3. Dead Function Elimination (`src/transforms/deadFunctionElimination.js`)

**Purpose**: Remove zero-reference function declarations and function expression assignments.

### Two Modes

**Conservative Mode (default)**:
- Remove zero-reference `FunctionDeclaration` (non-exported)
- Remove zero-reference `var f = function(){}` (VariableDeclarator with function expression init)
- Preserve functions in program top-level scope (may be called by external modules)
- Only remove functions in local scopes (inside function bodies, block scopes)

**Aggressive Mode** (CLI `--aggressive-dce`):
- Also remove top-level zero-reference functions
- Suitable for self-contained code (e.g., obfuscated single-file bundles)

### Iterative Deletion

- Removing function A may cause function B (only called by A) to reach zero references
- Loop until no more deletable functions (works with the deobfuscation fixed-point iteration)

### Safety Guards

- Skip functions in `taintedNames`
- Skip functions referenced by dynamic patterns (`Object.defineProperty`, `addEventListener`, string-form function name references)
- Skip function expressions used as object property values (`{method: function(){}}` — may be called via dynamic property access)

### Relationship to existing deadCodeElimination

Existing DCE focuses on removing obfuscation infrastructure-associated code and dead stores. This transform focuses on function-level zero-reference elimination. They are complementary.

**Tags**: `['unsafe']`

Note: Tags are static metadata. Since aggressive mode changes behavior, the tag is always `['unsafe']` (worst-case classification). The mode is controlled at runtime via the `aggressiveDce` option, not via tags.

## 4. Pipeline Integration

### Execution Order in Deobfuscation Loop

The actual loop has a nested structure: `copyPropagation` and `deadCodeElimination` live inside the `stringDecryptor` block because they share `consumedPaths`. New transforms integrate as follows:

```
Each iteration:
  1.  constantFolding               (existing)
  2.  objectPropertyCollapse         (existing)
  3.  constantObjectInlining         (existing)
  4.  objectProxyInlining            (existing)
  5.  functionInlining               <- NEW (sync, before control flow)
  6.  controlFlowUnflattening        (existing)
  7.  stringDecryptor block {         (existing, async)
        await stringDecryptor.run()
        consumedPaths = s.consumedPaths
        copyPropagation.run()         (existing, uses taintedNames)
        deadCodeElimination.run()     (existing, uses consumedPaths + taintedNames)
      }
  8.  await pureFunctionEvaluation   <- NEW (async, after string decryption block)
  9.  deadFunctionElimination        <- NEW (sync, after all cleanup)
  10. commaExpressionSplitter        (existing)
```

Key structural notes:
- **functionInlining** is sync, placed before controlFlowUnflattening (position 5)
- **pureFunctionEvaluation** is async (sandbox layer), placed **outside** the stringDecryptor block (position 8), after decryption exposes new constant-argument calls
- **deadFunctionElimination** is sync, placed after pureFunctionEvaluation (position 9), does NOT need `consumedPaths` — it only checks binding reference counts
- The stringDecryptor block's internal nesting (copyPropagation, deadCodeElimination sharing consumedPaths) is unchanged

### Order Rationale

- **functionInlining early**: Expanding wrappers exposes more constant expressions and pure function calls
- **pureFunctionEvaluation after stringDecryptor**: Decryption may reveal new constant-argument pure function calls
- **deadFunctionElimination last**: Wait for all inlining and propagation to settle before counting references

### `--preserve` Interaction

All three transforms receive `taintedNames` (recomputed each iteration by `computeTaintedNames()`):
- **functionInlining**: Do not inline tainted functions; do not inline calls where arguments contain tainted variables
- **pureFunctionEvaluation**: Do not evaluate tainted functions; do not evaluate calls with tainted arguments
- **deadFunctionElimination**: Do not remove tainted functions

### New CLI Options

- `--aggressive-dce` — Enable aggressive dead function elimination mode
- No other new options needed; all three transforms are enabled by default in the deobfuscation flow

**Plumbing path**: `cli.js` parses `--aggressive-dce` → sets `deobfuscateOpts.aggressiveDce = true` → `deobfuscate()` destructures `aggressiveDce = false` from `options` → passes `{ taintedNames, aggressiveDce }` to `deadFunctionElimination.run()` via options parameter.

### Convergence

All three transforms increment `state.changes`, participating in the fixed-point iteration convergence check.

## 5. Testing Strategy

One test file per transform, following existing `test/transforms/*.test.mjs` conventions.

### `functionInlining.test.mjs`

- Single return statement function inlining
- Multi-statement function inlining (statement insertion + return value replacement)
- Call sites <= 5: unconditional inlining
- Call sites > 5: small function inlined / large function skipped
- Skip recursive functions
- Skip functions with `this`/`arguments`/`yield`/`await`
- Skip closure references to external mutable variables
- taintedNames protection

### `pureFunctionEvaluation.test.mjs`

- AST layer: single return + literal arguments -> constant result
- Sandbox layer: complex pure function + constant arguments -> executed result
- Result type coverage: number, string, boolean, null, object, array, RegExp
- Non-replaceable types: NaN, Infinity, Function, Symbol (note: `undefined` IS replaceable via `valueToNode()`)
- Skip side-effectful functions
- Skip functions referencing external mutable variables
- taintedNames protection

### `deadFunctionElimination.test.mjs`

- Conservative mode: remove local zero-reference functions
- Conservative mode: preserve top-level zero-reference functions
- Aggressive mode: remove top-level zero-reference functions
- Iterative deletion: A calls B, A removed -> B also removed
- Skip object property functions
- taintedNames protection

### Integration Test (in existing test suite)

- End-to-end through `deobfuscate()`: function inlining exposes pure function call → pureFunctionEvaluation evaluates → deadFunctionElimination cleans up
- Convergence: verify the loop terminates with all three transforms active

### New Files

- `src/transforms/functionInlining.js`
- `src/transforms/pureFunctionEvaluation.js`
- `src/transforms/deadFunctionElimination.js`
- `test/transforms/functionInlining.test.mjs`
- `test/transforms/pureFunctionEvaluation.test.mjs`
- `test/transforms/deadFunctionElimination.test.mjs`

### Modified Files

- `src/index.js` — Add three transforms to deobfuscation loop, destructure `aggressiveDce` from options
- `src/cli.js` — Add `--aggressive-dce` option, plumb to `deobfuscateOpts`
- `src/transforms/constantFolding.js` — Export `tryEvaluate` and `valueToNode` as named exports
