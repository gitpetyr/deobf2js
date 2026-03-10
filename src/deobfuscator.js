const fs = require("fs");
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const stringDecryptor = require("./transforms/stringDecryptor");
const copyPropagation = require("./transforms/copyPropagation");
const deadCodeElimination = require("./transforms/deadCodeElimination");

const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;
function log(...args) {
  process.stderr.write("[deobfuscator] " + args.join(" ") + "\n");
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    process.stderr.write("Usage: node src/deobfuscator.js <input> [output]\n");
    process.exit(1);
  }

  // Step 1: Read input
  log("Reading input:", inputPath);
  const code = fs.readFileSync(inputPath, "utf-8");
  log("Input size:", code.length, "bytes");

  // Step 2: Parse
  log("Parsing...");
  const ast = parser.parse(code, { sourceType: "script" });
  log("Parsed successfully");

  // Step 3: String decryption
  log("Running string decryption...");
  const { consumedPaths } = stringDecryptor(ast);
  log("String decryption complete,", consumedPaths.length, "nodes consumed");

  // Step 4: Copy propagation
  log("Running copy propagation...");
  const copyChanges = copyPropagation(ast);
  log("Copy propagation complete,", copyChanges, "changes");

  // Step 5: Dead code elimination
  log("Running dead code elimination...");
  const deadRemoved = deadCodeElimination(ast, consumedPaths);
  log("Dead code elimination complete,", deadRemoved, "nodes removed");

  // Step 6: Generate output
  log("Generating output...");
  const output = generate(ast, {
    comments: true,
    jsescOption: { minimal: true },
  });

  // Step 7: Write output
  if (outputPath) {
    fs.writeFileSync(outputPath, output.code, "utf-8");
    log("Output written to:", outputPath);
  } else {
    process.stdout.write(output.code);
  }

  log("Done!");
}

main();
