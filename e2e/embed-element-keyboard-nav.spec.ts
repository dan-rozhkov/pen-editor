import { test, expect, type Page, type Locator } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";
import { stubModels } from "./support/api";
import { addEmbedNode, waitForEmbedHitTest, boxPoint } from "./support/embed";

// Live-browser coverage for keyboard navigation across elements INSIDE an
// embed's shadow DOM (Tab/Shift+Tab across siblings, Enter to descend/edit,
// Shift+Enter to go up) and the dashed child-outline overlay that follows
// the current selection/hover — src/lib/embedElementNavigation.ts,
// src/components/canvas/embedElementNavigation.ts, the Tab/Enter/Shift+Enter
// branches in keyboardCommands.ts, and EmbedElementHighlight.tsx's
// `[data-embed-child-outline(s)]` boxes. All of this is unit-tested against
// happy-dom, which has no real layout engine and a synthetic shadow DOM, so
// this spec is the only place the actual box positions and hover/selection
// interplay get checked against a real Chromium layout.

const EMBED_ID = "kbnav-target";

// Three top-level blocks, stacked (plain block-level flow, no flex needed):
//  - block1: a text leaf (Tab/Enter/Escape coverage)
//  - block2: NOT a text leaf — two nested block children (Enter-to-descend,
//    Shift+Enter-to-ascend, and child-outline coverage)
//  - block3: a text leaf
// Host is 300x200, matching e2e/embed-element-sortable.spec.ts's embed size.
const EMBED_HTML =
  "<div id='block1' style='height:40px;background:#f00'>One</div>" +
  "<div id='block2' style='height:100px;background:#0f0;padding:10px;box-sizing:border-box'>" +
  "<div id='child1' style='height:30px;background:#00f'>Child One</div>" +
  "<div id='child2' style='height:30px;background:#ff0'>Child Two</div>" +
  "</div>" +
  "<div id='block3' style='height:40px;background:#0ff'>Three text</div>";

async function gotoEditorWithEmbed(page: Page) {
  await stubModels(page);

  await page.goto("/app");
  await expectEditorMounted(page);

  await addEmbedNode(page, {
    id: EMBED_ID,
    name: "Keyboard nav target",
    width: 300,
    height: 200,
    htmlContent: EMBED_HTML,
  });
}

/** Select the embed on the canvas — selecting it as the sole node
 * auto-starts the element picker (`useEmbedPickerLifecycle`), with nothing
 * picked yet. Mirrors `embed-element-sortable.spec.ts`'s `enterPicker`, but
 * a single plain click: before picking starts the host has
 * `pointer-events: none`, so the click always lands on the canvas hit test
 * underneath (selecting the node), regardless of which block it's over. */
async function selectEmbed(page: Page): Promise<Locator> {
  const host = page.locator(`[data-embed-id="${EMBED_ID}"]`);
  await expect(host).toBeVisible();

  const { box, point: center } = await boxPoint(host);
  const clickPoint = { x: center.x, y: box.y + 10 };
  await waitForEmbedHitTest(page, clickPoint, EMBED_ID);

  await host.click({ force: true, position: { x: box.width / 2, y: 10 } });

  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");

  return host;
}

/** Box of the currently-picked element, relative to the embed host's own
 * top-left — the shape every position assertion below is written against,
 * independent of where the host itself sits on the (arbitrary) canvas. */
async function selectionBoxRelativeToHost(page: Page, host: Locator) {
  const selectionBox = page.locator('[data-embed-element-box][data-kind="selection"]');
  await expect(selectionBox).toBeVisible();
  const [hostBox, boxRect] = await Promise.all([host.boundingBox(), selectionBox.boundingBox()]);
  if (!hostBox || !boxRect) throw new Error("missing host/selection rect");
  return {
    top: boxRect.y - hostBox.y,
    left: boxRect.x - hostBox.x,
    width: boxRect.width,
    height: boxRect.height,
  };
}

