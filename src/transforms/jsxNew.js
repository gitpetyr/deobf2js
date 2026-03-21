const t = require("@babel/types");

/**
 * Check if a callee identifier name matches _jsx, _jsxs, or numbered variants.
 */
function isJsxCallee(node) {
  if (!t.isIdentifier(node)) return false;
  return /^_jsxs?\d*$/.test(node.name);
}

/**
 * Check if a tag node refers to Fragment (_Fragment or Fragment).
 */
function isFragmentTag(node) {
  return (
    t.isIdentifier(node) &&
    (node.name === "_Fragment" || node.name === "Fragment")
  );
}

/**
 * Convert a tag AST node to a JSX element name.
 */
function tagToJSXName(node) {
  if (t.isStringLiteral(node)) {
    return t.jsxIdentifier(node.value);
  }
  if (t.isIdentifier(node)) {
    return t.jsxIdentifier(node.name);
  }
  if (t.isMemberExpression(node)) {
    const object = t.isIdentifier(node.object)
      ? t.jsxIdentifier(node.object.name)
      : tagToJSXName(node.object);
    const property = t.jsxIdentifier(node.property.name);
    return t.jsxMemberExpression(object, property);
  }
  return null;
}

/**
 * Convert a child expression to a JSX child node.
 */
function convertChild(node) {
  if (t.isStringLiteral(node)) {
    return t.jsxText(node.value);
  }
  return t.jsxExpressionContainer(node);
}

/**
 * Extract children and attributes from the new JSX transform props object.
 * _jsx(tag, { children: ..., ...otherProps })
 * _jsxs(tag, { children: [...], ...otherProps })
 */
function extractPropsAndChildren(propsNode, isJsxs) {
  if (!t.isObjectExpression(propsNode)) {
    return null;
  }

  const attributes = [];
  let children = [];

  for (const prop of propsNode.properties) {
    if (t.isSpreadElement(prop)) {
      attributes.push(t.jsxSpreadAttribute(prop.argument));
      continue;
    }

    if (!t.isObjectProperty(prop)) return null;

    // Check if this is the children property
    const isChildrenProp =
      (t.isIdentifier(prop.key) && prop.key.name === "children") ||
      (t.isStringLiteral(prop.key) && prop.key.value === "children");

    if (isChildrenProp) {
      if (isJsxs && t.isArrayExpression(prop.value)) {
        children = prop.value.elements.map(convertChild);
      } else {
        children = [convertChild(prop.value)];
      }
      continue;
    }

    // Regular prop -> JSX attribute
    const key = t.isIdentifier(prop.key)
      ? t.jsxIdentifier(prop.key.name)
      : t.isStringLiteral(prop.key)
        ? t.jsxIdentifier(prop.key.value)
        : null;
    if (!key) return null;

    let value;
    if (t.isStringLiteral(prop.value)) {
      value = t.stringLiteral(prop.value.value);
    } else {
      value = t.jsxExpressionContainer(prop.value);
    }
    attributes.push(t.jsxAttribute(key, value));
  }

  return { attributes, children };
}

module.exports = {
  name: "jsxNew",
  tags: ["safe"],
  visitor() {
    return {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;

        if (!isJsxCallee(callee)) return;
        if (args.length < 2) return;

        const isJsxs = /^_jsxs\d*$/.test(callee.name);
        const tagNode = args[0];
        const propsNode = args[1];

        const result = extractPropsAndChildren(propsNode, isJsxs);
        if (!result) return;

        const { attributes, children } = result;

        // Handle Fragment
        if (isFragmentTag(tagNode)) {
          const fragment = t.jsxFragment(
            t.jsxOpeningFragment(),
            t.jsxClosingFragment(),
            children,
          );
          path.replaceWith(fragment);
          this.changes++;
          return;
        }

        const jsxName = tagToJSXName(tagNode);
        if (!jsxName) return;

        const selfClosing = children.length === 0;
        const opening = t.jsxOpeningElement(jsxName, attributes, selfClosing);
        const closing = selfClosing ? null : t.jsxClosingElement(tagToJSXName(tagNode));
        const element = t.jsxElement(opening, closing, children, selfClosing);

        path.replaceWith(element);
        this.changes++;
      },
    };
  },
};
