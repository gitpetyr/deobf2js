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
- Skip functions with closure references to external mutable variables (unless constant bindings)
- Skip cases where side-effectful argument expressions map to multiply-referenced parameters (avoids duplicating side effects)
- After inlining, if function reaches zero references, deadFunctionElimination handles removal

### Relationship to objectProxyInlining

objectProxyInlining handles `obj.method()` patterns. This transform handles standalone `function f(){}; f()` patterns. They are complementary.

**Tags**: `['unsafe']`

## 2. Pure Function Evaluation (`src/transforms/pureFunctionEvaluation.js`)

**Purpose**: Detect pure function calls with constant arguments, evaluate them, and replace with result literals.

### Two-Layer Evaluation Strategy

**Layer 1: AST Static Evaluation**
- Detect functions with single return statement where return expression consists only of parameters and literals
- Substitute actual arguments for formal parameters, producing a pure literal expression
- Delegate to existing `constantFolding.tryEvaluate()` for evaluation
- Example: `function add(a,b){return a+b}; add(1,2)` -> substitute -> `1+2` -> fold -> `3`
- Zero risk, no sandbox needed

**Layer 2: Sandbox Execution** (only when `sandboxType` is available)
- For functions with more complex bodies that are still pure (no external variable references, no side-effect API calls)
- Generate code string of function definition + call expression, send to existing sandbox
- Example: `function decode(n){var s="";for(var i=0;i<n;i++)s+=String.fromCharCode(65+i);return s} decode(3)` -> sandbox -> `"ABC"`

### Purity Detection

- Function body must not reference any mutable variables outside its own scope (free variables in closure)
- Must not call potentially side-effectful APIs (exclude: DOM ops, console, fetch, fs, etc.)
- Must not modify argument object properties
- Whitelist approach: allow `Math.*`, `String.fromCharCode`, `parseInt`, `parseFloat`, basic operators and literal methods

### Replaceable Result Types

- Primitive values: string, number, boolean, null
- Pure object literals (recursively check all values are serializable)
- Pure array literals (recursively check all elements are serializable)
- RegExp (as `/pattern/flags` literal)

### Non-replaceable Result Types

- undefined, NaN, Infinity (no direct literal representation)
- Function values (closure bindings lost when detached from original context)
- Symbol (unique per creation, no literal form)
- Objects with circular references

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

**Tags**: `['safe']` in conservative mode / `['unsafe']` in aggressive mode

## 4. Pipeline Integration

### Execution Order in Deobfuscation Loop

```
Each iteration:
  1.  constantFolding           (existing)
  2.  objectPropertyCollapse     (existing)
  3.  constantObjectInlining     (existing)
  4.  objectProxyInlining        (existing)
  5.  functionInlining           <- NEW
  6.  controlFlowUnflattening    (existing)
  7.  stringDecryptor            (existing)
  8.  pureFunctionEvaluation     <- NEW
  9.  copyPropagation            (existing)
  10. deadCodeElimination        (existing)
  11. deadFunctionElimination    <- NEW
  12. commaExpressionSplitter    (existing)
```

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
- Non-replaceable types: NaN, Infinity, undefined, Function, Symbol
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

## 6. Files to Create/Modify

### New Files

- `src/transforms/functionInlining.js`
- `src/transforms/pureFunctionEvaluation.js`
- `src/transforms/deadFunctionElimination.js`
- `test/transforms/functionInlining.test.mjs`
- `test/transforms/pureFunctionEvaluation.test.mjs`
- `test/transforms/deadFunctionElimination.test.mjs`

### Modified Files

- `src/index.js` — Add three transforms to deobfuscation loop
- `src/cli.js` — Add `--aggressive-dce` option
