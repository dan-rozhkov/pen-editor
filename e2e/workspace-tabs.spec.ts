import { test, expect, type Frame, type Page } from "@playwright/test";
import { stubChatTurns, stubModels } from "./support/api";
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

test("the chat panel drives a canvas tab it opens over the canvas link", async ({ page }) => {
  test.setTimeout(120_000);
  await stubModels(page);
  const requests = await stubChatTurns(page, [
    [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Adding a frame." },
      { type: "text-end", id: "t1" },
      {
        type: "tool-input-available",
        toolCallId: "call-ws-1",
        toolName: "batch_design",
        input: { operations: 'f=I(document, {type: "frame", name: "LinkFrame", width: 400, height: 300, fill: "#ffccdd"})' },
      },
      { type: "finish-step" },
      { type: "finish" },
    ],
    [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: "Done." },
      { type: "text-end", id: "t2" },
      { type: "finish-step" },
      { type: "finish" },
    ],
  ]);

  await page.goto("/workspace");
  const panel = page.frameLocator('iframe[title="Sideform Agent"]');
  const input = panel.getByPlaceholder("Ask Sideform Agent…");
  await expect(input).toBeVisible({ timeout: EDITOR_MOUNT_TIMEOUT });
  // No canvas tab exists until the agent needs one.
  await expect(page.locator('iframe[src*="/app?canvas="]')).toHaveCount(0);

  await input.fill("Create a link frame");
  await input.press("Enter");

  // The canvas tab opened on demand and the tool ran in it, not in the chat frame.
  const frame = await canvasFrame(page);
  await frame.waitForFunction(
    () => {
      const store = (window as unknown as { __sceneStore?: { getState(): { nodesById: Record<string, { name?: string }> } } }).__sceneStore;
      return Object.values(store?.getState().nodesById ?? {}).some((n) => n.name === "LinkFrame");
    },
    null,
    { timeout: EDITOR_MOUNT_TIMEOUT },
  );

  // The auto-continuation carries the tool result the canvas tab produced.
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(2);
  const toolPart = requests[1].messages?.find((m) => m.role === "assistant")?.parts.find((p) => p.type === "tool-batch_design");
  expect(toolPart?.state).toBe("output-available");
  const output = JSON.parse(String(toolPart?.output)) as { success: boolean; createdNodes: Array<{ name: string }> };
  expect(output.success).toBe(true);
  expect(output.createdNodes[0]).toMatchObject({ name: "LinkFrame" });

  // The canvas tab runs chatless: no Agents section; the chat stays in the left panel.
  await expect(page.frameLocator('iframe[src*="/app?canvas="]').getByTestId("rail-pages")).toBeVisible();
  await expect(page.frameLocator('iframe[src*="/app?canvas="]').getByTestId("rail-agents")).toHaveCount(0);
  // The panel has the canvas bridge (in dev `isAgentPanelHost()` is true anyway, so the bridge is what counts).
  const hasBridge = await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>('iframe[title="Sideform Agent"]');
    const api = (f?.contentWindow as unknown as { penAgentPanel?: { version: number; canvas?: unknown } } | null)?.penAgentPanel;
    return api?.version === 2 && api.canvas !== undefined;
  });
  expect(hasBridge).toBe(true);
});

test("dragging a tab reorders it without reloading its frame, and the order survives a reload", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "New canvas tab" }).click();
  const canvasIframe = page.locator('iframe[src*="/app?canvas="]');
  await expect(canvasIframe).toBeAttached();
  for (const name of ["New Document", "New Workflow"]) {
    await page.getByRole("button", { name: "New tab" }).click();
    await page.getByRole("menuitem", { name }).click();
  }
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  const titles = async () => tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-tab-id")));
  const [first, second, third] = (await titles()) as string[];

  // A marker on the canvas frame's window: a reload of the frame would drop it.
  const handle = await canvasIframe.elementHandle();
  const win = await handle?.contentFrame();
  await win?.evaluate(() => {
    (window as unknown as { __keep: boolean }).__keep = true;
  });

  const a = (await page.locator(`[data-tab-id="${first}"]`).boundingBox()) as { x: number; y: number; width: number; height: number };
  const c = (await page.locator(`[data-tab-id="${third}"]`).boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(c.x + c.width - 4, c.y + c.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(titles).toEqual([second, third, first]);
  expect(await win?.evaluate(() => (window as unknown as { __keep?: boolean }).__keep)).toBe(true);

  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(3);
  expect(await titles()).toEqual([second, third, first]);
});

test("the chat panel collapses and expands without reloading, and the choice survives a reload", async ({ page }) => {
  await page.goto("/workspace");
  const panel = page.locator('iframe[title="Sideform Agent"]');
  await expect(panel).toBeVisible();
  const handle = await panel.elementHandle();
  const win = await handle?.contentFrame();
  await win?.evaluate(() => {
    (window as unknown as { __keep: boolean }).__keep = true;
  });

  await page.getByRole("button", { name: "Hide agent panel" }).click();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await page.locator("main.ws-start").boundingBox())?.x).toBe(8);

  // The shortcut works with the focus inside a frame too.
  await page.getByRole("button", { name: "Show agent panel" }).click();
  await expect(panel).toBeVisible();
  await win?.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB", metaKey: true, altKey: true, cancelable: true }));
  });
  await expect(panel).toBeHidden();
  expect(await win?.evaluate(() => (window as unknown as { __keep?: boolean }).__keep)).toBe(true);

  await page.reload();
  await expect(page.getByRole("button", { name: "Show agent panel" })).toBeVisible();
  await expect(panel).toBeHidden();
});
