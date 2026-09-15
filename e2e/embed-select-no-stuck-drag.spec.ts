import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

// Regression test for a stuck-drag bug: clicking an embed to select it left
// the node permanently attached to the mouse cursor.
//
// Mechanism: the click's pointerdown reaches the Pixi canvas and arms
// dragController; selecting the embed synchronously auto-starts the element
// picker (useEmbedPickerLifecycle), which flips the embed's DOM host to
// pointer-events: auto. The rest of the gesture (pointermove/pointerup) is
// then delivered to that host <div> instead of the canvas, so the
// canvas-only pointerup listener in pixiInteractionCore.ts never fires and
// the drag never ends — the node keeps following the cursor afterwards.
//
// The fix arms window-level pointermove/pointerup/pointercancel listeners
// for the duration of a trusted canvas-started gesture, so the drag still
// ends even once the DOM host swallows delivery of those events.

test("selecting an embed with a real click does not leave it stuck to the cursor", async ({
  page,
}) => {
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

  // Seed an embed node via the scene store (dev-only global), placed in the
  // clear canvas area so clicks reach the canvas, not a UI panel.
  await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore: { getState: () => { addNode: (n: unknown) => void } };
    };
    w.__sceneStore.getState().addNode({
      id: "e1",
      type: "embed",
      name: "Code",
      x: 500,
      y: 300,
      width: 200,
      height: 120,
      htmlContent: "<div id='content'>content</div>",
    });
  });

  const host = page.locator('[data-embed-id="e1"]');
  await expect(host).toBeVisible();

  // The culling index that backs canvas hit-testing is only refreshed on
  // pixiSync's rAF-deferred flush, so wait for a click at the host's screen
  // position to actually resolve to the embed before clicking for real (see
  // embed-dom-layer.spec.ts for the full rationale).
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

  // A real mouse click (down + tiny move + up), the same gesture that
  // triggered the bug — not a synthetic DOM click event.
  await page.mouse.move(clickPoint.x, clickPoint.y);
  await page.mouse.down();
  await page.mouse.move(clickPoint.x + 2, clickPoint.y + 1);
  await page.mouse.up();

  // Selecting the embed auto-starts the element picker, which flips the
  // host to pointer-events: auto — the same signal embed-dom-layer.spec.ts
  // waits on, and proof the gesture reproduced the bug's precondition.
  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");

  const getNodePosition = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __sceneStore: {
          getState: () => { nodesById: Record<string, { x: number; y: number }> };
        };
      };
      const node = w.__sceneStore.getState().nodesById["e1"];
      return { x: node.x, y: node.y };
    });

  const positionAfterSelect = await getNodePosition();

  // Move the mouse a substantial distance with no button pressed. With the
  // bug present, the drag never ended, so the canvas is still tracking this
  // pointer as a drag and the embed follows the cursor.
  const steps = [
    { x: clickPoint.x + 150, y: clickPoint.y + 50 },
    { x: clickPoint.x + 300, y: clickPoint.y + 120 },
    { x: clickPoint.x + 450, y: clickPoint.y + 10 },
    { x: clickPoint.x + 600, y: clickPoint.y - 80 },
  ];
  for (const step of steps) {
    await page.mouse.move(step.x, step.y, { steps: 5 });
  }

  await expect.poll(getNodePosition).toEqual(positionAfterSelect);
});
