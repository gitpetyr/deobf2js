const fs = require("fs");
const { deobfuscate } = require("./index");

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    process.stderr.write("Usage: node src/deobfuscator.js <input> [output] [--sandbox jsdom|playwright] [--max-iterations N] [--ai-provider openai|gemini|claude] [--ai-model MODEL] [--ai-base-url URL] [--preserve VAR1,VAR2]\n");
    process.exit(1);
  }

  // Parse CLI flags
  function getFlag(name) {
    const idx = process.argv.indexOf(name);
    return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
  }

  let maxIterations = Infinity;
  const maxIterStr = getFlag("--max-iterations");
  if (maxIterStr) {
    maxIterations = parseInt(maxIterStr, 10);
    if (!Number.isFinite(maxIterations) || maxIterations < 1) {
      process.stderr.write("Error: --max-iterations must be a positive integer\n");
      process.exit(1);
    }
  }

  let sandboxType = getFlag("--sandbox") || "playwright";
  if (sandboxType !== "jsdom" && sandboxType !== "playwright") {
    process.stderr.write("Error: --sandbox must be 'jsdom' or 'playwright'\n");
    process.exit(1);
  }

  const aiProvider = getFlag("--ai-provider");
  const aiModel = getFlag("--ai-model");
  const aiBaseURL = getFlag("--ai-base-url");

  let preserveNames = new Set();
  const preserveStr = getFlag("--preserve");
  if (preserveStr) {
    preserveNames = new Set(preserveStr.split(",").map(s => s.trim()).filter(Boolean));
  }

  const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;

  // Read input
  const code = fs.readFileSync(inputPath, "utf-8");

  // Run deobfuscation
  const result = await deobfuscate(code, {
    sandboxType,
    maxIterations,
    preserveNames,
    aiConfig: aiProvider ? { provider: aiProvider, model: aiModel, baseURL: aiBaseURL } : null,
    verbose,
  });

  // Write output
  if (outputPath) {
    fs.writeFileSync(outputPath, result.code, "utf-8");
    if (verbose) {
      process.stderr.write("[deobfuscator] Output written to: " + outputPath + "\n");
    }
  } else {
    process.stdout.write(result.code);
  }
}

main().catch((err) => {
  process.stderr.write("[deobfuscator] Fatal error: " + err.message + "\n");
  process.exit(1);
});
