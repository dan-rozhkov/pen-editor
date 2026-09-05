import { defineConfig, devices } from "@playwright/test";

// E2E smoke tests live in e2e/ and run against the Vite dev server.
// The backend is not required: tests stub /api/chat (and /api/models) with
// page.route, so only the frontend + the in-browser tool execution is covered.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // "list" for the live console; "html" (never auto-opened — CI has no
  // browser to open it in, and locally `npx playwright show-report` is the
  // normal way to look) makes flaky/failed runs inspectable after the fact,
  // with the trace viewer for each retry attempt. "github" annotates PR
  // diffs with failures inline, CI-only (it's a no-op locally, but keeping
  // it local too would print duplicate ::error:: lines to the terminal).
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ...(process.env.CI ? [["github"] as const] : []),
  ],
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
    // Keeps the suite hermetic: vite.config.ts's zero-config MCP bridge
    // pickup (see vite/mcpDevToken.ts) would otherwise load mcpBridge.ts
    // (and its useDesignChat/toolRegistry/pixi.js import chain) on every
    // page whenever the machine running this suite happens to have a
    // ~/.pen-editor/mcp.json handshake file — e2e only stubs HTTP routes,
    // not WebSockets, so a live MCP client could drive the page mid-
    // assertion, and CI (no handshake file) would behave differently from a
    // developer machine. This forces the pickup off unconditionally, so
    // behavior no longer depends on whether a handshake file exists.
    env: { PEN_EDITOR_E2E: "1" },
  },
});
