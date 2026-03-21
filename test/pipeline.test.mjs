import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEOBFUSCATOR = path.join(__dirname, "..", "..", "src", "deobfuscator.js");
const FIXTURES = path.join(__dirname, "..", "fixtures");

function runDeobfuscator(inputFile) {
  const result = execSync(`node ${DEOBFUSCATOR} ${inputFile}`, {
    encoding: "utf-8",
    timeout: 60000,
    env: { ...process.env, DEOBFUSCATOR_VERBOSE: "" },
  });
  return result;
}

describe("pipeline integration", () => {
  it("processes sample_obfuscated.js without error", () => {
    const inputFile = path.join(FIXTURES, "sample_obfuscated.js");
    if (!fs.existsSync(inputFile)) return; // skip if fixture missing
    const output = runDeobfuscator(inputFile);
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(0);
  });

  it("processes sample_wrapped.js without error", () => {
    const inputFile = path.join(FIXTURES, "sample_wrapped.js");
    if (!fs.existsSync(inputFile)) return;
    const output = runDeobfuscator(inputFile);
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(0);
  });

  it("processes sample_wrapped_params.js without error", () => {
    const inputFile = path.join(FIXTURES, "sample_wrapped_params.js");
    if (!fs.existsSync(inputFile)) return;
    const output = runDeobfuscator(inputFile);
    expect(output).toBeTruthy();
  });

  it("processes sample_wrapped_bang.js without error", () => {
    const inputFile = path.join(FIXTURES, "sample_wrapped_bang.js");
    if (!fs.existsSync(inputFile)) return;
    const output = runDeobfuscator(inputFile);
    expect(output).toBeTruthy();
  });
});
