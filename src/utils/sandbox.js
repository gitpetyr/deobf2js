const { JSDOM } = require("jsdom");
const vm = require("vm");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[sandbox] " + args.join(" ") + "\n");
}

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Apply Chrome environment spoofing to a JSDOM VM context.
 */
function applyChromeSpoofing(ctx) {
  try {
    // window.chrome — the #1 headless detection signal
    ctx.chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
        RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
        getDetails: function () { return null; },
        getIsInstalled: function () { return false; },
        installState: function (cb) { if (cb) cb("not_installed"); },
      },
      csi: function () { return {}; },
      loadTimes: function () { return {}; },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
        OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
        PlatformArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
        PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
        RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
        connect: function () { return {}; },
        sendMessage: function () {},
      },
    };
  } catch (e) {}

  // navigator patches
  const nav = ctx.navigator;
  if (nav) {
    const defs = [
      ["webdriver", false],
      ["languages", ["zh-CN", "zh", "en-US", "en"]],
      ["platform", "Win32"],
      ["hardwareConcurrency", 8],
      ["deviceMemory", 8],
      ["maxTouchPoints", 0],
    ];
    for (const [prop, val] of defs) {
      try { Object.defineProperty(nav, prop, { get: () => val, configurable: true }); } catch (e) {}
    }

    // plugins — simulate Chrome defaults
    try {
      const plugins = [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format", length: 1 },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "", length: 1 },
        { name: "Native Client", filename: "internal-nacl-plugin", description: "", length: 2 },
      ];
      plugins.refresh = function () {};
      Object.defineProperty(nav, "plugins", { get: () => plugins, configurable: true });
    } catch (e) {}

    // mimeTypes
    try {
      const mimeTypes = [
        { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
      ];
      Object.defineProperty(nav, "mimeTypes", { get: () => mimeTypes, configurable: true });
    } catch (e) {}

    // connection
    try {
      Object.defineProperty(nav, "connection", {
        get: () => ({ effectiveType: "4g", rtt: 50, downlink: 10, saveData: false }),
        configurable: true,
      });
    } catch (e) {}
  }

  // window dimensions (JSDOM defaults to 0 — dead giveaway)
  const dims = {
    outerWidth: 1920, outerHeight: 1080,
    innerWidth: 1920, innerHeight: 969,
    devicePixelRatio: 1,
    screenX: 0, screenY: 0,
    screenLeft: 0, screenTop: 0,
  };
  for (const [k, v] of Object.entries(dims)) {
    try { ctx[k] = v; } catch (e) {}
  }

  // screen object
  try {
    ctx.screen = {
      width: 1920, height: 1080,
      availWidth: 1920, availHeight: 1040,
      colorDepth: 24, pixelDepth: 24,
      orientation: { type: "landscape-primary", angle: 0, onchange: null },
    };
  } catch (e) {}

  // document patches
  try {
    if (ctx.document) {
      ctx.document.hasFocus = function () { return true; };
      // visibilityState
      Object.defineProperty(ctx.document, "visibilityState", { get: () => "visible", configurable: true });
      Object.defineProperty(ctx.document, "hidden", { get: () => false, configurable: true });
    }
  } catch (e) {}

  // performance.now with realistic microsecond resolution
  try {
    const base = Date.now();
    const origPerf = ctx.performance || {};
    ctx.performance = Object.create(origPerf);
    ctx.performance.now = function () { return Date.now() - base + Math.random() * 0.1; };
  } catch (e) {}

  // Notification
  try {
    ctx.Notification = { permission: "default" };
  } catch (e) {}

  // requestAnimationFrame / cancelAnimationFrame
  try {
    if (!ctx.requestAnimationFrame) {
      ctx.requestAnimationFrame = function (cb) { return ctx.setTimeout(cb, 16); };
      ctx.cancelAnimationFrame = function (id) { ctx.clearTimeout(id); };
    }
  } catch (e) {}

  log("Chrome spoofing applied");
}

function createSandbox() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://challenges.cloudflare.com",
    userAgent: CHROME_UA,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  let context;
  try {
    context = dom.getInternalVMContext();
  } catch {
    const window = dom.window;
    context = vm.createContext({
      window, document: window.document, navigator: window.navigator,
      location: window.location,
      setTimeout: window.setTimeout, setInterval: window.setInterval,
      clearTimeout: window.clearTimeout, clearInterval: window.clearInterval,
      console,
    });
  }

  applyChromeSpoofing(context);
  return { dom, context };
}

function executeInSandbox(context, code) {
  const script = new vm.Script(code);
  return script.runInContext(context, { timeout: 5000 });
}

function callFunctionInSandbox(context, fnName, args) {
  const argsStr = args.map((a) => JSON.stringify(a)).join(", ");
  const callCode = `${fnName}(${argsStr})`;
  const script = new vm.Script(callCode);
  return script.runInContext(context, { timeout: 1000 });
}

/**
 * Create a unified sandbox instance (JSDOM backend).
 * Returns { execute, call, close } — all async for interface compatibility.
 */
function createJsdomInstance() {
  const { context } = createSandbox();
  return {
    type: "jsdom",
    async execute(code) { executeInSandbox(context, code); },
    async call(fnName, args) { return callFunctionInSandbox(context, fnName, args); },
    async close() { /* no cleanup needed */ },
  };
}

module.exports = {
  createSandbox, executeInSandbox, callFunctionInSandbox,
  createJsdomInstance,
};
