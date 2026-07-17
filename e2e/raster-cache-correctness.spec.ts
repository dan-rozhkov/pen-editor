import { expect, test, type Page } from "@playwright/test";

// Task 13's correctness matrix: raster caching of quiet top-level frames must
// never show a stale texture after a mutation/reparent/undo lands inside a
// cached subtree, and zooming into a bucket change must stay pixel-identical
// to the flag-off (uncached) baseline. QUIET_MS (rasterCache.ts) is 500ms and
// the decision round runs every 600ms, so > 1.1s settles a cache; we use 1.5s
// for margin, matching pixi-large-document-performance.spec.ts's convention.
const SETTLE_MS = 1500;
// Long enough for the RAF flush + a render to land, short enough that the
// quiet timer (500ms) + decision round (600ms) hasn't fired again yet — so a
// pass here can only be explained by the manager's synchronous uncache, not
// by the periodic decision round happening to also uncache in time.
const FRESH_PAINT_MS = 200;

type RGBA = [number, number, number, number];

async function samplePixel(page: Page, x: number, y: number): Promise<RGBA> {
  return page.evaluate(({ x, y }) => {
    const refs = (
      window as unknown as {
        __canvasRefStore: {
          getState: () => {
            pixiRefs: {
              app: { renderer: { extract: { pixels: (o: unknown) => { pixels: Uint8ClampedArray } } } };
              sceneRoot: unknown;
            } | null;
          };
        };
      }
    ).__canvasRefStore.getState().pixiRefs;
    if (!refs) throw new Error("pixiRefs not ready");
    const RectangleCtor = (window as unknown as { __PixiRectangle: new (x: number, y: number, w: number, h: number) => unknown }).__PixiRectangle;
    // Sample a small block (avoids landing on a single antialiased edge texel)
    // and average it — extract.pixels works off the renderer's own texture
    // read-back, independent of the canvas's preserveDrawingBuffer setting.
    const { pixels } = refs.app.renderer.extract.pixels({
      target: refs.sceneRoot,
      frame: new RectangleCtor(x - 2, y - 2, 4, 4),
    });
    let r = 0, g = 0, b = 0, a = 0;
    const n = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; a += pixels[i + 3];
    }
    return [r / n, g / n, b / n, a / n] as [number, number, number, number];
  }, { x, y });
}

function isCloseTo(actual: RGBA, expected: RGBA, tolerance = 20): boolean {
  return actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
}

async function seedMutateReparentScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore: { setState: (state: unknown) => void };
      __viewportStore: { getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void } };
    };
    const frameA = {
      id: "frame-a", type: "frame", name: "Frame A",
      x: 0, y: 0, width: 300, height: 300, fill: "#ffffff",
    };
    const rectR = {
      id: "rect-r", type: "rect", name: "Rect R",
      x: 50, y: 50, width: 100, height: 100, fill: "#0000ff",
    };
    const frameB = {
      id: "frame-b", type: "frame", name: "Frame B",
      x: 400, y: 0, width: 300, height: 300, fill: "#ffffff",
    };
    w.__sceneStore.setState({
      nodesById: { [frameA.id]: frameA, [rectR.id]: rectR, [frameB.id]: frameB },
      parentById: { [frameA.id]: null, [rectR.id]: frameA.id, [frameB.id]: null },
      childrenById: { [frameA.id]: [rectR.id], [rectR.id]: [], [frameB.id]: [] },
      rootIds: [frameA.id, frameB.id],
      _cachedTree: null,
    });
    w.__viewportStore.getState().setViewportState({ scale: 1, x: 0, y: 0 });
  });
}

