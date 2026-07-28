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

// Regression for the native CSS scroll-snap scroller replacing Embla
// (mobbin.com/discover/apps/ios/latest structure): a horizontal gesture over
// a card must scroll and snap-center the carousel, while a vertical gesture
// over the same card must scroll the PAGE, not get hijacked by the card's
// own scroller. `overflow-y: hidden` on the `<ol>` is what buys the second
// half — this test is the one thing in the suite that can actually observe
// it, since happy-dom has no layout/scroll model at all.
test("horizontal wheel snaps the carousel; vertical wheel scrolls the page, not the card", async ({
  page,
}) => {
  const carouselScreens = Array.from({ length: 5 }, (_, i) => ({
    id: `carousel-${i}`,
    runId: "r-carousel",
    theme: "dark",
    title: `Carousel screen ${i}`,
    model: "test/smoke-model",
    imageUrl: "https://example.com/s.png",
    width: 390,
    height: 844,
    createdAt: "2026-07-01T00:00:00.000Z",
  }));
  // Extra single-screen apps below give the page enough height to actually
  // scroll vertically on a phone-sized viewport.
  const fillerScreens = Array.from({ length: 10 }, (_, i) => ({
    id: `filler-${i}`,
    runId: `r-filler-${i}`,
    theme: "dark",
    title: `Filler screen ${i}`,
    model: "test/smoke-model",
    imageUrl: "https://example.com/s.png",
    width: 390,
    height: 844,
    createdAt: "2026-07-01T00:00:00.000Z",
  }));

  await page.route("**/api/showcase**", (route) =>
    route.fulfill({
      json: { screens: [...carouselScreens, ...fillerScreens], nextCursor: null },
    })
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByAltText("Carousel screen 0")).toBeVisible();

  const scroller = page.getByRole("list", { name: "Carousel screen 0 screens" });
  await scroller.scrollIntoViewIfNeeded();

  const initialScrollLeft = await scroller.evaluate((el) => el.scrollLeft);
  const cardBox = (await page.getByAltText("Carousel screen 0").boundingBox())!;
  const cardCenterX = cardBox.x + cardBox.width / 2;
  const cardCenterY = cardBox.y + cardBox.height / 2;

  await page.mouse.move(cardCenterX, cardCenterY);
  await page.mouse.wheel(400, 0);

  await expect
    .poll(async () => scroller.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(initialScrollLeft);

  // Wait for the scroll-snap "scroll_smooth" animation to settle, then assert
  // it landed exactly on a snap position: the centred child's centre lines
  // up with the scroller's centre (within a couple of px for subpixel/scroll
  // rounding).
  let settledScrollLeft = -1;
  await expect
    .poll(async () => {
      const current = await scroller.evaluate((el) => el.scrollLeft);
      const settled = current === settledScrollLeft;
      settledScrollLeft = current;
      return settled;
    })
    .toBe(true);

  const alignment = await scroller.evaluate((el) => {
    const scrollerRect = el.getBoundingClientRect();
    const scrollerCenter = scrollerRect.left + scrollerRect.width / 2;
    let closest = Infinity;
    for (const item of el.querySelectorAll("li")) {
      const itemRect = item.getBoundingClientRect();
      const itemCenter = itemRect.left + itemRect.width / 2;
      closest = Math.min(closest, Math.abs(itemCenter - scrollerCenter));
    }
    return closest;
  });
  expect(alignment).toBeLessThanOrEqual(2);

  // Now the anti-hijack half: a vertical gesture over the same card scrolls
  // the document, and leaves the carousel's own scrollLeft untouched.
  const scrollLeftBeforeVertical = await scroller.evaluate((el) => el.scrollLeft);
  const pageScrollYBefore = await page.evaluate(() => window.scrollY);

  await page.mouse.move(cardCenterX, cardCenterY);
  await page.mouse.wheel(0, 500);

  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(pageScrollYBefore);

  expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(scrollLeftBeforeVertical);
});
