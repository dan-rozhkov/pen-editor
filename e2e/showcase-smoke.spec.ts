import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

// Smoke test for FIR-61 part D: "/" now serves the public showcase of
// autonomously-designed screens instead of the editor, which moved to
// "/app" (see chat-smoke.spec.ts and friends). /api/showcase is stubbed —
// no backend needed.

test("/ shows the showcase, not the editor", async ({ page }, testInfo) => {
  await page.route("**/api/showcase**", (route) =>
    route.fulfill({
      json: {
        apps: [
          {
            runId: "r1",
            theme: "dark",
            model: "test/smoke-model",
            createdAt: "2026-07-01T00:00:00.000Z",
            screens: [
              {
                id: "s1",
                title: "Onboarding flow",
                imageUrl: "https://example.com/s1.png",
                htmlUrl: "https://example.com/s1.html",
                width: 390,
                height: 844,
                createdAt: "2026-07-01T00:00:00.000Z",
              },
            ],
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

  // The `/app` navigation mounts the full WebGL/Pixi editor, which is
  // already covered on chromium. webkit-mobile (iPhone 14) exists only to
  // guard showcase layout — mounting the editor there is new, unneeded
  // surface (and a plausible flake/slowness source in CI), so this project
  // stops at the showcase-only assertions above.
  if (testInfo.project.name === "webkit-mobile") {
    return;
  }

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
  const apps = Array.from({ length: 12 }, (_, i) => ({
    runId: `r${i}`,
    theme: "dark",
    model: "test/smoke-model",
    createdAt: "2026-07-01T00:00:00.000Z",
    screens: [
      {
        id: `s${i}`,
        title: `Screen ${i}`,
        imageUrl: "https://example.com/s.png",
        width: 390,
        height: 844,
        htmlUrl: "https://example.com/s.html",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  }));
  await page.route("**/api/showcase**", (route) =>
    route.fulfill({ json: { apps, nextCursor: null } })
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
}, testInfo) => {
  // `page.mouse.wheel` has no touch-input equivalent and throws on
  // Playwright's mobile-emulated WebKit ("Mouse wheel is not supported in
  // mobile WebKit") — a Playwright/engine limitation, not a real regression.
  // The new webkit-mobile project (iPhone 14) picks up every test in this
  // file by design (see playwright.config.ts), so this one opts itself out
  // rather than the project excluding the whole spec.
  testInfo.skip(
    testInfo.project.name === "webkit-mobile",
    "mouse wheel emulation is unsupported on mobile WebKit"
  );

  const carouselApp = {
    runId: "r-carousel",
    theme: "dark",
    model: "test/smoke-model",
    createdAt: "2026-07-01T00:00:00.000Z",
    screens: Array.from({ length: 5 }, (_, i) => ({
      id: `carousel-${i}`,
      title: `Carousel screen ${i}`,
      imageUrl: "https://example.com/s.png",
      width: 390,
      height: 844,
      createdAt: "2026-07-01T00:00:00.000Z",
    })),
  };
  // Extra single-screen apps below give the page enough height to actually
  // scroll vertically on a phone-sized viewport.
  const fillerApps = Array.from({ length: 10 }, (_, i) => ({
    runId: `r-filler-${i}`,
    theme: "dark",
    model: "test/smoke-model",
    createdAt: "2026-07-01T00:00:00.000Z",
    screens: [
      {
        id: `filler-${i}`,
        title: `Filler screen ${i}`,
        imageUrl: "https://example.com/s.png",
        width: 390,
        height: 844,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  }));

  await page.route("**/api/showcase**", (route) =>
    route.fulfill({
      json: { apps: [carouselApp, ...fillerApps], nextCursor: null },
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

// Regression: ShowcaseCard used a real `border` on the card, which
// participates in border-box sizing. WebKit resolves the button/img's
// `height:100%` chain (from `size-full`) against the card's *border* box,
// while Blink resolves it against the *content* box — so the 1px border made
// WebKit's content box 2px shorter than the border box the aspect-ratio sized.
// The `object-cover object-top` image then rendered 2px taller than its box
// in WebKit only, and `overflow-hidden` clipped it off the bottom — on real
// screenshots that sliced through the app's tab bar. The fix swaps the border
// for an inset ring (`inset-ring-*`), which paints without affecting layout.
// 0.5px tolerance covers ordinary sub-pixel layout rounding; the 2px WebKit
// bug is an order of magnitude past that, so the assertion still catches it.
test("screenshot fills the card without clipping its bottom (WebKit border-box regression)", async ({
  page,
}) => {
  // A 390x844 SVG data URL — the card's real aspect ratio — so the browser
  // actually has to lay out and clip an image of the right shape; a network
  // fetch isn't needed since data: URLs never leave the page.
  const imageUrl =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#334"/></svg>`
    );

  await page.route("**/api/showcase**", (route) =>
    route.fulfill({
      json: {
        apps: [
          {
            runId: "r-clip-check",
            theme: "dark",
            model: "test/smoke-model",
            createdAt: "2026-07-01T00:00:00.000Z",
            screens: [
              {
                id: "clip-check",
                title: "Clip check screen",
                imageUrl,
                htmlUrl: "https://example.com/s.html",
                width: 390,
                height: 844,
                createdAt: "2026-07-01T00:00:00.000Z",
              },
            ],
          },
        ],
        nextCursor: null,
      },
    })
  );

  await page.goto("/");
  const img = page.getByAltText("Clip check screen");
  await expect(img).toBeVisible();

  // Wait for the image to actually finish decoding before measuring it.
  await expect
    .poll(() =>
      img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0
      )
    )
    .toBe(true);

  const overflowPx = await img.evaluate((el: HTMLImageElement) => {
    const card = el.closest<HTMLElement>('[data-slot="showcase-card"]')!;
    const cardRect = card.getBoundingClientRect();
    const cardBottom = cardRect.top + card.clientTop + card.clientHeight;
    const imgRect = el.getBoundingClientRect();
    return Math.max(
      imgRect.bottom - cardBottom,
      imgRect.height - card.clientHeight
    );
  });

  expect(overflowPx).toBeLessThanOrEqual(0.5);
});
