import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests live in e2e/ and run against the Vite dev server.
// The backend is not required: tests stub /api/chat (and /api/models) with
// page.route, so only the frontend + the in-browser tool execution is covered.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
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
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
