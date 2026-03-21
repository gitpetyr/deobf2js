import * as parser from "@babel/parser";
import generate from "@babel/generator";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

// Import browser-safe transforms
// Note: We inline the transform logic here since the main src/ uses CommonJS
// For now, implement the basic unminify transforms directly

function applyVisitor(ast, visitorFn) {
  let changes = 0;
  const state = { changes: 0 };
  const visitor = visitorFn();
  traverse.default(ast, visitor, undefined, state);
  return state.changes;
}

export async function transform(code, options = {}) {
  let totalChanges = 0;

  const ast = parser.parse(code, { sourceType: "script" });

  if (options.unminify) {
    // Apply basic unminify transforms
    totalChanges += applyBooleanRestore(ast);
    totalChanges += applyVoidToUndefined(ast);
    totalChanges += applyComputedToProperty(ast);
    totalChanges += applyYodaFix(ast);
    totalChanges += applyMergeStrings(ast);
  }

  if (options.transpile) {
    // Basic transpile placeholder
  }

  const output = generate.default(ast, {
    comments: true,
    jsescOption: { minimal: true },
  });

  return {
    code: output.code,
    totalChanges,
  };
}

// Inline basic transforms for browser
function applyBooleanRestore(ast) {
  let changes = 0;
  traverse.default(ast, {
    UnaryExpression(path) {
      if (path.node.operator === "!" && t.isNumericLiteral(path.node.argument)) {
        if (path.node.argument.value === 0) {
          path.replaceWith(t.booleanLiteral(true));
          changes++;
        } else if (path.node.argument.value === 1) {
          path.replaceWith(t.booleanLiteral(false));
          changes++;
        }
      }
    },
  });
  return changes;
}

function applyVoidToUndefined(ast) {
  let changes = 0;
  traverse.default(ast, {
    UnaryExpression(path) {
      if (path.node.operator === "void" && t.isLiteral(path.node.argument)) {
        path.replaceWith(t.identifier("undefined"));
        changes++;
      }
    },
  });
  return changes;
}

function applyComputedToProperty(ast) {
  let changes = 0;
  traverse.default(ast, {
    MemberExpression(path) {
      if (path.node.computed && t.isStringLiteral(path.node.property)) {
        const key = path.node.property.value;
        if (t.isValidIdentifier(key)) {
          path.node.computed = false;
          path.node.property = t.identifier(key);
          changes++;
        }
      }
    },
  });
  return changes;
}

function applyYodaFix(ast) {
  let changes = 0;
  traverse.default(ast, {
    BinaryExpression(path) {
      const { operator, left, right } = path.node;
      if (["===", "!==", "==", "!="].includes(operator) && t.isLiteral(left) && !t.isLiteral(right)) {
        path.node.left = right;
        path.node.right = left;
        changes++;
      }
    },
  });
  return changes;
}

function applyMergeStrings(ast) {
  let changes = 0;
  traverse.default(ast, {
    BinaryExpression: {
      exit(path) {
        if (path.node.operator === "+" && t.isStringLiteral(path.node.left) && t.isStringLiteral(path.node.right)) {
          path.replaceWith(t.stringLiteral(path.node.left.value + path.node.right.value));
          changes++;
        }
      },
    },
  });
  return changes;
}
