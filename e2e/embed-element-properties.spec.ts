import { expect, test, type Page } from "@playwright/test";
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

test("picked embed elements use the native inspector field layout", async ({ page }) => {
  await addEmbedFixture(page);
  const host = await enterElementPicker(page);

  // Select the flex container first. Its full Layout section is the visual
  // regression surface: all select labels share the native outside-label
  // pattern and Padding uses the same compact T/R/B/L grid as Auto Layout.
  await host.click({ position: { x: 12, y: 12 } });
  await expect(elementHeader(page, "div#fixture-card")).toBeVisible();
  await expect(page.getByText("Padding", { exact: true })).toBeVisible();
  await expect(page.getByText("Direction", { exact: true })).toBeVisible();
  await expect(page.getByText("Justify", { exact: true })).toBeVisible();
  const flexSidebar = sidebarFor(page, "div#fixture-card");
  await expect(flexSidebar).toBeVisible();
  await flexSidebar.screenshot({ path: test.info().outputPath("flex-element-properties.png") });

  // A real edit confirms that the reorganised control remains connected to
  // the selected element and that the picker selection survives the DOM
  // refresh after the HTML source of truth changes.
  const layoutSection = page
    .getByText("Layout", { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "relative") and contains(@class, "border-b")]');
  await layoutSection.locator('input[type="number"]').nth(1).fill("24");
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
});
