import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

// Standalone Vitest config (separate from vite.config.ts) so tests don't pull
// in the Tailwind/React plugins or PixiJS-related build settings.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // vite-plugin-pwa's virtual module isn't available under this
      // standalone Vitest config; alias it to a test stub. See
      // src/test/virtualPwaRegister.ts.
      "virtual:pwa-register": path.resolve(__dirname, "./src/test/virtualPwaRegister.ts"),
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
    // The sanitizer now allowlists a YouTube <iframe> (see
    // sanitizeEmbedHtml.ts). happy-dom, unlike jsdom, performs a real network
    // navigation when an <iframe> with a src is attached to a live document —
    // disable that so any test (now or in the future) that mounts embed HTML
    // containing an iframe never hits the real network.
    environmentOptions: {
      happyDOM: {
        settings: { disableIframePageLoading: true },
      },
    },
    setupFiles: ["./src/test/setup.ts"],
    // Playwright e2e specs live in e2e/ and must not run under Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/__tests__/**",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        // PixiJS rendering needs WebGL — covered by e2e, not unit tests.
        "src/pixi/**",
      ],
      // Non-regression gate: floors sit ~1pp below the current measured
      // coverage so `npm run test:coverage` fails if coverage drops, without
      // flaking on minor v8 measurement variance. Ratchet these UP as
      // coverage grows; never lower them to make a red build pass.
      thresholds: {
        statements: 42,
        branches: 35,
        functions: 48,
        lines: 43,
      },
    },
  },
});
