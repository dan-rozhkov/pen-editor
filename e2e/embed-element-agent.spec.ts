import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";
import { stubModels, stubChatTurns } from "./support/api";
import { addEmbedNode, waitForEmbedHitTest, boxPoint } from "./support/embed";

// Picking an element inside an embed must read like selecting a native node:
// a size badge (no tag-name label), and a single on-canvas agent trigger —
// the element-scoped one, with the embed-level trigger suppressed. Sending
// from it opens a fresh chat whose composer shows the element as an
// attachment chip, which is how the user sees what the agent was told about
// (the element itself rides along in canvasContext.selectedEmbedElement).
test("picked embed element: size badge, no tag label, element-scoped agent button", async ({ page }) => {
  await stubModels(page);
  // Sending from the composer starts a real chat turn — stub the backend so
  // the assertion below is about the chip, not about a failed request that
  // happens to leave the chip on screen either way.
  const chatRequests = await stubChatTurns(page, [
    [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "On it." },
      { type: "text-end", id: "t1" },
      { type: "finish-step" },
      { type: "finish" },
    ],
  ]);

  await page.goto("/app");
  await expectEditorMounted(page);

  // Placed so the whole affordance — the trigger at the picked element's
  // right edge plus the 288px composer it opens — stays clear of the right
  // properties panel, which would otherwise intercept the click.
  const host = await addEmbedNode(page, {
    id: "e1",
    x: 450,
    y: 300,
    width: 200,
    height: 200,
    htmlContent:
      "<div style='padding:24px;font-family:sans-serif'><button id='cta' style='padding:12px 20px;background:#111;color:#fff;border-radius:8px;border:0'>Buy now</button></div>",
  });

  await expect(host).toBeVisible();
  const { point: clickPoint } = await boxPoint(host);
  await waitForEmbedHitTest(page, clickPoint, "e1");
  // Selecting the embed is all it takes: the element picker starts with the
  // selection (useEmbedPickerLifecycle), and the host flipping to
  // pointer-events:auto is the signal that it owns the pointer now.
  await host.click({ force: true });
  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");

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
  const context = JSON.parse((chatRequests[0].canvasContext as string) ?? "{}") as {
    selectedEmbedElement?: { embedId: string; elementId?: string };
  };
  expect(context.selectedEmbedElement?.embedId).toBe("e1");
  expect(context.selectedEmbedElement?.elementId).toBe("cta");
});
