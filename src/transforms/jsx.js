const t = require("@babel/types");

/**
 * Convert a tag AST node to a JSX element name.
 * - StringLiteral -> JSXIdentifier (intrinsic element like <div>)
 * - Identifier -> JSXIdentifier (component like <Component>)
 * - MemberExpression -> JSXMemberExpression (like <Foo.Bar>)
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
 * Check if a tag node refers to React.Fragment.
 */
function isReactFragment(node) {
  return (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object, { name: "React" }) &&
    t.isIdentifier(node.property, { name: "Fragment" })
  );
}

/**
 * Convert an ObjectExpression props node to an array of JSX attributes.
 */
function propsToAttributes(propsNode) {
  if (t.isNullLiteral(propsNode) || t.isIdentifier(propsNode, { name: "undefined" })) {
    return [];
  }
  if (!t.isObjectExpression(propsNode)) {
    return null; // cannot convert
  }

  const attrs = [];
  for (const prop of propsNode.properties) {
    if (t.isSpreadElement(prop)) {
      attrs.push(t.jsxSpreadAttribute(prop.argument));
    } else if (t.isObjectProperty(prop)) {
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
      attrs.push(t.jsxAttribute(key, value));
    } else {
      return null; // unsupported property type
    }
  }
  return attrs;
}

/**
 * Convert child expressions to JSX children.
 */
function convertChild(node) {
  if (t.isStringLiteral(node)) {
    return t.jsxText(node.value);
  }
  return t.jsxExpressionContainer(node);
}

module.exports = {
  name: "jsx",
  tags: ["safe"],
  visitor() {
    return {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;

        // Match React.createElement(tag, props, ...children)
        if (
          !t.isMemberExpression(callee) ||
          !t.isIdentifier(callee.object, { name: "React" }) ||
          !t.isIdentifier(callee.property, { name: "createElement" })
        ) {
          return;
        }

        if (args.length < 1) return;

        const tagNode = args[0];
        const propsNode = args.length >= 2 ? args[1] : t.nullLiteral();
        const childrenNodes = args.slice(2);

        // Handle React.Fragment
        if (isReactFragment(tagNode)) {
          const children = childrenNodes.map(convertChild);
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

        const attributes = propsToAttributes(propsNode);
        if (attributes === null) return;

        const children = childrenNodes.map(convertChild);
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
