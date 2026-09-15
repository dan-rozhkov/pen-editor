import { test, expect, type Page } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

// Live-browser coverage for dragging an element inside an embed while the
// element picker is active — EmbedLayer.tsx's pointerdown/move/up gesture,
// embedElementSortable.ts's pure slot math, embedElementStyle.ts's
// applyEmbedElementReorder, and EmbedElementHighlight.tsx's drop-indicator
// overlay. happy-dom (used by the unit tests for the same code) has no real
// layout engine, so getBoundingClientRect/getComputedStyle math like this
// can only be trusted against a real Chromium layout — hence one e2e spec
// instead of relying solely on the existing unit tests.
//
// The gesture is sortable, not free-form: dragging past the threshold moves
// the picked element among its in-flow siblings (never a coordinate), so
// this embed is three stacked blocks rather than one absolutely-positioned
// box.

const EMBED_ID = "sort-target";
// Three in-flow blocks stacked in a column, each 60px tall — 180px total,
// leaving a 20px strip at the bottom of the 200px-tall embed for
// `enterPicker`'s double-click (which must land on the canvas, not a block).
const EMBED_HTML =
  "<div style='display:flex;flex-direction:column;width:300px'>" +
  "<div id='block1' style='height:60px;background:#f00'>One</div>" +
  "<div id='block2' style='height:60px;background:#0f0'>Two</div>" +
  "<div id='block3' style='height:60px;background:#00f'>Three</div>" +
  "</div>";

async function gotoEditorWithEmbed(page: Page) {
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

  await page.evaluate(
    ({ id, html }) => {
      const w = window as unknown as {
        __sceneStore: { getState: () => { addNode: (n: unknown) => void } };
      };
      w.__sceneStore.getState().addNode({
        id,
        type: "embed",
        name: "Sort target",
        x: 500,
        y: 300,
        width: 300,
        height: 200,
        htmlContent: html,
      });
    },
    { id: EMBED_ID, html: EMBED_HTML },
  );
}

/** Enter element-picker mode the same way embed-dom-layer.spec.ts does:
 * double-click the embed on the canvas, after waiting for the culling index
 * to actually resolve a hit test there (see that spec's comment — without
 * this wait the double-click is consumed doing nothing ~50-90% of the time). */
async function enterPicker(page: Page) {
  const host = page.locator(`[data-embed-id="${EMBED_ID}"]`);
  await expect(host).toBeVisible();

  const box = await host.boundingBox();
  if (!box) throw new Error("embed host has no box");
  // Double-click in the empty strip below the three blocks (180-200px down),
  // so this only ever exercises the canvas hit test, never a picker
  // interaction with a block itself.
  const dblClickPoint = { x: box.x + box.width / 2, y: box.y + box.height - 10 };

  await page.waitForFunction(
    ({ point, embedId }) => {
      const w = window as unknown as {
        __hitTestScreenPoint?: (x: number, y: number) => string | null;
      };
      const canvas = document.querySelector("[data-canvas] canvas");
      if (!w.__hitTestScreenPoint || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return w.__hitTestScreenPoint(point.x - rect.left, point.y - rect.top) === embedId;
    },
    { point: dblClickPoint, embedId: EMBED_ID },
  );

  await host.dblclick({ force: true, position: { x: box.width / 2, y: box.height - 10 } });

  const selectElementToggle = page.getByRole("button", { name: "Exit element select" });
  await expect(selectElementToggle).toBeVisible();
  await expect(selectElementToggle).toHaveAttribute("aria-pressed", "true");

  return host;
}

/** Read the embed node's current htmlContent from the scene store. */
function readHtmlContent(page: Page): Promise<string> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __sceneStore: { getState: () => { nodesById: Record<string, { htmlContent?: string }> } };
    };
    return w.__sceneStore.getState().nodesById[id]?.htmlContent ?? "";
  }, EMBED_ID);
}

// Block centers relative to the host's top-left: no body-targeted styles
// here, so mountHtmlWithBodyStyles mounts straight into the content
// container (see EmbedLayer.tsx), and the viewport starts at 100% zoom, so
// CSS px equal screen px.
const BLOCK2_CENTER = { x: 150, y: 90 }; // block2 spans 60-120px
const BLOCK3_CENTER = { x: 150, y: 150 }; // block3 spans 120-180px

