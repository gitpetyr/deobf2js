import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  // We need to handle Node.js builtins for Babel in browser
  define: {
    "process.env": {},
  },
});
