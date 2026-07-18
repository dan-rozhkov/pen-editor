import { expect, test } from "@playwright/test";

// Node count is parameterized via PERF_NODES (defaults to 5000) so the same
// probe can be re-run at larger sizes, e.g. `PERF_NODES=20000 npm run test:e2e`.
const PERF_NODES = Math.max(100, parseInt(process.env.PERF_NODES ?? "5000", 10) || 5000);

// Measured post-Task-13 numbers (dirty-diff + grid-culling + raster-cache-flag-on),
// hard budgets = 1.5x measured avg, rounded up. See docs/superpowers/specs/
// 2026-07-17-pixi-rendering-performance-design.md "Results" section for the
// full before/after table and the 20k numbers this doesn't hard-gate on.
// avg budgets: 1.5x measured avg, rounded up. max budgets: 2x measured max,
// rounded up — max is noisier frame-to-frame (GC pauses, first-frame JIT) than
// avg, so 1.5x on max alone would flake; 2x keeps it a regression tripwire
// without gating on noise.
const FLUSH_AVG_BUDGET_MS = 0.6; // measured ~0.33-0.35ms avg @5k (3 runs)
const FLUSH_MAX_BUDGET_MS = 5; // measured ~2.4ms max @5k (3 runs)
const CULLING_AVG_BUDGET_MS = 0.1; // measured ~0.03-0.045ms avg @5k (3 runs)
const CULLING_MAX_BUDGET_MS = 0.5; // measured ~0.2ms max @5k (3 runs)

// Perf probe: seeds PERF_NODES nodes, simulates pan + node move, reads
// perfStats. Hard budgets below are calibrated at the default 5000-node size;
// larger PERF_NODES runs are for manual measurement, not CI gating.
test("large document: sync flush and culling stay within budget", async ({ page }) => {
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
  // Disable the DEV-only diff safety net so this probe measures the shipped
  // diff path, not the full-scan comparison run alongside it in dev.
  await page.addInitScript(() => localStorage.setItem("pen.diffCheck", "off"));
  await page.goto(`/?perf=${PERF_NODES}`);
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

  const cullingAvg = (result.updateCulling?.totalMs ?? 0) / Math.max(1, result.updateCulling?.count ?? 1);
  const flushAvg = (result.flush?.totalMs ?? 0) / Math.max(1, result.flush?.count ?? 1);
  const cullingMax = result.updateCulling?.maxMs ?? 0;
  const flushMax = result.flush?.maxMs ?? 0;

  // Hard budgets, calibrated at the default 5000-node size (post-Task-13:
  // dirty-diff + grid-culling + raster-cache-flag-on). See "Results" section
  // of docs/superpowers/specs/2026-07-17-pixi-rendering-performance-design.md.
  expect(flushAvg, `flush avg ${flushAvg.toFixed(2)}ms`).toBeLessThanOrEqual(FLUSH_AVG_BUDGET_MS);
  expect(flushMax, `flush max ${flushMax.toFixed(2)}ms`).toBeLessThanOrEqual(FLUSH_MAX_BUDGET_MS);
  expect(cullingAvg, `updateCulling avg ${cullingAvg.toFixed(2)}ms`).toBeLessThanOrEqual(CULLING_AVG_BUDGET_MS);
  expect(cullingMax, `updateCulling max ${cullingMax.toFixed(2)}ms`).toBeLessThanOrEqual(CULLING_MAX_BUDGET_MS);
});
