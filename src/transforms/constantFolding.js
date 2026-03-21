const traverse = require("@babel/traverse").default;
const t = require("@babel/types");
const { createLogger } = require("../utils/logger");
const { log } = createLogger("constantFolding");

/**
 * Try to statically evaluate an AST node to a primitive value.
 * Returns { value } on success, or null if not evaluable.
 */
function tryEvaluate(node) {
  // Literals
  if (t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isBooleanLiteral(node)) {
    return { value: node.value };
  }
  if (t.isNullLiteral(node)) {
    return { value: null };
  }

  // Empty array expression: [] -- used as intermediate for +[], ![]
  if (t.isArrayExpression(node) && node.elements.length === 0) {
    return { value: [] };
  }

  // Unary expressions: !, +, -, ~, typeof, void
  if (t.isUnaryExpression(node) && node.prefix) {
    const argResult = tryEvaluate(node.argument);
    if (argResult === null) return null;
    const arg = argResult.value;

    switch (node.operator) {
      case "!": return { value: !arg };
      case "+": return { value: +arg };
      case "-": return { value: -arg };
      case "~": return { value: ~arg };
      case "typeof": return { value: typeof arg };
      case "void": return { value: undefined };
      default: return null;
    }
  }

  // Binary expressions
  if (t.isBinaryExpression(node)) {
    const leftResult = tryEvaluate(node.left);
    if (leftResult === null) return null;
    const rightResult = tryEvaluate(node.right);
    if (rightResult === null) return null;
    const l = leftResult.value;
    const r = rightResult.value;

    switch (node.operator) {
      case "+": return { value: l + r };
      case "-": return { value: l - r };
      case "*": return { value: l * r };
      case "/": return { value: l / r };
      case "%": return { value: l % r };
      case "**": return { value: l ** r };
      case "|": return { value: l | r };
      case "&": return { value: l & r };
      case "^": return { value: l ^ r };
      case "<<": return { value: l << r };
      case ">>": return { value: l >> r };
      case ">>>": return { value: l >>> r };
      case "==": return { value: l == r };
      case "!=": return { value: l != r };
      case "===": return { value: l === r };
      case "!==": return { value: l !== r };
      case "<": return { value: l < r };
      case ">": return { value: l > r };
      case "<=": return { value: l <= r };
      case ">=": return { value: l >= r };
      default: return null;
    }
  }

  return null;
}

/**
 * Build a Babel AST node for a primitive value.
 */
function valueToNode(value) {
  if (typeof value === "boolean") return t.booleanLiteral(value);
  if (typeof value === "number") return t.numericLiteral(value);
  if (typeof value === "string") return t.stringLiteral(value);
  if (value === null) return t.nullLiteral();
  if (value === undefined) return t.identifier("undefined");
  return null;
}

module.exports = {
  name: "constantFolding",
  tags: ["safe"],
  run(ast, state) {
    let totalChanges = 0;
    let pass = 0;

    while (true) {
      pass++;
      let changes = 0;

      traverse(ast, {
        UnaryExpression(path) {
          const result = tryEvaluate(path.node);
          if (result === null) return;
          const { value } = result;

          // Only replace with primitives, skip NaN/Infinity/-Infinity
          if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) return;
          if (Array.isArray(value)) return;

          const replacement = valueToNode(value);
          if (!replacement) return;

          path.replaceWith(replacement);
          changes++;
        },
        BinaryExpression(path) {
          const result = tryEvaluate(path.node);
          if (result === null) return;
          const { value } = result;

          if (typeof value === "number" && (!Number.isFinite(value) || Number.isNaN(value))) return;
          if (Array.isArray(value)) return;

          const replacement = valueToNode(value);
          if (!replacement) return;

          path.replaceWith(replacement);
          changes++;
        },

        // Dead branch elimination: if(true)/if(false)
        IfStatement(path) {
          const test = path.node.test;
          if (!t.isBooleanLiteral(test)) return;

          if (test.value) {
            // if (true) { A } else { B } -> A
            path.replaceWithMultiple(
              t.isBlockStatement(path.node.consequent)
                ? path.node.consequent.body
                : [path.node.consequent]
            );
          } else {
            // if (false) { A } else { B } -> B or remove
            if (path.node.alternate) {
              path.replaceWithMultiple(
                t.isBlockStatement(path.node.alternate)
                  ? path.node.alternate.body
                  : [path.node.alternate]
              );
            } else {
              path.remove();
            }
          }
          changes++;
        },

        // Dead branch elimination: true ? A : B -> A, false ? A : B -> B
        ConditionalExpression(path) {
          const test = path.node.test;
          if (!t.isBooleanLiteral(test)) return;

          path.replaceWith(test.value ? path.node.consequent : path.node.alternate);
          changes++;
        },

        // Safe logical simplification (preserves side effects)
        LogicalExpression(path) {
          const { left, right, operator } = path.node;
          if (!t.isBooleanLiteral(left)) return;

          if (operator === "&&" && left.value === true) {
            // true && x -> x
            path.replaceWith(right);
            changes++;
          } else if (operator === "||" && left.value === false) {
            // false || x -> x
            path.replaceWith(right);
            changes++;
          }
          // Skip: true || x, false && x -- would discard x which may have side effects
        },
      });

      log("Pass", pass, ":", changes, "folds");
      totalChanges += changes;
      if (changes === 0) break;
    }

    log("Total changes:", totalChanges, "in", pass, "passes");
    state.changes += totalChanges;
  },
};