function expectClose(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

// Relative centers (CSS px == screen px at 100% zoom), matching EMBED_HTML.
const BLOCK1_CENTER = { x: 150, y: 20 };
const BLOCK2_CENTER = { x: 150, y: 90 };
const BLOCK3_CENTER = { x: 150, y: 160 };
// A point that lands on block2 ITSELF, not one of its children: block2's
// 10px padding box (y 40-50, before child1 starts at 50) is the only part
// of its area no child covers — BLOCK2_CENTER (y 90) is inside child2.
const BLOCK2_OWN_POINT = { x: 150, y: 44 };

test.describe("embed element keyboard navigation", () => {
  test("Enter on the sole-selected embed picks its first top-level element", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await selectEmbed(page);

    await page.keyboard.press("Enter");

    const box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 0);
    expectClose(box.height, 40); // block1
    expectClose(box.width, 300);
  });

  test("Tab/Shift+Tab cycle through top-level siblings, wrapping around", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await selectEmbed(page);
    await page.keyboard.press("Enter"); // -> block1

    await page.keyboard.press("Tab"); // -> block2
    let box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 40);
    expectClose(box.height, 100);

    await page.keyboard.press("Tab"); // -> block3
    box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 140);
    expectClose(box.height, 40);

    await page.keyboard.press("Tab"); // wraps -> block1
    box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 0);
    expectClose(box.height, 40);

    await page.keyboard.press("Shift+Tab"); // wraps back -> block3
    box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 140);
    expectClose(box.height, 40);
  });

  test("Enter on an element with children descends into the first child", async ({ page }) => {
    await gotoEditorWithEmbed(page);
    const host = await selectEmbed(page);
    await page.keyboard.press("Enter"); // -> block1
    await page.keyboard.press("Tab"); // -> block2

    await page.keyboard.press("Enter"); // -> child1

    const box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 50); // block2 top(40) + padding(10)
    expectClose(box.height, 30);
    expectClose(box.width, 280); // 300 - 2*10 padding
  });

  test("Enter on a text leaf starts inline editing; Escape cancels it without losing the selection", async ({
    page,
  }) => {
    await gotoEditorWithEmbed(page);
    const host = await selectEmbed(page);
    await page.keyboard.press("Enter"); // -> block1 (text leaf)

    const isContentEditable = () =>
      page.evaluate((embedId) => {
        const el = document.querySelector<HTMLElement>(`[data-embed-id="${embedId}"]`);
        const target = el?.shadowRoot?.querySelector<HTMLElement>("#block1");
        return target?.getAttribute("contenteditable") ?? null;
      }, EMBED_ID);

    expect(await isContentEditable()).toBeNull();

    await page.keyboard.press("Enter"); // block1 is already selected -> starts inline edit

    await expect.poll(isContentEditable).toBe("plaintext-only");

    // EmbedElementHighlight deliberately WITHHOLDS the selection box while
    // its element is the one being typed into (see its `isEditingSelection`
    // check) — otherwise it would sit drawn on top of the live caret for the
    // whole edit. So no box here is the correct behavior, not a gap.
    await expect(page.locator('[data-embed-element-box][data-kind="selection"]')).toHaveCount(0);

    await page.keyboard.press("Escape");

    await expect.poll(isContentEditable).toBeNull();
    // Selection must still be block1 — Escape here must cancel the TEXT
    // EDIT, not fall through to embed's own "clear picked element" handling.
    // The box reappears now that `isEditingSelection` is false again.
    const box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 0);
    expectClose(box.height, 40);
  });

  test("Shift+Enter moves to the parent, then clears the element pick at the top level", async ({
    page,
  }) => {
    await gotoEditorWithEmbed(page);
    const host = await selectEmbed(page);
    await page.keyboard.press("Enter"); // -> block1
    await page.keyboard.press("Tab"); // -> block2
    await page.keyboard.press("Enter"); // -> child1

    await page.keyboard.press("Shift+Enter"); // -> back up to block2
    const box = await selectionBoxRelativeToHost(page, host);
    expectClose(box.top, 40);
    expectClose(box.height, 100);

    await page.keyboard.press("Shift+Enter"); // block2 is top-level -> clears the pick
    await expect(page.locator('[data-embed-element-box][data-kind="selection"]')).toHaveCount(0);
  });

  test("dashed child outlines: top-level elements while hovering an unpicked embed, own children while hovering the selected element, none otherwise", async ({
    page,
  }) => {
    await gotoEditorWithEmbed(page);
    const host = await selectEmbed(page);

    // Case B: nothing picked yet, pointer over the embed's content -> outline
    // the three top-level elements.
    await host.hover({ position: BLOCK2_CENTER, force: true });
    await expect(page.locator("[data-embed-child-outline]")).toHaveCount(3);

    // Pick block2 (two children).
    await page.keyboard.press("Enter"); // -> block1
    await page.keyboard.press("Tab"); // -> block2

    // Move off block2 first — the pointer is already sitting at
    // BLOCK2_CENTER from the hover above, and Tab/Enter are keyboard-only,
    // so re-hovering the SAME point would dispatch no new pointermove for
    // EmbedLayer to react to.
    await host.hover({ position: BLOCK3_CENTER, force: true });

    // Case A: hovering the SELECTED element itself (its own padding box, not
    // one of its children — see BLOCK2_OWN_POINT's comment) -> outline its
    // own navigable children.
    await host.hover({ position: BLOCK2_OWN_POINT, force: true });
    await expect(page.locator("[data-embed-child-outline]")).toHaveCount(2);

    // Hovering a DIFFERENT element while block2 stays selected -> no
    // child outlines at all (neither case A nor case B applies).
    await host.hover({ position: BLOCK1_CENTER, force: true });
    await expect(page.locator("[data-embed-child-outline]")).toHaveCount(0);
  });
});
