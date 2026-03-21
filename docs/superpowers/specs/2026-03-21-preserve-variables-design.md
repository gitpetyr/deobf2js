# Preserve Variables (`--preserve`) Design Spec

## Problem

When deobfuscating JS, some variables act as "seeds" in string generation logic. The current pipeline inlines and resolves all variables, destroying the computation chain. Users need to trace how strings are generated from seed values, which requires preserving these variables and their downstream dependents.

## Example

```javascript
// Before deobfuscation (with --preserve seed,seed2,seed3):
a = xor(seed + seed2 * seed3, othervar + fixedVal);
b = a + 1;
// Both `a` and `b` should be preserved because they transitively depend on seeds.
```

## Solution: Static Taint Analysis

### CLI Interface

**Python CLI (`main.py`):**
```
python main.py -i input.js -o output.js --preserve seed1,seed2,seed3
```

**Node.js (`deobfuscator.js`):**
```
node src/deobfuscator.js input.js output.js --preserve seed1,seed2,seed3
```

Comma-separated variable names. Optional flag; when omitted, behavior is unchanged.

### New Module: `src/utils/taintAnalysis.js`

**Function:** `computeTaintedNames(ast, preserveNames: Set<string>) -> Set<string>`

**Algorithm:**
1. Initialize `tainted = new Set(preserveNames)` with user-specified seed names
2. Iterate over all `VariableDeclarator` and `AssignmentExpression` nodes in AST
3. For each, check if the right-hand side expression contains any `Identifier` whose name is in `tainted`
4. If yes and the left-hand side variable name is not yet in `tainted`, add it and set `changed = true`
5. Repeat until fixed point (`changed === false`)
6. Return `tainted`

**RHS check:** Recursive traversal of the expression subtree looking for `Identifier` nodes with `name in tainted`.

### Transform Modifications

#### `copyPropagation.js`
- New parameter: `taintedNames: Set<string>`
- Before inlining `var x = y` or `x = y`: if `x` is in `taintedNames`, skip (don't inline, don't remove declaration)

#### `stringDecryptor.js`
- New parameter: `taintedNames: Set<string>`
- Before replacing a decoder call: check if any argument expression references a variable in `taintedNames`
- If yes, skip replacement (preserve original call expression)

#### `deadCodeElimination.js`
- New parameter: `taintedNames: Set<string>`
- Before removing an unreferenced declaration: if variable name is in `taintedNames`, skip

### Pipeline Integration (`deobfuscator.js`)

At the start of each pipeline iteration:
```javascript
const taintedNames = preserveNames.size > 0
  ? computeTaintedNames(ast, preserveNames)
  : new Set();
```

Pass `taintedNames` to each transform call. Recomputed each iteration because AST changes between iterations.

### Argument Parsing

**main.py:** Add `--preserve` argparse argument, pass through to Node.js CLI.

**deobfuscator.js:** Parse `--preserve` from `process.argv`, split on `,`, store as `Set<string>`.

## Scope

- Only the three transforms listed above are modified
- No changes to sandbox execution, IIFE unwrapping, or AI refinement
- No configuration file; CLI-only specification
- When `--preserve` is not provided, all existing behavior is unchanged (taintedNames is empty set, all checks short-circuit)
