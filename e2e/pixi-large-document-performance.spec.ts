import { expect, test } from "@playwright/test";

// Baseline perf probe: seeds ~5000 nodes, simulates pan + node move, reads
// perfStats. Budgets are soft (console.warn) until Phase 1–2 land; then tighten.
test("large document: sync flush and culling stay within budget", async ({ page }) => {
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
  await page.goto("/?perf=5000");
  await expect(page.locator("[data-canvas]")).toBeVisible();
  await page.waitForTimeout(1500); // initial build settles

  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      __perfStats: { reset(): void; summary(): Record<string, { count: number; totalMs: number; maxMs: number }> };
      __sceneStore: { getState: () => { nodesById: Record<string, { x: number }>; updateNode: (id: string, u: object) => void } };
      __viewportStore: { getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void } };
    };
    w.__perfStats.reset();
    // simulate 60 pan frames
    for (let i = 0; i < 60; i++) {
      w.__viewportStore.getState().setViewportState({ scale: 1, x: -i * 15, y: 0 });
      await new Promise(requestAnimationFrame);
    }
    // simulate 60 single-node move frames
    for (let i = 0; i < 60; i++) {
      w.__sceneStore.getState().updateNode("perf-0-0", { x: 24 + i });
      await new Promise(requestAnimationFrame);
    }
    return w.__perfStats.summary();
  });

  console.log("perf summary:", JSON.stringify(result, null, 2));
  expect(result.updateCulling?.count ?? 0).toBeGreaterThan(0);
  expect(result.flush?.count ?? 0).toBeGreaterThan(0);
  // Soft budgets — tighten to hard asserts after Phase 1–2:
  const cullingAvg = (result.updateCulling?.totalMs ?? 0) / Math.max(1, result.updateCulling?.count ?? 1);
  const flushAvg = (result.flush?.totalMs ?? 0) / Math.max(1, result.flush?.count ?? 1);
  if (cullingAvg > 2) console.warn(`BUDGET: updateCulling avg ${cullingAvg.toFixed(2)}ms > 2ms`);
  if (flushAvg > 2) console.warn(`BUDGET: flush avg ${flushAvg.toFixed(2)}ms > 2ms`);
});
