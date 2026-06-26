import { test, expect } from "@playwright/test";

// Smoke test for the code-layer DOM overlay (EmbedLayer). An embed node is
// added to the scene store (dev-only global), and we verify it renders as a
// Shadow-DOM host above the canvas, is non-interactive by default, and becomes
// interactive (pointer-events: auto) after a double-click.

test("embed renders as a DOM overlay and enters interactive state", async ({ page }) => {
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

  await page.goto("/");
  await expect(page.locator("[data-canvas]")).toBeVisible();

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

  // Double-click enters interactive state → pointer-events: auto.
  // The host is pointer-events:none, so the double-click reaches the Pixi
  // canvas at the embed's screen position, where the dblclick handler resolves
  // the embed and calls setActiveEmbed.
  await host.dblclick({ force: true });
  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");
});
