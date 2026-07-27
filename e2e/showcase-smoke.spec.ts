import { test, expect } from "@playwright/test";

// Smoke test for FIR-61 part D: "/" now serves the public showcase of
// autonomously-designed screens instead of the editor, which moved to
// "/app" (see chat-smoke.spec.ts and friends). /api/showcase is stubbed —
// no backend needed.

test("/ shows the showcase, not the editor", async ({ page }) => {
  await page.route("**/api/showcase**", (route) =>
    route.fulfill({
      json: {
        screens: [
          {
            id: "s1",
            runId: "r1",
            theme: "dark",
            title: "Onboarding flow",
            model: "test/smoke-model",
            imageUrl: "https://example.com/s1.png",
            htmlUrl: "https://example.com/s1.html",
            width: 390,
            height: 844,
            createdAt: "2026-07-01T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      },
    })
  );

  await page.goto("/");

  // The showcase renders — not the editor shell (no Pixi canvas).
  await expect(page.getByText("Onboarding flow")).toBeVisible();
  await expect(page.locator("[data-canvas]")).toHaveCount(0);

  // Navigating to /app still loads the editor.
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } })
  );
  await page.getByRole("link", { name: /open the editor/i }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("[data-canvas]")).toBeVisible();
});
