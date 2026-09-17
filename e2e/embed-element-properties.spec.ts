import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

const EMBED_ID = "element-properties-fixture";
const EMBED_HTML = `
  <div id="fixture-card" style="display:flex; flex-direction:column; align-items:center; justify-content:space-between; gap:12px; width:280px; height:160px; padding:16px; background:#f4f4f5; border:2px solid #27272a; border-radius:12px; color:#18181b; font-size:14px; line-height:20px; letter-spacing:0px; text-align:center;">
    <h2 style="margin:0; font-size:24px; font-weight:700;">Element panel heading</h2>
    <p style="margin:0;">A real browser fixture for the embed inspector.</p>
  </div>
`;

async function addEmbedFixture(
  page: Page,
  id: string = EMBED_ID,
  html: string = EMBED_HTML,
): Promise<void> {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } }),
  );
  await page.route("**/api/skills", (route) => route.fulfill({ json: { skills: [] } }));
  await page.goto("/app");
  await expectEditorMounted(page);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __sceneStore?: unknown }).__sceneStore),
  );

  await page.evaluate(
    ({ id, html }) => {
      const store = (window as unknown as {
        __sceneStore: { getState: () => { addNode: (node: unknown) => void } };
      }).__sceneStore;
      store.getState().addNode({
        id,
        type: "embed",
        name: "Element properties fixture",
        x: 480,
        y: 260,
        width: 320,
        height: 240,
        htmlContent: html,
      });
    },
    { id, html },
  );
}

