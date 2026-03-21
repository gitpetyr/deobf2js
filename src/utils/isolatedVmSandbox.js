let ivm;
try {
  ivm = require("isolated-vm");
} catch (e) {
  // isolated-vm is optional — fail gracefully
}

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose)
    process.stderr.write("[isolatedVmSandbox] " + args.join(" ") + "\n");
}

/**
 * Execute code in an isolated-vm sandbox.
 * @param {string} code - JavaScript code to execute
 * @param {Object} [options]
 * @param {number} [options.memoryMB=128] - Memory limit in MB
 * @param {number} [options.timeout=5000] - Execution timeout in ms
 * @returns {Promise<*>} - Result of the execution
 */
async function executeInIsolatedVm(code, options = {}) {
  if (!ivm) {
    throw new Error(
      "isolated-vm is not installed. Run: npm install isolated-vm"
    );
  }

  const { memoryMB = 128, timeout = 5000 } = options;

  const isolate = new ivm.Isolate({ memoryLimit: memoryMB });
  try {
    const context = await isolate.createContext();

    // Set up a basic global environment
    const jail = context.global;
    await jail.set("global", jail.derefInto());

    // Execute the code
    const script = await isolate.compileScript(code);
    const result = await script.run(context, { timeout });

    return result;
  } finally {
    isolate.dispose();
  }
}

/**
 * Create a persistent sandbox context for multiple executions.
 */
class IsolatedVmSandbox {
  constructor(options = {}) {
    if (!ivm) {
      throw new Error(
        "isolated-vm is not installed. Run: npm install isolated-vm"
      );
    }
    this.memoryMB = options.memoryMB || 128;
    this.timeout = options.timeout || 5000;
    this.isolate = null;
    this.context = null;
  }

  async init() {
    this.isolate = new ivm.Isolate({ memoryLimit: this.memoryMB });
    this.context = await this.isolate.createContext();
    const jail = this.context.global;
    await jail.set("global", jail.derefInto());

    // Set up basic globals that obfuscated code might expect
    await this.execute(`
      var window = global;
      var self = global;
      var navigator = {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        webdriver: false,
        languages: ["zh-CN", "zh", "en-US", "en"],
        platform: "Win32",
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 0,
        plugins: { length: 3, refresh: function() {} },
        mimeTypes: [{ type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" }],
        connection: { effectiveType: "4g", rtt: 50, downlink: 10, saveData: false }
      };
      var document = {
        createElement: function() { return { style: {} }; },
        location: { href: "https://challenges.cloudflare.com" },
        hasFocus: function() { return true; },
        visibilityState: "visible",
        hidden: false
      };
      var location = document.location;
      var chrome = {
        app: { isInstalled: false },
        runtime: { connect: function() { return {}; }, sendMessage: function() {} }
      };
      var screen = {
        width: 1920, height: 1080,
        availWidth: 1920, availHeight: 1040,
        colorDepth: 24, pixelDepth: 24
      };
      var atob = function(s) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var str = String(s).replace(/=+$/, "");
        var output = "";
        for (var bc = 0, bs, buffer, idx = 0; (buffer = str.charAt(idx++)); ) {
          bs = bc % 4 ? bs * 64 + buffer : buffer;
          buffer = chars.indexOf(buffer);
          if (buffer === -1) continue;
          bs = bc % 4 ? bs * 64 + buffer : buffer;
          if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
        }
        return output;
      };
      var btoa = function(s) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var str = String(s);
        var output = "";
        for (var block, charCode, idx = 0, map = chars;
          str.charAt(idx | 0) || (map = "=", idx % 1);
          output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))) {
          charCode = str.charCodeAt(idx += 3 / 4);
          block = block << 8 | charCode;
        }
        return output;
      };
    `);

    log("IsolatedVmSandbox initialized (memory:", this.memoryMB + "MB)");
  }

  async execute(code) {
    if (!this.context) await this.init();
    const script = await this.isolate.compileScript(code);
    return await script.run(this.context, { timeout: this.timeout });
  }

  async eval(expression) {
    return this.execute(expression);
  }

  dispose() {
    if (this.isolate) {
      this.isolate.dispose();
      this.isolate = null;
      this.context = null;
      log("IsolatedVmSandbox disposed");
    }
  }
}

/**
 * Create a unified sandbox instance (isolated-vm backend).
 * Returns { type, execute, call, close } — all async for interface compatibility
 * with createJsdomInstance() and createPlaywrightInstance().
 */
async function createIsolatedVmInstance(options = {}) {
  const sandbox = new IsolatedVmSandbox(options);
  await sandbox.init();

  return {
    type: "isolated-vm",

    async execute(code) {
      await sandbox.execute(code);
    },

    async call(fnName, args) {
      const argsStr = args.map((a) => JSON.stringify(a)).join(", ");
      const callCode = `${fnName}(${argsStr})`;
      return await sandbox.execute(callCode);
    },

    async close() {
      sandbox.dispose();
    },
  };
}

module.exports = {
  executeInIsolatedVm,
  IsolatedVmSandbox,
  createIsolatedVmInstance,
  isAvailable: !!ivm,
};
