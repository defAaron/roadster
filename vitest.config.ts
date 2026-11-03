import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  // Next.js keeps "jsx": "preserve". Vitest must transform TSX before import analysis.
  oxc: { jsx: { runtime: "automatic" } },
});
