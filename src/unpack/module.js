class Module {
  constructor(id, ast, path) {
    this.id = id;          // Module ID (number or string)
    this.ast = ast;        // Babel AST of the module function body
    this.code = null;      // Generated code (lazy)
    this.path = path || `module_${id}.js`; // Output path
  }
}
module.exports = { Module };
