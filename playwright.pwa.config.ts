import { defineConfig, devices } from "@playwright/test";

// PWA offline e2e (e2e/pwa/). The service worker only exists in production
// builds (vite-plugin-pwa's generateSW output + registerServiceWorker() are
// both gated on prod), so this config builds the app and serves the static
// `dist/` output via `vite preview` — unlike playwright.config.ts, which runs
// the ordinary smoke suite against the Vite dev server. Kept as a separate
// config/script (`npm run test:e2e:pwa`) so the default `npm run test:e2e`
// stays fast and doesn't require a production build.
export default defineConfig({
  testDir: "e2e/pwa",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
