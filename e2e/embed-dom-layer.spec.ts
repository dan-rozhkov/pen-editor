import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

// Smoke test for the code-layer DOM overlay (EmbedLayer). An embed node is
// added to the scene store (dev-only global), and we verify it renders as a
// Shadow-DOM host above the canvas, is non-interactive by default, and a
// single click selects it and — since the element picker now auto-starts as
// soon as an embed is the sole selection (useEmbedPickerLifecycle; there is
// no more manual "Select element" toggle) — enters element-picker mode
// (`pickingEmbedId`, not `activeEmbedId` — nothing in the UI sets
// `activeEmbedId` today).

test("embed renders as a DOM overlay and enters element-picker mode on selection", async ({
  page,
}) => {
  // The app fetches the model list at startup; stub it so the dev server
  // doesn't 404 and slow the page down.
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [{ id: "test/smoke-model", label: "Smoke Model", supportsVision: true }],
        default: "test/smoke-model",
      },
    }),
  );

  await page.goto("/app");
  await expectEditorMounted(page);

  // Add an embed node via the scene store (dev-only global).
  await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore: { getState: () => { addNode: (n: unknown) => void } };
    };
    // Placed in the clear canvas area (right of the left sidebar, below the
    // toolbar) so the double-click reaches the canvas, not a UI panel.
    w.__sceneStore.getState().addNode({
      id: "e1",
      type: "embed",
      name: "Code",
      x: 500,
      y: 300,
      width: 200,
      height: 120,
      htmlContent: "<div id='content' style='height:400px'>scroll me</div>",
    });
  });

  // The DOM host exists over the canvas with an attached shadow root.
  const host = page.locator('[data-embed-id="e1"]');
  await expect(host).toBeVisible();
  expect(await host.evaluate((el) => !!(el as HTMLElement).shadowRoot)).toBe(true);

  // Default: not interactive (pointer-events: none).
  expect(await host.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

  // A single click selects the embed, which auto-starts element-picker mode
  // (pointer-events: auto while picking, so the picker overlay can receive
  // pointer events inside the shadow DOM — this is also the only
  // externally-observable signal available here, since there is no dev
  // global for the picker store and no more toggle button to read
  // aria-pressed from).
  // The host is pointer-events:none, so the click reaches the Pixi canvas at
  // the embed's screen position, where the click handler resolves the embed
  // and selects it.
  //
  // That resolution goes through the canvas hit test, which prunes root
  // subtrees against the culling index — and pixiSync only refreshes that
  // index on its rAF-deferred flush. The host above becomes visible on
  // React's commit, which happens first, so a visible overlay does not mean
  // a click would reach the embed: measured, the index is still empty for
  // the first frame after `addNode`, the hit test returns null, and a click
  // sent too early is consumed doing nothing (this made the test fail
  // ~50-90% of the time in isolation, on both the current and the
  // pre-dependency-bump lockfile). Wait for the editor to actually resolve a
  // click at the point we are about to click, then click once.
  const box = await host.boundingBox();
  const clickPoint = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.waitForFunction((point) => {
    const w = window as unknown as {
      __hitTestScreenPoint?: (x: number, y: number) => string | null;
    };
    const canvas = document.querySelector("[data-canvas] canvas");
    if (!w.__hitTestScreenPoint || !canvas) return false;
    const rect = canvas.getBoundingClientRect();
    return w.__hitTestScreenPoint(point.x - rect.left, point.y - rect.top) === "e1";
  }, clickPoint);

  await host.click({ force: true });
  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");
});

test("embed preserves every leading style block in a showcase HTML fragment", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [{ id: "test/smoke-model", label: "Smoke Model", supportsVision: true }],
        default: "test/smoke-model",
      },
    }),
  );

  await page.goto("/app");
  await expectEditorMounted(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore: { getState: () => { addNode: (n: unknown) => void } };
    };
    w.__sceneStore.getState().addNode({
      id: "showcase-styles",
      type: "embed",
      name: "Showcase styles",
      x: 500,
      y: 300,
      width: 200,
      height: 120,
      htmlContent: `
        <style data-showcase-ua-reset>
          @layer showcase-ua-reset { button { border: 0; } }
        </style>
        <!-- Showcase generation notes separate the reset from the design CSS. -->
        <style>
          /* The cut-out is a background, not an <img>: keep it inside the screen. */
          body { margin: 0; background: rgb(244, 236, 224); }
          .hero { position: absolute; left: 24px; color: rgb(36, 28, 22); }
        </style>
        <div class="hero">Care that keeps up with them.</div>
      `,
    });
  });

  const host = page.locator('[data-embed-id="showcase-styles"]');
  await expect(host).toBeVisible();
  const styles = await host.evaluate((el) => {
    const shadow = (el as HTMLElement).shadowRoot!;
    const hero = shadow.querySelector<HTMLElement>(".hero")!;
    const body = shadow.querySelector<HTMLElement>("body")!;
    return {
      authorStylePresent: Array.from(shadow.querySelectorAll("style")).some((style) =>
        style.textContent?.includes(".hero"),
      ),
      heroLeft: getComputedStyle(hero).left,
      bodyBackground: getComputedStyle(body).backgroundColor,
    };
  });

  expect(styles).toEqual({
    authorStylePresent: true,
    heroLeft: "24px",
    bodyBackground: "rgb(244, 236, 224)",
  });
});
