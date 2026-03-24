#!/usr/bin/env node

const { Command } = require("commander");
const fs = require("fs");
const { deobfuscate } = require("./index");

const program = new Command();

program
  .name("deobf2js")
  .description("Universal JavaScript deobfuscation tool")
  .version(require("../package.json").version)
  .argument("<input>", "Input JavaScript file path")
  .option("-o, --output <path>", "Output file path (stdout if omitted)")
  .option("-v, --verbose", "Enable verbose logging")
  .option("--sandbox <type>", "Sandbox type: jsdom or playwright", "playwright")
  .option("--max-iterations <n>", "Maximum pipeline iterations", (v) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) throw new Error("--max-iterations must be a positive integer");
    return n;
  })
  .option("--preserve <vars>", "Comma-separated seed variable names to preserve")
  .option("--ai-provider <provider>", "AI provider: openai, gemini, or claude")
  .option("--ai-model <model>", "AI model name")
  .option("--ai-base-url <url>", "AI provider base URL")
  .option("--no-deobfuscate", "Skip deobfuscation stage")
  .option("--no-unminify", "Skip unminification stage")
  .option("--no-transpile", "Skip transpilation stage")
  .option("--no-unpack", "Skip bundle unpacking stage")
  .option("--no-jsx", "Skip JSX decompilation")
  .option("--aggressive-dce", "Enable aggressive dead function elimination (removes top-level unused functions)")
  .option("-m, --mangle", "Mangle variable names")
  .option("-f, --force", "Overwrite output file if it exists")
  .action(async (input, opts) => {
    // Validate input file exists
    if (!fs.existsSync(input)) {
      process.stderr.write(`Error: Input file not found: ${input}\n`);
      process.exit(1);
    }

    // Check output file (don't overwrite without --force)
    if (opts.output && fs.existsSync(opts.output) && !opts.force) {
      process.stderr.write(`Error: Output file already exists: ${opts.output}. Use --force to overwrite.\n`);
      process.exit(1);
    }

    // Validate sandbox type
    if (opts.sandbox !== "jsdom" && opts.sandbox !== "playwright") {
      process.stderr.write("Error: --sandbox must be 'jsdom' or 'playwright'\n");
      process.exit(1);
    }

    // Build options
    const deobfuscateOpts = {
      sandboxType: opts.sandbox,
      verbose: !!opts.verbose,
    };

    if (opts.maxIterations) {
      deobfuscateOpts.maxIterations = opts.maxIterations;
    }

    if (opts.preserve) {
      deobfuscateOpts.preserveNames = new Set(
        opts.preserve.split(",").map(s => s.trim()).filter(Boolean)
      );
    }

    if (opts.aiProvider) {
      deobfuscateOpts.aiConfig = {
        provider: opts.aiProvider,
        model: opts.aiModel || undefined,
        baseURL: opts.aiBaseUrl || undefined,
      };
    }

    // Stage flags (these are --no-X options so they default to true)
    deobfuscateOpts.stages = {
      deobfuscate: opts.deobfuscate !== false,
      unminify: opts.unminify !== false,
      transpile: opts.transpile !== false,
      unpack: opts.unpack !== false,
      jsx: opts.jsx !== false,
    };

    deobfuscateOpts.mangle = !!opts.mangle;

    if (opts.aggressiveDce) {
      deobfuscateOpts.aggressiveDce = true;
    }

    // Read input
    const code = fs.readFileSync(input, "utf-8");

    // Run
    const result = await deobfuscate(code, deobfuscateOpts);

    // Write output
    if (opts.output) {
      fs.writeFileSync(opts.output, result.code, "utf-8");
      if (opts.verbose) {
        process.stderr.write(`[cli] Output written to: ${opts.output}\n`);
        process.stderr.write(`[cli] Stats: ${result.stats.iterations} iterations, ${result.stats.totalChanges} total changes\n`);
      }
    } else {
      process.stdout.write(result.code);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`[cli] Fatal error: ${err.message}\n`);
  process.exit(1);
});
