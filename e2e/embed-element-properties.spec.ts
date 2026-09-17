import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

const EMBED_ID = "element-properties-fixture";
const EMBED_HTML = `
  <div id="fixture-card" style="display:flex; flex-direction:column; align-items:center; justify-content:space-between; gap:12px; width:280px; height:160px; padding:16px; background:#f4f4f5; border:2px solid #27272a; border-radius:12px; color:#18181b; font-size:14px; line-height:20px; letter-spacing:0px; text-align:center;">
    <h2 style="margin:0; font-size:24px; font-weight:700;">Element panel heading</h2>
    <p style="margin:0;">A real browser fixture for the embed inspector.</p>
  </div>
`;

async function addEmbedFixture(page: Page): Promise<void> {
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
    { id: EMBED_ID, html: EMBED_HTML },
  );
}

async function enterElementPicker(page: Page) {
  const host = page.locator(`[data-embed-id="${EMBED_ID}"]`);
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
    { point, id: EMBED_ID },
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

/** Same idea as `numberFieldByLabel`, for a `SelectInput`'s `role="combobox"`
 * trigger instead of an `<input>`. */
function selectTriggerByLabel(container: Locator, label: string) {
  return container
    .locator(`label:text-is("${label}")`)
    .locator('xpath=ancestor::*[.//*[@role="combobox"]][1]')
    .locator('[role="combobox"]');
}

/** Read a live property off the fixture's `<div id="fixture-card">`
 * from the current `htmlContent`, the same DOMParser round-trip the rest of
 * this spec uses instead of trusting the panel's own optimistic state. */
function readFixtureCardStyle(page: Page, prop: "boxSizing"): Promise<string | undefined> {
  return page.evaluate(
    ({ id, prop }) => {
      const w = window as unknown as {
        __sceneStore: { getState: () => { nodesById: Record<string, { htmlContent?: string }> } };
      };
      const html = w.__sceneStore.getState().nodesById[id]?.htmlContent ?? "";
      const card = new DOMParser().parseFromString(html, "text/html").getElementById("fixture-card");
      return card?.style[prop];
    },
    { id: EMBED_ID, prop },
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

  // Stroke's "Align" select (Inside/Center/Outside), live in a REAL browser:
  // `generateVisualStyles` renders `strokeAlign: "inside"` and `"center"`
  // into the exact same `border: <w> solid <c>` declaration — `box-sizing`
  // is the only thing distinguishing them — and happy-dom (the unit-test
  // environment for this same control) is not a reliable oracle for whether
  // a `box-sizing` write actually reaches the DOM/round-trips through
  // `applyStrokeAlignFromCss`'s read side. The fixture's border has no
  // explicit `box-sizing`, i.e. content-box, i.e. "Center".
  const strokeSection = page
    .getByText("Stroke", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  const alignSelect = selectTriggerByLabel(strokeSection, "Align");
  await expect(alignSelect).toContainText("Center");
  expect(await readFixtureCardStyle(page, "boxSizing")).not.toBe("border-box");

  await alignSelect.click();
  await page.getByRole("option", { name: "Inside", exact: true }).click();
  await expect
    .poll(() => readFixtureCardStyle(page, "boxSizing"))
    .toBe("border-box");
  await expect(elementHeader(page, "div#fixture-card")).toBeVisible();
  // The select itself must reflect the write, not silently revert on the
  // next rAF re-read (the exact failure mode of the bug this asserts against
  // — the value round-trips through `applyStrokeAlignFromCss` reading the
  // live DOM back).
  await expect(alignSelect).toContainText("Inside");

  await alignSelect.click();
  await page.getByRole("option", { name: "Center", exact: true }).click();
  await expect
    .poll(() => readFixtureCardStyle(page, "boxSizing"))
    .toBe("content-box");
  await expect(alignSelect).toContainText("Center");

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
