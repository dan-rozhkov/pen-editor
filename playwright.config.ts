import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests live in e2e/ and run against the Vite dev server.
// The backend is not required: tests stub /api/chat (and /api/models) with
// page.route, so only the frontend + the in-browser tool execution is covered.
export default defineConfig({
  testDir: "e2e",
  // e2e/pwa/ needs a production build + `vite preview` (the service worker
  // doesn't exist in dev builds) and has its own config: playwright.pwa.config.ts,
  // run via `npm run test:e2e:pwa`.
  testIgnore: "**/pwa/**",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Regression coverage for a WebKit-only border-box/content-box layout
    // divergence in the showcase (see showcase-smoke.spec.ts). Scoped to the
    // showcase spec only — pixi-large-document-performance.spec.ts enforces
    // CI-tuned frame-time budgets and the chat specs are chromium-only by
    // design, neither of which should run twice.
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 14"] },
      testMatch: /showcase-.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
