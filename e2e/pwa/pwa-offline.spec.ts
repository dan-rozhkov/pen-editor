import { test, expect } from "@playwright/test";

// PWA offline smoke test. Unlike e2e/*.spec.ts (which run against the Vite
// dev server), the service worker only exists in production builds
// (registerServiceWorker() is gated on import.meta.env.PROD, and
// vite-plugin-pwa's generateSW output isn't emitted for dev). This spec runs
// under playwright.pwa.config.ts, whose webServer builds and serves `dist/`
// via `vite preview`. It is intentionally excluded from the default
// `npm run test:e2e` run (see testIgnore in playwright.config.ts).
//
// The workbox config here has no `clientsClaim`, so the very first page load
// that registers the service worker is never itself controlled by it (this
// is standard SW behavior, not a bug) — we wait for the worker to activate,
// then reload once, matching how a real first-time PWA visit behaves.

test("editor shell and offline banner load offline after a first online visit", async ({
  page,
  context,
}) => {
  // Stub the backend model list for the online phase only, so the test
  // doesn't depend on a running backend (mirrors e2e/chat-smoke.spec.ts).
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "test/smoke-model", label: "Smoke Model", supportsVision: true },
        ],
        default: "test/smoke-model",
      },
    }),
  );

  await page.goto("/");
  await expect(page.locator("[data-canvas]")).toBeVisible();

  // Wait for the service worker to finish installing and activating.
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg?.active && reg.active.state === "activated";
    },
    null,
    { timeout: 30_000 },
  );

  // Reload so this navigation is served by the now-active worker. A page's
  // "controller" is only assigned at navigation time if an active worker
  // already existed for the scope, which is now true.
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
    timeout: 30_000,
  });

  // Drop the stub so the offline phase doesn't quietly depend on Playwright's
  // route interception standing in for real network failure.
  await page.unroute("**/api/models");

  await context.setOffline(true);
  await page.reload();

  // The precached app shell (index.html + main/vendor chunks) loads from the
  // service worker cache, and the Pixi canvas — whose lazy chunk was already
  // fetched during the online visit — initializes normally.
  await expect(page.locator("[data-canvas]")).toBeVisible();

  // The offline-only banner communicates that AI/backend features are down.
  await expect(page.getByTestId("offline-banner")).toBeVisible();
});
