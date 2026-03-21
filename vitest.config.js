import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ["test/**/*.test.{js,mjs,ts}"],
    exclude: ["learning/**", "node_modules/**"],
  },
});
