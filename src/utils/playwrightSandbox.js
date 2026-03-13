const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  if (verbose) process.stderr.write("[playwrightSandbox] " + args.join(" ") + "\n");
}

/**
 * Create a Playwright-based sandbox instance.
 * Uses playwright-extra + stealth plugin for anti-detection.
 * Returns { execute, call, close } — all async.
 */
async function createPlaywrightInstance() {
  let chromium, StealthPlugin;
  try {
    chromium = require("playwright-extra").chromium;
    StealthPlugin = require("puppeteer-extra-plugin-stealth");
  } catch {
    throw new Error(
      "Playwright stealth not installed. Run: npm install playwright playwright-extra puppeteer-extra-plugin-stealth && npx playwright install chromium"
    );
  }

  chromium.use(StealthPlugin());

  log("Launching Chromium (stealth)...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });

  const page = await ctx.newPage();
  await page.goto("about:blank");
  log("Chromium ready (stealth active)");

  return {
    type: "playwright",

    async execute(code) {
      await page.addScriptTag({ content: code });
    },

    async call(fnName, args) {
      const argsStr = args.map((a) => JSON.stringify(a)).join(", ");
      return await page.evaluate(`${fnName}(${argsStr})`);
    },

    async close() {
      log("Closing Chromium");
      await browser.close();
    },
  };
}

module.exports = { createPlaywrightInstance };
