import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

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
  // Cards are image-only, so the title lives in alt text, not a caption.
  await expect(page.getByAltText("Onboarding flow")).toBeVisible();
  await expect(page.locator("[data-canvas]")).toHaveCount(0);

  // Navigating to /app still loads the editor.
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } })
  );
  await page.getByRole("link", { name: /open the editor/i }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expectEditorMounted(page);
});

// Regression: index.css locks html/body/#root to height:100% + overflow:hidden
// so the editor owns a fixed viewport. The showcase inherited that lock, so a
// grid taller than the screen was clipped with no way to reach the rest of it
// — most obvious on a phone, where the two-column grid gets tall fast. Only a
// real browser can catch this; happy-dom reports no layout.
//
// The scroll must be the DOCUMENT's, not a nested container's: on iOS Safari
// only document scroll lets the browser collapse its chrome, and a nested
// scroller pinned to height:100% leaves the strips behind the status bar and
// address bar outside the page — they then paint with the body background as
// a grey band. So this asserts both that the page scrolls and that html (not
// some inner div) is what owns that scroll.
//
// One card per RUN, so distinct runIds are what make the page tall — 12
// screens sharing a runId collapse into a single carousel and fit on screen.
test("the grid scrolls the document on a phone-sized viewport", async ({
  page,
}) => {
  const screens = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    runId: `r${i}`,
    theme: "dark",
    title: `Screen ${i}`,
    model: "test/smoke-model",
    imageUrl: "https://example.com/s.png",
    width: 390,
    height: 844,
    htmlUrl: "https://example.com/s.html",
    createdAt: "2026-07-01T00:00:00.000Z",
  }));
  await page.route("**/api/showcase**", (route) =>
    route.fulfill({ json: { screens, nextCursor: null } })
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByAltText("Screen 0")).toBeVisible();

  // The document overflows...
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.scrollingElement!;
        return el.scrollHeight > el.clientHeight;
      })
    )
    .toBe(true);

  // ...and no ancestor of <main> has taken the scroll away from it.
  expect(
    await page
      .locator("main")
      .evaluate((main) => {
        let el: HTMLElement | null = main.parentElement;
        while (el && el !== document.body) {
          if (el.scrollHeight > el.clientHeight) return el.className;
          el = el.parentElement;
        }
        return null;
      })
  ).toBeNull();

  await page.evaluate(() => window.scrollBy(0, 600));
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});
