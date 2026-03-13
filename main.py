#!/usr/bin/env python3
"""JS Deobfuscator - Python CLI entry point."""

import argparse
import os
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(
        description="Automated JS deobfuscation tool"
    )
    parser.add_argument("-i", "--input", required=True, help="Input JS file")
    parser.add_argument("-o", "--output", required=True, help="Output JS file")
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Verbose output"
    )
    parser.add_argument(
        "--max-iterations", type=int, default=None,
        help="Max pipeline iterations (default: unlimited, stops when no changes)"
    )
    parser.add_argument(
        "--ai-provider", choices=["openai", "gemini", "claude"],
        help="AI provider for post-processing refinement"
    )
    parser.add_argument(
        "--ai-model", default=None,
        help="AI model name (default: provider-specific)"
    )
    parser.add_argument(
        "--ai-base-url", default=None,
        help="Custom API base URL (auto-appends /v1 unless URL ends with /)"
    )
    args = parser.parse_args()

    # Check node is available
    if not shutil.which("node"):
        print("Error: node is not installed or not in PATH", file=sys.stderr)
        sys.exit(1)

    # Check node_modules exists
    script_dir = os.path.dirname(os.path.abspath(__file__))
    node_modules = os.path.join(script_dir, "node_modules")
    if not os.path.isdir(node_modules):
        print(
            "Warning: node_modules not found. Run 'npm install' first.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Check input file exists
    if not os.path.isfile(args.input):
        print(f"Error: input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Build environment
    env = os.environ.copy()
    if args.verbose:
        env["DEOBFUSCATOR_VERBOSE"] = "1"

    # Run deobfuscator
    deobfuscator_js = os.path.join(script_dir, "src", "deobfuscator.js")
    cmd = ["node", deobfuscator_js, args.input, args.output]
    if args.max_iterations is not None:
        cmd += ["--max-iterations", str(args.max_iterations)]
    if args.ai_provider:
        cmd += ["--ai-provider", args.ai_provider]
    if args.ai_model:
        cmd += ["--ai-model", args.ai_model]
    if args.ai_base_url:
        cmd += ["--ai-base-url", args.ai_base_url]

    timeout = 300 if args.ai_provider else 60
    result = subprocess.run(
        cmd,
        env=env,
        # timeout=timeout,
    )

    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
