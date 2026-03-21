const generate = require("@babel/generator").default;

class Bundle {
  constructor(type, entryId, modules) {
    this.type = type;        // "webpack4" | "webpack5" | "browserify"
    this.entryId = entryId;  // Entry module ID
    this.modules = modules;  // Map<id, Module>
  }

  generateCode(moduleId) {
    const mod = this.modules.get(moduleId);
    if (!mod) return null;
    if (!mod.code) {
      mod.code = generate(mod.ast, { comments: true }).code;
    }
    return mod.code;
  }

  toJSON() {
    const mods = {};
    for (const [id, mod] of this.modules) {
      mods[id] = { path: mod.path };
    }
    return { type: this.type, entryId: this.entryId, modules: mods };
  }
}
module.exports = { Bundle };
