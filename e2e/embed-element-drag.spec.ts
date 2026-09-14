import { test, expect, type Page } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

// Live-browser coverage for dragging an element inside an embed while the
// element picker is active (EmbedLayer.tsx's pointerdown/move/up gesture,
// embedElementDrag.ts's pure math, EmbedElementHighlight.tsx's overlay).
// happy-dom (used by the unit tests for the same code) has no real layout
// engine, so getBoundingClientRect/offsetWidth/getComputedStyle math like
// this can only be trusted against a real Chromium layout — hence one e2e
// spec instead of relying solely on the existing unit tests.

const EMBED_ID = "drag-target";
// A relatively-positioned wrapper sized to the embed's own height, with one
// absolutely-positioned child at a known offset — big enough to be a
// reliable pointer target, small enough to leave room to drag it around
// inside the 300x200 embed without leaving the content box.
const EMBED_HTML =
  "<div style='position:relative;height:200px'>" +
  "<div id='box' style='position:absolute;left:20px;top:30px;width:80px;height:40px;background:#f00'></div>" +
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
        name: "Drag target",
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
  // Double-click well below the #box element (which sits in the top-left
  // quadrant), so this only ever exercises the canvas hit test, never a
  // picker interaction with the child element itself.
  const dblClickPoint = { x: box.x + box.width / 2, y: box.y + box.height - 20 };

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

  await host.dblclick({ force: true, position: { x: box.width / 2, y: box.height - 20 } });

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

/** Read `#box`'s committed `left`/`top`, in px, out of a serialized
 * `htmlContent` string. Goes through a real (offscreen, unattached) element
 * and its CSSOM `style.left`/`style.top` getters rather than regexing the
 * markup directly — Blink's own style-attribute serializer rewrites
 * `position: absolute; left: Xpx; top: Ypx` into the `inset: Ypx auto auto
 * Xpx` shorthand when it serializes an element's `style` attribute back to
 * a string, so the literal substrings "left:"/"top:" only sometimes survive
 * into `htmlContent`. `style.left`/`style.top` resolve correctly either way
 * (CSSOM expands `inset` back into its longhands), so this is both more
 * robust than a regex and exercises the same lookup the real properties
 * panel (`embedElementStyle.ts`) relies on. */
function readBoxOffsets(page: Page, html: string): Promise<{ left: number; top: number }> {
  return page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, "text/html");
    const box = doc.getElementById("box");
    if (!box) throw new Error("#box not found in htmlContent");
    return {
      left: Number.parseFloat(box.style.left),
      top: Number.parseFloat(box.style.top),
    };
  }, html);
}

// Box center relative to the host's top-left: the wrapper `<div>` fills the
// embed with no margin of its own (no body-targeted styles here, so
// mountHtmlWithBodyStyles mounts straight into the content container — see
// EmbedLayer.tsx), and the viewport starts at 100% zoom, so CSS px equal
// screen px. left:20+width:80/2, top:30+height:40/2.
const BOX_CENTER = { x: 60, y: 50 };

test.describe("embed element drag", () => {
  test("click selects without moving the element", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);
    const htmlBefore = await readHtmlContent(page);

    await host.click({ position: BOX_CENTER });

    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    await expect(selectionBox).toBeVisible();
    expect(await readHtmlContent(page)).toBe(htmlBefore);
  });

  test("selection shows a size badge in CSS px, positioned under the box", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);

    await host.click({ position: BOX_CENTER });

    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    const badge = page.locator("[data-embed-element-size-badge]");
    await expect(selectionBox).toBeVisible();
    await expect(badge).toHaveText("80 × 40");

    const boxRect = await selectionBox.boundingBox();
    const badgeRect = await badge.boundingBox();
    if (!boxRect || !badgeRect) throw new Error("missing box/badge rect");
    expect(badgeRect.y).toBeGreaterThan(boxRect.y + boxRect.height);
  });

  test("hovering the already-selected element shows no tag label", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);

    await host.click({ position: BOX_CENTER });
    await expect(page.locator('[data-embed-element-box][data-kind="selection"]')).toBeVisible();

    // Re-hover the same element the selection already covers.
    await host.hover({ position: BOX_CENTER });

    await expect(page.locator("[data-embed-element-label]")).toHaveCount(0);
  });

  test("dragging moves the element and commits one style edit", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);
    const htmlBefore = await readHtmlContent(page);

    const hostBox = await host.boundingBox();
    if (!hostBox) throw new Error("embed host has no box");
    const start = { x: hostBox.x + BOX_CENTER.x, y: hostBox.y + BOX_CENTER.y };
    const dx = 50;
    const dy = 45;

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Several intermediate moves: the browser only synthesizes pointermove
    // events between steps, so a single jump straight to the destination
    // would never cross DRAG_THRESHOLD_PX as a distinct move and the
    // gesture would be read as a click, not a drag.
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(start.x + (dx * i) / 5, start.y + (dy * i) / 5);
    }
    await page.mouse.up();

    await expect
      .poll(async () => readHtmlContent(page))
      .not.toBe(htmlBefore);

    const htmlAfter = await readHtmlContent(page);
    const { left, top } = await readBoxOffsets(page, htmlAfter);
    // ±2px tolerance per the task: sub-pixel device snapping (embedScreenRect)
    // and the zoom division in handleDragEnd can round slightly.
    expect(Math.abs(left - (20 + dx))).toBeLessThanOrEqual(2);
    expect(Math.abs(top - (30 + dy))).toBeLessThanOrEqual(2);

    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    const rectAfter = await selectionBox.boundingBox();
    if (!rectAfter) throw new Error("missing selection rect after drag");
    expect(Math.abs(rectAfter.x - (hostBox.x + 20 + dx))).toBeLessThanOrEqual(3);
  });

  test("Escape cancels an in-progress drag without leaving the picker", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await enterPicker(page);
    const htmlBefore = await readHtmlContent(page);

    const hostBox = await host.boundingBox();
    if (!hostBox) throw new Error("embed host has no box");
    const start = { x: hostBox.x + BOX_CENTER.x, y: hostBox.y + BOX_CENTER.y };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(start.x + (50 * i) / 5, start.y + (45 * i) / 5);
    }

    // Confirm the drag actually took hold (element visibly displaced) before
    // testing that Escape reverts it — otherwise a no-op Escape would pass
    // this assertion for the wrong reason.
    await expect
      .poll(async () => {
        const box = page.locator('[data-embed-element-box][data-kind="selection"]');
        const rect = await box.boundingBox().catch(() => null);
        return rect ? rect.x : null;
      })
      .toBeGreaterThan(hostBox.x + 20 + 5);

    await page.keyboard.press("Escape");

    // Release the button so no gesture is left hanging for the next test.
    await page.mouse.up();

    expect(await readHtmlContent(page)).toBe(htmlBefore);

    // The element itself (its live inline style, restored by `revertDrag`)
    // is back where it started, not just the committed htmlContent.
    const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
    const rectAfter = await selectionBox.boundingBox();
    if (!rectAfter) throw new Error("missing selection rect after Escape");
    expect(Math.abs(rectAfter.x - (hostBox.x + 20))).toBeLessThanOrEqual(2);
    expect(Math.abs(rectAfter.y - (hostBox.y + 30))).toBeLessThanOrEqual(2);

    const selectElementToggle = page.getByRole("button", { name: "Exit element select" });
    await expect(selectElementToggle).toBeVisible();
    await expect(selectElementToggle).toHaveAttribute("aria-pressed", "true");
  });
});
