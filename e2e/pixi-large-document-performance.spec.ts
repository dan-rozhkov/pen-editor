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
// These budgets are calibrated on a local dev machine. GitHub's shared CI
// runners have ~2-3x slower CPUs, and this cost is JS work in the sync layer,
// not GPU — verified by forcing software WebGL locally, which does NOT move the
// numbers (so the CI gap is pure CPU speed, and a fixed absolute-ms budget
// calibrated locally fails on CI purely on hardware). We therefore use looser
// budgets under CI. They stay a real regression tripwire: a reintroduced O(N)
// hot path at 5k nodes lands ~10x over even the CI budget. Observed on CI:
// flush avg ~0.75-0.95ms.
const CI = !!process.env.CI;
const budget = (local: number, ci: number) => (CI ? ci : local);
const FLUSH_AVG_BUDGET_MS = budget(0.6, 2.0); // measured ~0.33-0.35ms avg @5k local
const FLUSH_MAX_BUDGET_MS = budget(5, 12); // measured ~2.4ms max @5k local
const CULLING_AVG_BUDGET_MS = budget(0.1, 0.4); // measured ~0.03-0.045ms avg @5k local
const CULLING_MAX_BUDGET_MS = budget(0.5, 2); // measured ~0.2ms max @5k local

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
  //
  // The `avg` budgets are the real O(N)-regression tripwire and gate everywhere:
  // a reintroduced O(N) hot path at 5k nodes lands ~10x over even the CI budget,
  // which a single frame's noise can't fake. The `max` budgets are single-frame
  // worst-case and are dominated by GC pauses / first-frame JIT on GitHub's
  // shared runners — a lone GC blip (e.g. a 21ms flush spike while avg stays
  // <1ms) is noise, not a regression. So `max` is asserted locally only; under
  // CI it is measured and logged (see the console.log above) but does not gate.
  expect(flushAvg, `flush avg ${flushAvg.toFixed(2)}ms`).toBeLessThanOrEqual(FLUSH_AVG_BUDGET_MS);
  expect(cullingAvg, `updateCulling avg ${cullingAvg.toFixed(2)}ms`).toBeLessThanOrEqual(CULLING_AVG_BUDGET_MS);
  if (!CI) {
    expect(flushMax, `flush max ${flushMax.toFixed(2)}ms`).toBeLessThanOrEqual(FLUSH_MAX_BUDGET_MS);
    expect(cullingMax, `updateCulling max ${cullingMax.toFixed(2)}ms`).toBeLessThanOrEqual(CULLING_MAX_BUDGET_MS);
  }
});
