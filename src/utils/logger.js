const verbose = !!process.env.DEOBFUSCATOR_VERBOSE;

/**
 * Create a logger for a named component.
 * Outputs to stderr with a component prefix when DEOBFUSCATOR_VERBOSE=1.
 *
 * @param {string} name - Component name for prefix
 * @returns {{ log: (...args: any[]) => void }}
 */
function createLogger(name) {
  return {
    log(...args) {
      if (verbose || process.env.DEOBFUSCATOR_VERBOSE) {
        process.stderr.write(`[${name}] ${args.join(" ")}\n`);
      }
    },
  };
}

module.exports = { createLogger };