test.describe("embed element sortable drag", () => {
  test("click selects without reordering", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);
    const htmlBefore = await readHtmlContent(page);

    await host.click({ position: BLOCK2_CENTER });

    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    await expect(selectionBox).toBeVisible();
    expect(await readHtmlContent(page)).toBe(htmlBefore);
  });

  test("selection still shows a size badge under the box", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);

    await host.click({ position: BLOCK2_CENTER });

    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    const badge = page.locator("[data-embed-element-size-badge]");
    await expect(selectionBox).toBeVisible();
    await expect(badge).toHaveText("300 × 60");

    const boxRect = await selectionBox.boundingBox();
    const badgeRect = await badge.boundingBox();
    if (!boxRect || !badgeRect) throw new Error("missing box/badge rect");
    expect(badgeRect.y).toBeGreaterThan(boxRect.y + boxRect.height);
  });

  test("dragging the middle block past the last one reorders them and shows a drop indicator mid-drag", async ({
    page,
  }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);
    const htmlBefore = await readHtmlContent(page);

    const hostBox = await host.boundingBox();
    if (!hostBox) throw new Error("embed host has no box");
    const start = { x: hostBox.x + BLOCK2_CENTER.x, y: hostBox.y + BLOCK2_CENTER.y };
    const end = { x: hostBox.x + BLOCK3_CENTER.x, y: hostBox.y + hostBox.height - 5 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Several intermediate moves: the browser only synthesizes pointermove
    // events between steps, so a single jump straight to the destination
    // would never cross DRAG_THRESHOLD_PX as a distinct move and the
    // gesture would be read as a click, not a drag.
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * i) / 5,
        start.y + ((end.y - start.y) * i) / 5,
      );
    }

    await expect(page.locator("[data-embed-drop-indicator]")).toBeVisible();

    await page.mouse.up();

    await expect.poll(async () => readHtmlContent(page)).not.toBe(htmlBefore);

    const htmlAfter = await readHtmlContent(page);
    // block2 moved past block3: new order is block1, block3, block2.
    expect(htmlAfter.indexOf("block1")).toBeLessThan(htmlAfter.indexOf("block3"));
    expect(htmlAfter.indexOf("block3")).toBeLessThan(htmlAfter.indexOf("block2"));

    await expect(page.locator("[data-embed-drop-indicator]")).toHaveCount(0);

    // block2 stays selected, now showing at its new (last) position.
    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    await expect(selectionBox).toBeVisible();
    const rectAfter = await selectionBox.boundingBox();
    if (!rectAfter) throw new Error("missing selection rect after drag");
    expect(Math.abs(rectAfter.y - (hostBox.y + 120))).toBeLessThanOrEqual(3);
  });

  test("Escape cancels an in-progress drag without leaving the picker, and commits nothing", async ({
    page,
  }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);
    const htmlBefore = await readHtmlContent(page);

    const hostBox = await host.boundingBox();
    if (!hostBox) throw new Error("embed host has no box");
    const start = { x: hostBox.x + BLOCK2_CENTER.x, y: hostBox.y + BLOCK2_CENTER.y };
    const end = { x: hostBox.x + BLOCK3_CENTER.x, y: hostBox.y + hostBox.height - 5 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * i) / 5,
        start.y + ((end.y - start.y) * i) / 5,
      );
    }

    // Confirm the drag actually took hold (drop indicator visible) before
    // testing that Escape reverts it — otherwise a no-op Escape would pass
    // this assertion for the wrong reason.
    await expect(page.locator("[data-embed-drop-indicator]")).toBeVisible();

    await page.keyboard.press("Escape");

    // Release the button so no gesture is left hanging for the next test.
    await page.mouse.up();

    expect(await readHtmlContent(page)).toBe(htmlBefore);
    await expect(page.locator("[data-embed-drop-indicator]")).toHaveCount(0);

    // Still inside the picker — Escape cancelled the drag, not the picker.
    const selectElementToggle = page.getByRole("button", { name: "Exit element select" });
    await expect(selectElementToggle).toBeVisible();
    await expect(selectElementToggle).toHaveAttribute("aria-pressed", "true");

    // The element itself (its live inline style, restored by `revertDrag`)
    // is back where it started too, not just the committed htmlContent.
    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    const rectAfter = await selectionBox.boundingBox();
    if (!rectAfter) throw new Error("missing selection rect after Escape");
    expect(Math.abs(rectAfter.y - (hostBox.y + 60))).toBeLessThanOrEqual(2);
  });
});
