import type { Locator, Page } from "@playwright/test";

// Shared mechanics for specs that seed an embed node and interact with its
// DOM-overlay host on the canvas (embed-dom-layer, embed-element-agent,
// embed-select-no-stuck-drag, embed-element-keyboard-nav,
// embed-element-sortable, embed-element-properties).

export interface EmbedNodeInput {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  htmlContent: string;
}

/**
 * Adds an embed node to the scene store (dev-only global) and returns a
 * locator for its DOM host (`[data-embed-id]`). Defaults (200x120 near the
 * toolbar/sidebar-clear canvas area) match what most embed specs used
 * inline; pass `x`/`y`/`width`/`height` to override.
 */
export async function addEmbedNode(page: Page, node: EmbedNodeInput): Promise<Locator> {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __sceneStore: { getState: () => { addNode: (n: unknown) => void } };
    };
    w.__sceneStore.getState().addNode({
      type: "embed",
      name: "Code",
      x: 500,
      y: 300,
      width: 200,
      height: 120,
      ...n,
    });
  }, node);
  return page.locator(`[data-embed-id="${node.id}"]`);
}

/**
 * Waits until the canvas hit test actually resolves `point` (screen
 * coordinates) to `embedId`. The culling index backing hit-testing only
 * refreshes on pixiSync's rAF-deferred flush, so a click/dblclick sent right
 * after `addEmbedNode` can be consumed doing nothing — measured to fail
 * ~50-90% of the time in isolation without this wait (see
 * embed-dom-layer.spec.ts's original comment for the full rationale). Every
 * embed spec that clicks or drags on the canvas needs this before its first
 * interaction with a freshly seeded embed.
 */
export async function waitForEmbedHitTest(
  page: Page,
  point: { x: number; y: number },
  embedId: string,
): Promise<void> {
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
    { point, embedId },
  );
}

/**
 * A locator's bounding box (throws if it has none) plus its center point in
 * screen coordinates — the shape most embed specs need before clicking or
 * waiting on a hit test at the middle of the host. Callers that need a
 * different point (e.g. near an edge) read `box` themselves.
 */
export async function boxPoint(
  locator: Locator,
): Promise<{ box: { x: number; y: number; width: number; height: number }; point: { x: number; y: number } }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("locator has no bounding box");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return { box, point };
}

/**
 * Moves the mouse from `start` to `end` in `steps` intermediate moves (button
 * already down) — the browser only synthesizes pointermove events between
 * steps, so a single jump straight to the destination would never cross a
 * drag threshold as a distinct move and the gesture would read as a click.
 */
export async function moveMouseThrough(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  steps = 5,
): Promise<void> {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * i) / steps,
      start.y + ((end.y - start.y) * i) / steps,
    );
  }
}