async function enterElementPicker(page: Page, id: string = EMBED_ID) {
  const host = page.locator(`[data-embed-id="${id}"]`);
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  if (!box) throw new Error("embed host has no bounding box");

  const point = { x: box.x + box.width / 2, y: box.y + box.height - 20 };
  await page.waitForFunction(
    ({ point, id }) => {
      const w = window as unknown as {
        __hitTestScreenPoint?: (x: number, y: number) => string | null;
      };
      const canvas = document.querySelector("[data-canvas] canvas");
      if (!w.__hitTestScreenPoint || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return w.__hitTestScreenPoint(point.x - rect.left, point.y - rect.top) === id;
    },
    { point, id },
  );

  // A single click on the canvas selects the embed, which auto-starts the
  // picker (useEmbedPickerLifecycle) — there is no toggle button any more, so
  // the signal is the host flipping to pointer-events:auto for the picker
  // overlay, the same one embed-dom-layer/-sortable use.
  await host.click({ force: true, position: { x: box.width / 2, y: box.height - 20 } });
  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");
  return host;
}

/** The inspector's element header (EmbedElementProperties renders the label
 * with a matching `title`). Matched by title rather than by text: the chat
 * composer shows the very same label in its attachment chip, so plain
 * `getByText` is a strict-mode violation. */
function elementHeader(page: Page, selectedElement: string) {
  return page.getByTitle(selectedElement, { exact: true });
}

function sidebarFor(page: Page, selectedElement: string) {
  return elementHeader(page, selectedElement).locator(
    'xpath=ancestor::div[contains(@class, "w-[300px]")]',
  );
}

/**
 * Find the `<input>` for a native `NumberInput`/`SelectInput` field by its
 * visible label text, scoped to `container` — robust to field reordering,
 * unlike a positional `nth(n)` query. The label (`PropertyInputs.tsx`'s
 * `Label`) sits beside the input inside a shared `InputGroup`, not as a
 * semantic `<label for>`, so this walks up to the closest ancestor that also
 * contains an `<input>` rather than relying on `getByLabel`.
 */
function numberFieldByLabel(container: Locator, label: string) {
  return container
    .locator(`label:text-is("${label}")`)
    .locator('xpath=ancestor::*[.//input][1]')
    .locator("input");
}

/** Read a live property off the fixture's `<div id="fixture-card">`
 * from the current `htmlContent`, the same DOMParser round-trip the rest of
 * this spec uses instead of trusting the panel's own optimistic state. */
function readFixtureCardStyle(
  page: Page,
  prop: "boxSizing" | "borderWidth" | "borderColor" | "borderStyle" | "outline",
  embedId: string = EMBED_ID,
  elementId: string = "fixture-card",
): Promise<string | undefined> {
  return page.evaluate(
    ({ id, prop, elementId }) => {
      const w = window as unknown as {
        __sceneStore: { getState: () => { nodesById: Record<string, { htmlContent?: string }> } };
      };
      const html = w.__sceneStore.getState().nodesById[id]?.htmlContent ?? "";
      const card = new DOMParser().parseFromString(html, "text/html").getElementById(elementId);
      return card?.style[prop];
    },
    { id: embedId, prop, elementId },
  );
}

test("picked embed elements use the native inspector field layout", async ({ page }) => {
  await addEmbedFixture(page);
  const host = await enterElementPicker(page);

  // Select the flex container first. Its Auto Layout section — the SAME
  // `AutoLayoutSection` a real frame's PropertyEditor uses — is the visual
  // regression surface here: native outside-label selects, the alignment
  // grid, and the compact T/R/B/L padding grid.
  await host.click({ position: { x: 12, y: 12 } });
  await expect(elementHeader(page, "div#fixture-card")).toBeVisible();
  await expect(page.getByText("Padding", { exact: true })).toBeVisible();
  await expect(page.getByText("Direction", { exact: true })).toBeVisible();
  await expect(page.getByText("Alignment", { exact: true })).toBeVisible();
  const flexSidebar = sidebarFor(page, "div#fixture-card");
  await expect(flexSidebar).toBeVisible();
  await flexSidebar.screenshot({ path: test.info().outputPath("flex-element-properties.png") });

  // A real edit confirms that the reorganised control remains connected to
  // the selected element and that the picker selection survives the DOM
  // refresh after the HTML source of truth changes. Found by its "T" label
  // rather than a positional index — the native Auto Layout section reflows
  // fields (Direction/Wrap, the alignment grid, Gap) ahead of Padding.
  const autoLayoutSection = page
    .getByText("Auto Layout", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  await numberFieldByLabel(autoLayoutSection, "T").fill("24");
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const w = window as unknown as {
          __sceneStore: { getState: () => { nodesById: Record<string, { htmlContent?: string }> } };
        };
        const html = w.__sceneStore.getState().nodesById[id]?.htmlContent ?? "";
        return new DOMParser()
          .parseFromString(html, "text/html")
          .getElementById("fixture-card")?.style.paddingTop;
      }, EMBED_ID),
    )
    .toBe("24px");
  await expect(elementHeader(page, "div#fixture-card")).toBeVisible();

  // Stroke's "Align" (Inside/Center/Outside) control no longer exists for an
  // embed element, live in a REAL browser: CSS has no border-alignment
  // concept, and reconstructing it from `border`/`box-sizing` never survived
  // an embed's own `* { box-sizing: border-box }` class reset (five review
  // rounds of "the panel shows a state the render doesn't have" — see
  // `embedElementNode.ts`'s `applyOutlineStroke` doc comment). The control is
  // gone; a stroke edit must still reach `htmlContent`, and must never write
  // an inline `box-sizing` declaration.
  const strokeSection = page
    .getByText("Stroke", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  await expect(strokeSection.getByText("Align", { exact: true })).toHaveCount(0);
  expect(await readFixtureCardStyle(page, "boxSizing")).not.toBe("border-box");

  const strokeWeightInput = numberFieldByLabel(strokeSection, "Weight");
  await strokeWeightInput.fill("5");
  await expect.poll(() => readFixtureCardStyle(page, "borderWidth")).toBe("5px");
  // No Align control means no way for this edit to ever introduce an inline
  // `box-sizing` declaration.
  expect(await readFixtureCardStyle(page, "boxSizing")).toBeFalsy();
  await expect(elementHeader(page, "div#fixture-card")).toBeVisible();

  // Then select text and capture its editable typography/text state. Scrolling
  // the real 300px sidebar catches clipped or misaligned lower sections.
  await host.click({ position: { x: 88, y: 42 } });
  await expect(elementHeader(page, "h2")).toBeVisible();
  const propertiesScroll = page.locator(".layers-scrollbar").last();
  await propertiesScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('input[value="Element panel heading"]')).toBeVisible();
  const textSidebar = sidebarFor(page, "h2");
  await expect(textSidebar).toBeVisible();
  await textSidebar.screenshot({ path: test.info().outputPath("text-element-properties.png") });

  // Typography's trailing "Color" row (`TypographySection`'s `textColor`
  // prop) — the one deliberate content difference from the native panel,
  // since a real TextNode's color lives in FillSection instead. Present only
  // here (the flex container's Fill section above has no such label), and a
  // real edit must reach `htmlContent` as the `<h2>`'s own `color`, not the
  // container's `background-color` or `border`.
  const typographySection = page
    .getByText("Typography", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  await expect(typographySection.getByText("Color", { exact: true })).toBeVisible();
  const textColorInput = typographySection.getByPlaceholder("#000000");
  await expect(textColorInput).toBeVisible();
  await textColorInput.fill("#ff00aa");
  await textColorInput.blur();

  await expect
    .poll(() =>
      page.evaluate((id) => {
        const w = window as unknown as {
          __sceneStore: { getState: () => { nodesById: Record<string, { htmlContent?: string }> } };
        };
        const html = w.__sceneStore.getState().nodesById[id]?.htmlContent ?? "";
        const heading = new DOMParser().parseFromString(html, "text/html").querySelector("h2");
        return heading?.style.color;
      }, EMBED_ID),
    )
    .toBe("rgb(255, 0, 170)");
  // The container's own background/border must be untouched by the h2's
  // text-color edit — same invariant `embedElementNode.test.ts`'s
  // "background fill vs. text color" describe block pins at the unit level.
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const w = window as unknown as {
          __sceneStore: { getState: () => { nodesById: Record<string, { htmlContent?: string }> } };
        };
        const html = w.__sceneStore.getState().nodesById[id]?.htmlContent ?? "";
        const card = new DOMParser().parseFromString(html, "text/html").getElementById("fixture-card");
        return card?.style.backgroundColor;
      }, EMBED_ID),
    )
    .toBe("rgb(244, 244, 245)");
});

