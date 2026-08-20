import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "../support/editor";
import fs from "node:fs";
import path from "node:path";

const SW = path.resolve("dist/sw.js");

// Regression guard for the update prompt going missing on the showcase route.
// When "/" became the gallery and the editor moved to "/app", <PwaUpdateToast />
// stayed inside the editor's App — so a new version detected while the user was
// on "/" set pwaStore.updateReady and then rendered nowhere. It is mounted
// above the route split now (PwaUpdateGate), so both entry points must prompt.
//
// Runs under playwright.pwa.config.ts (builds and serves `dist/`) because the
// service worker only exists in production builds. A "new deploy" is simulated
// by changing the bytes of the served sw.js — exactly what the browser's
// update check looks for.
// Serial: both cases patch the one served dist/sw.js, so running them in
// parallel lets one restore the file while the other is still waiting for its
// update check to notice the change.
test.describe.configure({ mode: "serial" });

// Each route entry point renders different mounted content; kept as a
// standalone helper (rather than an inline if/else in the test body) per
// this project's eslint-plugin playwright convention against conditionals in
// test bodies.
async function expectRouteMounted(page: import("@playwright/test").Page, route: string) {
  if (route === "/app") {
    await expectEditorMounted(page);
  } else {
    await expect(page.getByText("Pen Editor Showcase")).toBeVisible();
  }
}

for (const route of ["/app", "/"]) {
  test(`prompts to update after a new deploy, entering at ${route}`, async ({
    page,
  }) => {
    await page.route("**/api/models", (r) =>
      r.fulfill({
        json: {
          models: [{ id: "test/smoke-model", label: "Smoke Model", supportsVision: true }],
          default: "test/smoke-model",
        },
      }),
    );
    await page.route("**/api/showcase*", (r) => r.fulfill({ json: { apps: [], nextCursor: null } }));

    await page.goto(route);
    await expectRouteMounted(page, route);

    // No clientsClaim in the workbox config, so the visit that registers the
    // worker is never itself controlled by it — wait for activation, then
    // reload. The showcase can finish loading and reload faster than the
    // registration settles, so retry until the page is actually controlled
    // instead of assuming one reload is enough.
    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return !!reg?.active && reg.active.state === "activated";
      },
      null,
      { timeout: 30_000 },
    );
    await page.reload();
    // Retry-with-reload instead of a fixed sleep between attempts:
    // expect.poll's own polling cadence replaces the manual
    // waitForTimeout(1000) loop this used to be.
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.evaluate(() => !!navigator.serviceWorker.controller);
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const original = fs.readFileSync(SW, "utf8");
    try {
      fs.writeFileSync(SW, `${original}\n// new deploy ${route}\n`);
      await page.reload();

      // The waiting worker triggers onNeedRefresh -> pwaStore -> the prompt,
      // wherever the user happens to be.
      await expect(page.getByTestId("pwa-update-toast")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("button", { name: /update/i })).toBeVisible();
    } finally {
      fs.writeFileSync(SW, original);
    }
  });
}
