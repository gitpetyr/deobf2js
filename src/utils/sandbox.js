const { JSDOM } = require("jsdom");
const vm = require("vm");

function createSandbox() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://example.com",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  let context;
  try {
    context = dom.getInternalVMContext();
  } catch {
    // Fallback: create manual context with copied globals
    const window = dom.window;
    context = vm.createContext({
      window,
      document: window.document,
      navigator: window.navigator,
      location: window.location,
      setTimeout: window.setTimeout,
      setInterval: window.setInterval,
      clearTimeout: window.clearTimeout,
      clearInterval: window.clearInterval,
      console,
    });
  }

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

module.exports = { createSandbox, executeInSandbox, callFunctionInSandbox };