test.describe("raster cache correctness (Task 13)", () => {
  test("mutate inside a cached frame shows fresh pixels, not a stale texture", async ({ page }) => {
    await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
    await page.addInitScript(() => localStorage.setItem("pen.rasterCache", "on"));
    await page.goto("/");
    await expect(page.locator("[data-canvas]")).toBeVisible();
    await seedMutateReparentScene(page);

    // Let frame-a's subtree go quiet so the manager caches it.
    await page.waitForTimeout(SETTLE_MS);
    let center = await samplePixel(page, 100, 100);
    expect(isCloseTo(center, [0, 0, 255, 255])).toBe(true); // blue rect, pre-mutation

    // Mutate the rect's fill inside the (now cached) frame-a.
    await page.evaluate(() => {
      (window as unknown as { __sceneStore: { getState: () => { updateNode: (id: string, u: object) => void } } })
        .__sceneStore.getState().updateNode("rect-r", { fill: "#ff0000" });
    });
    await page.waitForTimeout(FRESH_PAINT_MS);
    center = await samplePixel(page, 100, 100);
    expect(isCloseTo(center, [255, 0, 0, 255])).toBe(true); // red — no stale blue ghost
  });

  test("reparent A -> B: node disappears from A, appears (with its latest fill) in B", async ({ page }) => {
    await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
    await page.addInitScript(() => localStorage.setItem("pen.rasterCache", "on"));
    await page.goto("/");
    await expect(page.locator("[data-canvas]")).toBeVisible();
    await seedMutateReparentScene(page);

    await page.waitForTimeout(SETTLE_MS); // both frame-a and frame-b cache
    await page.evaluate(() => {
      (window as unknown as { __sceneStore: { getState: () => { updateNode: (id: string, u: object) => void } } })
        .__sceneStore.getState().updateNode("rect-r", { fill: "#ff0000" });
    });
    await page.waitForTimeout(SETTLE_MS); // re-settle, both frames cached again with the red rect in A

    await page.evaluate(() => {
      (window as unknown as { __sceneStore: { getState: () => { moveNode: (id: string, parentId: string | null, index: number) => void } } })
        .__sceneStore.getState().moveNode("rect-r", "frame-b", 0);
    });
    await page.waitForTimeout(FRESH_PAINT_MS);

    const inA = await samplePixel(page, 100, 100); // frame-a's rect region — now empty
    const inB = await samplePixel(page, 500, 100); // frame-b's rect region — frame-b.x(400) + rect.x(50..150)
    expect(isCloseTo(inA, [255, 255, 255, 255])).toBe(true); // frame-a background, not a ghost of the rect
    expect(isCloseTo(inB, [255, 0, 0, 255])).toBe(true); // the rect, in its latest (red) fill
  });

  test("revert (undo-equivalent) restores the original pixels", async ({ page }) => {
    await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
    await page.addInitScript(() => localStorage.setItem("pen.rasterCache", "on"));
    await page.goto("/");
    await expect(page.locator("[data-canvas]")).toBeVisible();
    await seedMutateReparentScene(page);

    await page.waitForTimeout(SETTLE_MS);
    await page.evaluate(() => {
      (window as unknown as { __sceneStore: { getState: () => { updateNode: (id: string, u: object) => void } } })
        .__sceneStore.getState().updateNode("rect-r", { fill: "#ff0000" });
    });
    await page.waitForTimeout(SETTLE_MS); // re-cache with the red fill

    await page.evaluate(() => {
      (window as unknown as { __sceneStore: { getState: () => { updateNode: (id: string, u: object) => void } } })
        .__sceneStore.getState().updateNode("rect-r", { fill: "#0000ff" }); // revert
    });
    await page.waitForTimeout(FRESH_PAINT_MS);
    const center = await samplePixel(page, 100, 100);
    expect(isCloseTo(center, [0, 0, 255, 255])).toBe(true); // back to the original blue
  });

  async function zoomSharpnessPixel(page: Page, rasterCacheFlag: "on" | "off"): Promise<RGBA> {
    await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
    await page.addInitScript((flag) => localStorage.setItem("pen.rasterCache", flag), rasterCacheFlag);
    await page.goto("/");
    await expect(page.locator("[data-canvas]")).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as {
        __sceneStore: { setState: (state: unknown) => void };
        __viewportStore: { getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void } };
      };
      // Small frame — stays within MAX_TEXTURE_PX even once (viewport scale *
      // resolution bucket) is applied at scale 3 / bucket 4 (rasterCache.ts).
      const frameZ = {
        id: "frame-z", type: "frame", name: "Frame Z",
        x: 0, y: 0, width: 120, height: 60, fill: "#ffffff",
      };
      const textT = {
        id: "text-t", type: "text", name: "Text T",
        x: 10, y: 10, width: 100, height: 40,
        text: "Zoom", fontSize: 24, fill: "#000000",
      };
      w.__sceneStore.setState({
        nodesById: { [frameZ.id]: frameZ, [textT.id]: textT },
        parentById: { [frameZ.id]: null, [textT.id]: frameZ.id },
        childrenById: { [frameZ.id]: [textT.id], [textT.id]: [] },
        rootIds: [frameZ.id],
        _cachedTree: null,
      });
      w.__viewportStore.getState().setViewportState({ scale: 1, x: 0, y: 0 });
    });
    await page.waitForTimeout(SETTLE_MS); // settle + cache at bucket 1

    await page.evaluate(() => {
      (window as unknown as { __viewportStore: { getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void } } })
        .__viewportStore.getState().setViewportState({ scale: 3, x: 0, y: 0 });
    });
    await page.waitForTimeout(SETTLE_MS * 2); // uncache-on-bucket-change round, then re-cache-at-new-bucket round

    // Sample inside a text glyph stroke — a stale low-res (bucket 1) texture
    // stretched/resampled up to bucket 4 would blur the edge; sampling right
    // on a glyph edge is where that blur shows up as an intermediate gray
    // rather than a crisp black/white transition.
    return samplePixel(page, 20, 25);
  }

  test("zoom bucket change stays sharp — flag on matches flag off pixel-for-pixel", async ({ page, browser }) => {
    const onPixel = await zoomSharpnessPixel(page, "on");
    const offPage = await browser.newPage();
    const offPixel = await zoomSharpnessPixel(offPage, "off");
    await offPage.close();

    expect(isCloseTo(onPixel, offPixel, 8)).toBe(true);
  });

  // The classic historical bug: a variable/theme edit recolors containers
  // directly (incrementalThemeUpdate's THEME_SENTINEL pass) with no scene
  // mutation at all, so a cached top frame never saw a SceneDiff telling it
  // to drop its texture. Regression-tests rasterCacheManager.onDirectContainerMutation.
  test("variable edit inside a cached frame shows fresh pixels, not a stale texture", async ({ page }) => {
    await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
    await page.addInitScript(() => localStorage.setItem("pen.rasterCache", "on"));
    await page.goto("/");
    await expect(page.locator("[data-canvas]")).toBeVisible();

    await page.evaluate(() => {
      const w = window as unknown as {
        __sceneStore: { setState: (state: unknown) => void };
        __variableStore: { getState: () => { addVariable: (v: object) => void } };
        __viewportStore: { getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void } };
      };
      w.__variableStore.getState().addVariable({
        id: "var-fill-1", name: "Test Color", type: "color", value: "#0000ff",
      });
      const frameV = {
        id: "frame-v", type: "frame", name: "Frame V",
        x: 0, y: 0, width: 200, height: 200, fill: "#ffffff",
      };
      const rectV = {
        id: "rect-v", type: "rect", name: "Rect V",
        x: 50, y: 50, width: 100, height: 100,
        fill: "#0000ff", fillBinding: { variableId: "var-fill-1" },
      };
      w.__sceneStore.setState({
        nodesById: { [frameV.id]: frameV, [rectV.id]: rectV },
        parentById: { [frameV.id]: null, [rectV.id]: frameV.id },
        childrenById: { [frameV.id]: [rectV.id], [rectV.id]: [] },
        rootIds: [frameV.id],
        _cachedTree: null,
      });
      w.__viewportStore.getState().setViewportState({ scale: 1, x: 0, y: 0 });
    });

    await page.waitForTimeout(SETTLE_MS); // frame-v goes quiet and caches
    let center = await samplePixel(page, 100, 100);
    expect(isCloseTo(center, [0, 0, 255, 255])).toBe(true); // blue, pre-edit

    // Edit the bound variable — no scene mutation, so no SceneDiff.
    await page.evaluate(() => {
      (window as unknown as { __variableStore: { getState: () => { updateVariable: (id: string, u: object) => void } } })
        .__variableStore.getState().updateVariable("var-fill-1", { value: "#ff0000" });
    });
    await page.waitForTimeout(FRESH_PAINT_MS);
    center = await samplePixel(page, 100, 100);
    expect(isCloseTo(center, [255, 0, 0, 255])).toBe(true); // red — no stale blue ghost
  });
});
