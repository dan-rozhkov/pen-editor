import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

// Standalone Vitest config (separate from vite.config.ts) so tests don't pull
// in the Tailwind/React plugins or PixiJS-related build settings.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    fs: {
      // The tool-contract test imports ../pen-editor-backend/src/ai/tools.ts
      // to compare backend schemas against the frontend registry.
      allow: [path.resolve(__dirname, "..")],
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    // Playwright e2e specs live in e2e/ and must not run under Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
