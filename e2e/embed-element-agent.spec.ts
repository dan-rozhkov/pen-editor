import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";
import { SSE_HEADERS, sseBody } from "./support/sse";

// Picking an element inside an embed must read like selecting a native node:
// a size badge (no tag-name label), and a single on-canvas agent trigger —
// the element-scoped one, with the embed-level trigger suppressed. Sending
// from it opens a fresh chat whose composer shows the element as an
// attachment chip, which is how the user sees what the agent was told about
// (the element itself rides along in canvasContext.selectedEmbedElement).
test("picked embed element: size badge, no tag label, element-scoped agent button", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [{ id: "test/smoke-model", label: "Smoke Model", supportsVision: true }],
        default: "test/smoke-model",
      },
    }),
  );
  // Sending from the composer starts a real chat turn — stub the backend so
  // the assertion below is about the chip, not about a failed request that
  // happens to leave the chip on screen either way.
  const chatRequests: Array<{ canvasContext?: string }> = [];
  await page.route("**/api/chat", async (route) => {
    chatRequests.push(route.request().postDataJSON() as { canvasContext?: string });
    await route.fulfill({
      headers: SSE_HEADERS,
      body: sseBody([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "On it." },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    });
  });

  await page.goto("/app");
  await expectEditorMounted(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore: { getState: () => { addNode: (n: unknown) => void } };
    };
    w.__sceneStore.getState().addNode({
      id: "e1",
      type: "embed",
      name: "Code",
      // Placed so the whole affordance — the trigger at the embed's right
      // edge plus the 288px composer it opens — stays clear of the right
      // properties panel, which would otherwise intercept the click.
      x: 450,
      y: 300,
      width: 200,
      height: 200,
      htmlContent:
        "<div style='padding:24px;font-family:sans-serif'><button id='cta' style='padding:12px 20px;background:#111;color:#fff;border-radius:8px;border:0'>Buy now</button></div>",
    });
  });

  const host = page.locator('[data-embed-id="e1"]');
  await expect(host).toBeVisible();
  const box = await host.boundingBox();
  const clickPoint = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.waitForFunction((point) => {
    const w = window as unknown as { __hitTestScreenPoint?: (x: number, y: number) => string | null };
    const canvas = document.querySelector("[data-canvas] canvas");
    if (!w.__hitTestScreenPoint || !canvas) return false;
    const rect = canvas.getBoundingClientRect();
    return w.__hitTestScreenPoint(point.x - rect.left, point.y - rect.top) === "e1";
  }, clickPoint);
  await host.dblclick({ force: true });
  await expect(page.getByRole("button", { name: "Exit element select" })).toBeVisible();

  // Click the button inside the embed's shadow DOM to pick it.
  const cta = host.locator("#cta");
  await cta.click({ force: true });

  await expect(page.locator("[data-embed-element-size-badge]")).toBeVisible();
  await expect(page.locator("[data-embed-element-label]")).toHaveCount(0);
  const agentBtn = page.getByRole("button", { name: "Ask agent" });
  await expect(agentBtn).toHaveCount(1);

  // Open the composer, send a message, confirm a chat opened with the chip.
  await agentBtn.first().click();
  const composer = page.locator("[data-embed-element-highlight]");
  const ta = composer.getByPlaceholder("Ask the agent about this element…");
  await expect(ta).toBeVisible();
  await ta.fill("make this button red");
  // Scoped to the on-canvas composer: launching opens the agents panel, which
  // renders a Send button of its own.
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel(/Selected embed element/)).toBeVisible({ timeout: 10000 });

  // The element itself reaches the agent through canvasContext, which is what
  // makes the chip an honest promise rather than decoration.
  await expect.poll(() => chatRequests.length).toBeGreaterThan(0);
  const context = JSON.parse(chatRequests[0].canvasContext ?? "{}") as {
    selectedEmbedElement?: { embedId: string; elementId?: string };
  };
  expect(context.selectedEmbedElement?.embedId).toBe("e1");
  expect(context.selectedEmbedElement?.elementId).toBe("cta");
});
