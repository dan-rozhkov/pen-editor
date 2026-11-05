import { test, expect, type Frame, type Page } from "@playwright/test";
import { EDITOR_MOUNT_TIMEOUT, expectEditorMountedInFrame } from "./support/editor";

// The browser tab shell at /workspace: one same-origin iframe per tab.

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
});

async function canvasFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((f) => f.url().includes("/app?canvas=")), { timeout: EDITOR_MOUNT_TIMEOUT })
    .toBe(true);
  const frame = page.frames().find((f) => f.url().includes("/app?canvas="));
  if (!frame) throw new Error("canvas frame missing");
  return frame;
}

test("a node added right before a reload is restored (pagehide save)", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "New canvas tab" }).click();
  const frame = await canvasFrame(page);
  await frame.waitForFunction(() => Boolean((window as unknown as { __sceneStore?: unknown }).__sceneStore), null, {
    timeout: EDITOR_MOUNT_TIMEOUT,
  });
  // Persistence saves nothing until its first read settles: that read replaces the scene.
  // The flush resolves after the read, with nothing to save yet.
  await frame.waitForFunction(() => typeof window.penCanvasFlush === "function", null, { timeout: EDITOR_MOUNT_TIMEOUT });
  await frame.evaluate(() => window.penCanvasFlush?.());
  await frame.evaluate(() => {
    const store = (window as unknown as { __sceneStore: { getState(): { addNode(n: unknown): void } } }).__sceneStore;
    store.getState().addNode({ id: "probe1", type: "frame", name: "Probe", x: 100, y: 100, width: 300, height: 200, fill: "#ff5500", children: [] });
  });

  // No wait: only the pagehide handler can have saved this.
  await page.reload();

  const tab = page.getByRole("tab").first();
  if (await tab.isVisible()) await tab.click();
  const restored = await canvasFrame(page);
  await restored.waitForFunction(
    () => {
      const store = (window as unknown as { __sceneStore?: { getState(): { nodesById: Record<string, unknown> } } }).__sceneStore;
      return Boolean(store?.getState().nodesById["probe1"]);
    },
    null,
    { timeout: EDITOR_MOUNT_TIMEOUT },
  );
});

test("a hidden canvas frame keeps its size and returns when the document tab closes", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "New canvas tab" }).click();
  const canvasIframe = page.locator('iframe[src*="/app?canvas="]');
  await expectEditorMountedInFrame(page.frameLocator('iframe[src*="/app?canvas="]'));

  await page.getByRole("button", { name: "Start page" }).click();
  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.locator('iframe[src*="/doc?id="]')).toBeVisible();

  await expect(canvasIframe).toHaveCSS("visibility", "hidden");
  await expect(canvasIframe).not.toHaveCSS("display", "none");
  const box = await canvasIframe.locator("xpath=.").evaluate((el) => {
    const canvas = (el as HTMLIFrameElement).contentDocument?.querySelector("[data-canvas]");
    const r = canvas?.getBoundingClientRect();
    return r ? { width: r.width, height: r.height } : null;
  });
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  await page.getByRole("button", { name: /^Close / }).last().click();
  await expect(canvasIframe).toHaveCSS("visibility", "visible");
});
