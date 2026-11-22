import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    env: loadEnv(mode, process.cwd(), ""),
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
}));