const CLASS_BOX_SIZING_EMBED_ID = "element-properties-class-box-sizing-fixture";
const CLASS_BOX_SIZING_ELEMENT_ID = "reset-card";
// Near-universal in generated embed HTML: a selector-level box-sizing reset
// (not this bridge's own inline write), with the bordered element itself
// carrying NO inline `box-sizing` at all — exactly the shape that used to
// confuse the now-removed Align control (see `embedElementNode.ts`'s
// `applyOutlineStroke` doc comment for why that control is gone rather than
// fixed again). Targeted by id (not a class) so the picker's element label
// stays a plain `div#reset-card` — a class attribute here would also show up
// in the label alongside the id.
const CLASS_BOX_SIZING_HTML = `
  <style>#${CLASS_BOX_SIZING_ELEMENT_ID} { box-sizing: border-box; }</style>
  <div id="${CLASS_BOX_SIZING_ELEMENT_ID}" style="width:200px; height:120px; border:1px solid #dddddd;">hi</div>
`;

test("editing a bordered element under a class-authored box-sizing reset never writes an inline box-sizing, in a real browser", async ({
  page,
}) => {
  // Regression coverage for the retired Align control's whole failure class:
  // with no Align select at all, there is no code path left in this panel
  // that can ever emit a `box-sizing` declaration — editing the stroke must
  // leave the embed's own class-level reset alone.
  await addEmbedFixture(page, CLASS_BOX_SIZING_EMBED_ID, CLASS_BOX_SIZING_HTML);
  const host = await enterElementPicker(page, CLASS_BOX_SIZING_EMBED_ID);
  await host.click({ position: { x: 12, y: 12 } });
  await expect(elementHeader(page, `div#${CLASS_BOX_SIZING_ELEMENT_ID}`)).toBeVisible();

  const strokeSection = page
    .getByText("Stroke", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  await expect(strokeSection.getByText("Align", { exact: true })).toHaveCount(0);

  const boxSizing = () =>
    readFixtureCardStyle(page, "boxSizing", CLASS_BOX_SIZING_EMBED_ID, CLASS_BOX_SIZING_ELEMENT_ID);
  expect(await boxSizing()).toBeFalsy();

  // The legacy single-stroke color row lives inside a popover, portalled
  // outside `strokeSection` — open it via its "Edit stroke" trigger and
  // scope the color input to the popover content (a Fill-section color
  // input elsewhere on the page shares the same "#000000" placeholder).
  await strokeSection.getByTitle("Edit stroke").click();
  const strokePopover = page.locator('[data-slot="popover-content"]').last();
  const strokeColorInput = strokePopover.getByPlaceholder("#000000");
  await strokeColorInput.fill("#ff00ff");
  await strokeColorInput.blur();
  await expect
    .poll(() =>
      readFixtureCardStyle(page, "borderColor", CLASS_BOX_SIZING_EMBED_ID, CLASS_BOX_SIZING_ELEMENT_ID),
    )
    .toBe("rgb(255, 0, 255)");
  // The edit must not disturb the class's own box-sizing reset.
  await expect.poll(boxSizing).toBeFalsy();
});

const OUTLINE_STROKE_EMBED_ID = "element-properties-outline-stroke-fixture";
const OUTLINE_STROKE_ELEMENT_ID = "outline-card";
// An `outline`-only stroke (no `border` at all): `applyOutlineStroke`
// (`embedElementNode.ts`) reads this into `node.stroke`/`strokeWidth` for
// display, but always renders it back as `border` (never `strokeAlign:
// "outside"` — see its doc comment). Real-browser coverage for the bug this
// used to have: a stroke edit wrote a NEW `border` right next to this
// still-live `outline`, so the element visibly painted TWO strokes; removing
// the stroke reset `border` to `none` but left `outline` untouched, so the
// stroke kept rendering and the very next re-read pulled it straight back
// out of the outline.
const OUTLINE_STROKE_HTML = `
  <div id="${OUTLINE_STROKE_ELEMENT_ID}" style="width:200px; height:120px; outline:3px solid #333333;">hi</div>
`;

test("editing an outline-sourced stroke resets the live outline instead of painting a second stroke, in a real browser", async ({
  page,
}) => {
  await addEmbedFixture(page, OUTLINE_STROKE_EMBED_ID, OUTLINE_STROKE_HTML);
  const host = await enterElementPicker(page, OUTLINE_STROKE_EMBED_ID);
  await host.click({ position: { x: 12, y: 12 } });
  await expect(elementHeader(page, `div#${OUTLINE_STROKE_ELEMENT_ID}`)).toBeVisible();

  const strokeSection = page
    .getByText("Stroke", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');

  const strokeWeightInput = numberFieldByLabel(strokeSection, "Weight");
  await strokeWeightInput.fill("6");

  await expect
    .poll(() => readFixtureCardStyle(page, "borderWidth", OUTLINE_STROKE_EMBED_ID, OUTLINE_STROKE_ELEMENT_ID))
    .toBe("6px");
  // The invariant this bug broke: never both an active `outline` AND an
  // active `border` painting at once. Read via `CSSStyleDeclaration.outline`
  // (a real browser's CSS parser, unlike happy-dom's, serializes a `none`
  // shorthand write back faithfully) rather than a raw string search over
  // `htmlContent`, which can't tell "never had an outline" from "had one and
  // it was reset".
  await expect
    .poll(() => readFixtureCardStyle(page, "outline", OUTLINE_STROKE_EMBED_ID, OUTLINE_STROKE_ELEMENT_ID))
    .toBe("none");
});

test("removing an outline-sourced stroke actually removes it, and a fresh picker read does not resurrect it, in a real browser", async ({
  page,
}) => {
  await addEmbedFixture(page, OUTLINE_STROKE_EMBED_ID, OUTLINE_STROKE_HTML);
  const host = await enterElementPicker(page, OUTLINE_STROKE_EMBED_ID);
  await host.click({ position: { x: 12, y: 12 } });
  await expect(elementHeader(page, `div#${OUTLINE_STROKE_ELEMENT_ID}`)).toBeVisible();

  const strokeSection = page
    .getByText("Stroke", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  await strokeSection.getByRole("button", { name: "Remove stroke" }).click();

  await expect
    .poll(() => readFixtureCardStyle(page, "outline", OUTLINE_STROKE_EMBED_ID, OUTLINE_STROKE_ELEMENT_ID))
    .toBe("none");
  // `.style.border` (the shorthand GETTER) only serializes when every
  // longhand was set to a mutually consistent value, which a bare
  // `border: none` write does not guarantee (width/color fall back to their
  // initial specified values, not "none") — so this checks the one longhand
  // the write unambiguously touches instead of the shorthand string.
  await expect
    .poll(() => readFixtureCardStyle(page, "borderStyle", OUTLINE_STROKE_EMBED_ID, OUTLINE_STROKE_ELEMENT_ID))
    .toBe("none");

  // Re-select elsewhere and back onto the element — the same rAF re-read
  // path `EmbedElementProperties` takes after every edit
  // (`embedElementToSyntheticNode` off the just-written `htmlContent`) — and
  // confirm the panel shows NO stroke, rather than the "removed" stroke
  // reappearing because the live outline was never actually cleared.
  await host.click({ position: { x: 180, y: 100 } });
  await host.click({ position: { x: 12, y: 12 } });
  await expect(elementHeader(page, `div#${OUTLINE_STROKE_ELEMENT_ID}`)).toBeVisible();
  await expect(strokeSection.getByRole("button", { name: "Add stroke" })).toBeVisible();
  await expect(strokeSection.getByRole("button", { name: "Remove stroke" })).toHaveCount(0);
});
