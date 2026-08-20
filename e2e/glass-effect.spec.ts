import { expect, test, type Page } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

/**
 * Visual coverage for the live Glass material (plan 023).
 *
 * The whole point of this feature is that the backdrop is *live* — sampled
 * from the pixels already drawn below the node on every render pass — rather
 * than a one-time `renderer.extract` snapshot. Two properties are therefore
 * not merely nice-to-have, they are the reason the renderer was rewritten,
 * and each has a dedicated test below:
 *
 *  - changing the backdrop, without touching the glass node at all, must
 *    change the glass pixels (the old baked path went stale here);
 *  - content drawn ABOVE the glass node must never appear in its backdrop
 *    (the old path snapshotted the whole stage with only the glass node
 *    hidden, so higher siblings leaked in).
 *
 * These are pixel *assertions*, not committed golden images. Goldens across
 * GPU vendors and a software CI renderer would need a threshold wide enough
 * to stop catching the things this file exists to catch; the comparative
 * assertions here (with vs. without an effect, parameter 0 vs. 1) cancel out
 * renderer-specific constants instead. Same reasoning as
 * `raster-cache-correctness.spec.ts`, whose `samplePixel` helper this reuses.
 */

type RGBA = [number, number, number, number];

/**
 * Wait long enough for a store flush + a render to land on the canvas.
 *
 * Not reducible to an observable-state poll: the render scheduler
 * (src/pixi/renderScheduler.ts) intentionally keeps rendering for a trailing
 * debounce window (120-300ms) after the triggering signal to catch
 * debounced re-renders and async rasterization, and nothing is exposed to
 * the page for e2e to poll "that window has elapsed" other than time itself.
 * PAINT_MS outlasts that window; every use below is annotated accordingly.
 */
const PAINT_MS = 250;

/**
 * Read points off the REAL canvas, in scene coordinates.
 *
 * Deliberately not `renderer.extract.pixels()` — the helper the rest of this
 * repo's pixel specs use. `extract` renders the target into an offscreen
 * render target, and a `blendRequired` filter gets no usable back texture
 * there: the material surface comes out fully transparent and the raw
 * backdrop shows through, so every glass parameter measures as a no-op while
 * the on-screen render is in fact correct. Verified by comparing canvas
 * screenshots across a parameter change. So: force a render and read the live
 * drawing buffer instead, synchronously in one task (the buffer is still
 * valid at that point even though `preserveDrawingBuffer` is off).
 *
 * Scene coordinates map 1:1 to CSS pixels here because every test pins the
 * viewport to `{ scale: 1, x: 0, y: 0 }`; the backing store is that times the
 * renderer resolution.
 */
async function samplePoints(page: Page, points: { x: number; y: number }[]): Promise<RGBA[]> {
  return page.evaluate((points) => {
    const refs = (
      window as unknown as {
        __canvasRefStore: {
          getState: () => {
            pixiRefs: {
              app: { render: () => void; canvas: CanvasImageSource; renderer: { resolution: number } };
            } | null;
          };
        };
      }
    ).__canvasRefStore.getState().pixiRefs;
    if (!refs) throw new Error("pixiRefs not ready");
    const app = refs.app;
    app.render();
    const res = app.renderer.resolution;
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const ctx = scratch.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    return points.map(({ x, y }) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(app.canvas, Math.round(x * res), Math.round(y * res), 1, 1, 0, 0, 1, 1);
      const p = ctx.getImageData(0, 0, 1, 1).data;
      return [p[0], p[1], p[2], p[3]] as [number, number, number, number];
    });
  }, points);
}

async function samplePixel(page: Page, x: number, y: number): Promise<RGBA> {
  const [sample] = await samplePoints(page, [{ x, y }]);
  return sample;
}

/** Sample a horizontal run of points at 1px scene resolution. */
async function scanRow(page: Page, xs: number[], y: number): Promise<RGBA[]> {
  return samplePoints(page, xs.map((x) => ({ x, y })));
}

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

/** Largest per-channel difference between two equally-long scans. */
function maxScanDistance(a: RGBA[], b: RGBA[]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, rgbDistance(a[i], b[i]));
  return worst;
}

/** Largest absolute per-channel difference between two samples (alpha ignored). */
function rgbDistance(a: RGBA, b: RGBA): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** Spread between the R, G and B channels of one sample. */
function channelSpread(c: RGBA): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

type SceneNodeInit = Record<string, unknown> & { id: string };

/**
 * Replace the whole scene with a flat list of root-level nodes, in the given
 * z-order (first = bottom). Mirrors the direct-store seeding in
 * `raster-cache-correctness.spec.ts` — no UI driving, so the assertions are
 * about the renderer and nothing else.
 */
async function seedScene(page: Page, nodes: SceneNodeInit[]): Promise<void> {
  await page.evaluate((nodes) => {
    const w = window as unknown as {
      __sceneStore: { setState: (state: unknown) => void };
      __viewportStore: {
        getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void };
      };
    };
    const nodesById: Record<string, unknown> = {};
    const parentById: Record<string, unknown> = {};
    const childrenById: Record<string, string[]> = {};
    for (const node of nodes) {
      nodesById[node.id] = node;
      parentById[node.id] = null;
      childrenById[node.id] = [];
    }
    w.__sceneStore.setState({
      nodesById,
      parentById,
      childrenById,
      rootIds: nodes.map((n) => n.id),
      _cachedTree: null,
    });
    w.__viewportStore.getState().setViewportState({ scale: 1, x: 0, y: 0 });
  }, nodes);
  // eslint-disable-next-line playwright/no-wait-for-timeout -- outlasts renderScheduler's internal trailing debounce window (120-300ms); see PAINT_MS doc comment above
  await page.waitForTimeout(PAINT_MS);
}

async function updateNode(page: Page, id: string, updates: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ id, updates }) => {
      (
        window as unknown as {
          __sceneStore: {
            getState: () => { updateNode: (id: string, u: Record<string, unknown>) => void };
          };
        }
      ).__sceneStore.getState().updateNode(id, updates);
    },
    { id, updates },
  );
  // eslint-disable-next-line playwright/no-wait-for-timeout -- outlasts renderScheduler's internal trailing debounce window (120-300ms); see PAINT_MS doc comment above
  await page.waitForTimeout(PAINT_MS);
}

async function openEditor(page: Page): Promise<void> {
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [], default: null } }));
  // The raster cache bakes quiet frames to a static texture; a baked backdrop
  // would defeat the very liveness these tests assert. Off for this suite.
  await page.addInitScript(() => localStorage.setItem("pen.rasterCache", "off"));
  await page.goto("/app");
  await expectEditorMounted(page);
}

/** A backdrop of alternating columns — high-frequency content, so frost and
 *  refraction both have something measurable to act on. */
function stripeNodes(width = 50, light = "#ffffff", dark = "#101010"): SceneNodeInit[] {
  const stripes: SceneNodeInit[] = [];
  for (let i = 0; i * width < 700; i++) {
    stripes.push({
      id: `stripe-${i}`,
      type: "rect",
      name: `Stripe ${i}`,
      x: i * width,
      y: 0,
      width,
      height: 400,
      fill: i % 2 === 0 ? light : dark,
    });
  }
  return stripes;
}

const GLASS_DEFAULTS = {
  type: "glass",
  id: "glass-1",
  lightAngle: 135,
  lightIntensity: 0.5,
  refraction: 0.35,
  depth: 12,
  dispersion: 0.15,
  frost: 8,
  splay: 0.4,
  // Explicit, not omitted: a missing `vibrancy` normalizes to the 0.5
  // default (see `normalizeGlassEffect`), which would silently exercise the
  // saturation + S-curve path in every case below, including the baselines
  // that zero every other parameter specifically to isolate one effect.
  vibrancy: 0,
};

function glassCard(overrides: Record<string, unknown> = {}): SceneNodeInit {
  return {
    id: "card",
    type: "rect",
    name: "Glass card",
    x: 150,
    y: 100,
    width: 200,
    height: 160,
    cornerRadius: 24,
    // A near-transparent tint: an opaque fill would (correctly) hide the
    // material entirely, which is what `hasOpaqueEffectiveFill` guards.
    fill: "#ffffff14",
    effects: [{ ...GLASS_DEFAULTS, ...overrides }],
  };
}

// Sample points, in scene coordinates. The card spans x 150..350, y 100..260.
const CARD_CENTER = { x: 250, y: 180 };
// A run just inside the left edge: this is the band where the surface normal
// bends, so it is where refraction/dispersion/specular actually do anything.
// Scanned as a run rather than probed at one "magic" pixel, so an assertion
// can't pass or fail on exactly which stripe one coordinate happens to land in.
const EDGE_BAND_XS = range(152, 176);
// Far enough from every edge that `h` is 0 for any depth used here, so the
// backdrop must come through undisplaced.
const FLAT_BAND_XS = range(215, 235);
const BAND_Y = 180;

test.describe("live glass material", () => {
  test("backdrop changes repaint the glass without the glass node changing", async ({ page }) => {
    await openEditor(page);
    await seedScene(page, [
      { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#2060c0" },
      glassCard(),
    ]);

    const before = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);

    // Mutate ONLY the backdrop. The glass node's own effects, size and shape
    // are untouched, so the old baked implementation had no signal to rebake
    // and kept showing blue here.
    await updateNode(page, "bg", { fill: "#c02020" });
    const after = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);

    expect(rgbDistance(before, after)).toBeGreaterThan(30);
    // And it followed the backdrop's direction: red channel up, blue down.
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[2]).toBeLessThan(before[2]);
  });

  test("content above the glass node never enters its backdrop", async ({ page }) => {
    await openEditor(page);
    // The marker sits ABOVE the card in z-order and overlaps its right half.
    // With frost > 0 a backdrop that wrongly included the marker would smear
    // its colour into glass pixels just outside the overlap; a correct
    // prefix-framebuffer backdrop cannot see it at all.
    await seedScene(page, [
      { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#2060c0" },
      glassCard({ frost: 16, refraction: 0, dispersion: 0, lightIntensity: 0 }),
      { id: "marker", type: "rect", name: "Marker", x: 260, y: 90, width: 200, height: 180, fill: "#00ff00" },
    ]);

    // A point inside the card, left of the marker's edge (x=260) by more than
    // the frost radius, so only a leaked backdrop could tint it green.
    const nearMarker = await samplePixel(page, 235, 180);
    const farFromMarker = await samplePixel(page, 175, 180);

    expect(rgbDistance(nearMarker, farFromMarker)).toBeLessThan(12);
    // Explicitly: no green contamination from the layer above.
    expect(nearMarker[1] - nearMarker[2]).toBeLessThan(20);
  });

  test("refraction displaces the backdrop near the edge and leaves the centre flat", async ({ page }) => {
    await openEditor(page);
    await seedScene(page, [...stripeNodes(), glassCard({ refraction: 0, dispersion: 0, frost: 0, lightIntensity: 0 })]);
    const flatEdge = await scanRow(page, EDGE_BAND_XS, BAND_Y);
    const flatCentre = await scanRow(page, FLAT_BAND_XS, BAND_Y);

    await updateNode(page, "card", {
      effects: [{ ...GLASS_DEFAULTS, refraction: 1, dispersion: 0, frost: 0, lightIntensity: 0, depth: 40 }],
    });
    const bentEdge = await scanRow(page, EDGE_BAND_XS, BAND_Y);
    const bentCentre = await scanRow(page, FLAT_BAND_XS, BAND_Y);

    // The edge band moved onto different stripe content — and it must pull in
    // content from OUTSIDE the node's own rect, which is only possible if the
    // filter reserves padding for the displacement.
    expect(maxScanDistance(flatEdge, bentEdge)).toBeGreaterThan(60);
    // ...while the middle of the card stayed put.
    expect(maxScanDistance(flatCentre, bentCentre)).toBeLessThan(12);
  });

  test("dispersion separates the channels only when it is non-zero", async ({ page }) => {
    await openEditor(page);
    // A grey-on-grey stripe field: any channel spread in the result can only
    // have come from sampling the three channels at different points. Narrow
    // stripes so the R/G/B offsets can straddle a boundary somewhere in the
    // scanned band.
    await seedScene(page, [
      ...stripeNodes(16, "#e0e0e0", "#303030"),
      glassCard({ dispersion: 0, refraction: 1, depth: 40, frost: 0, lightIntensity: 0 }),
    ]);
    const noDispersion = await scanRow(page, EDGE_BAND_XS, BAND_Y);

    await updateNode(page, "card", {
      effects: [
        { ...GLASS_DEFAULTS, dispersion: 1, refraction: 1, depth: 40, frost: 0, lightIntensity: 0 },
      ],
    });
    const withDispersion = await scanRow(page, EDGE_BAND_XS, BAND_Y);

    const spreadWithout = Math.max(...noDispersion.map(channelSpread));
    const spreadWith = Math.max(...withDispersion.map(channelSpread));
    // A grey backdrop sampled at one point per channel cannot produce colour.
    expect(spreadWithout).toBeLessThan(10);
    expect(spreadWith).toBeGreaterThan(spreadWithout + 20);
  });

  test("vibrancy saturates the backdrop sampled through the glass", async ({ page }) => {
    await openEditor(page);
    // A flat, moderately-saturated backdrop: any increase in channel spread
    // at the sample point can only come from the vibrancy saturation boost,
    // not from stripe boundaries or displacement (refraction/dispersion/frost
    // are all zeroed so only vibrancy can move the pixel).
    await seedScene(page, [
      { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#4060a0" },
      glassCard({ vibrancy: 0, refraction: 0, dispersion: 0, frost: 0, lightIntensity: 0 }),
    ]);
    const unsaturated = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);

    await updateNode(page, "card", {
      effects: [{ ...GLASS_DEFAULTS, vibrancy: 1, refraction: 0, dispersion: 0, frost: 0, lightIntensity: 0 }],
    });
    const saturated = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);

    expect(channelSpread(saturated)).toBeGreaterThan(channelSpread(unsaturated) + 10);
  });

  test("frost smooths a high-contrast backdrop measurably", async ({ page }) => {
    await openEditor(page);
    await seedScene(page, [
      ...stripeNodes(),
      glassCard({ frost: 0, refraction: 0, dispersion: 0, lightIntensity: 0 }),
    ]);
    // Two points straddling a stripe boundary at x=250, both well inside the
    // card: a sharp backdrop keeps them far apart in value.
    const sharp = await scanRow(page, [245, 255], BAND_Y);
    const sharpGap = rgbDistance(sharp[0], sharp[1]);

    await updateNode(page, "card", {
      effects: [{ ...GLASS_DEFAULTS, frost: 24, refraction: 0, dispersion: 0, lightIntensity: 0 }],
    });
    const soft = await scanRow(page, [245, 255], BAND_Y);

    expect(sharpGap).toBeGreaterThan(150);
    expect(rgbDistance(soft[0], soft[1])).toBeLessThan(sharpGap / 2);
  });

  test("light angle moves the brightest edge region", async ({ page }) => {
    await openEditor(page);
    const dark = { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#101010" };
    const lit = { lightIntensity: 1, splay: 0, refraction: 0, dispersion: 0, frost: 0 };
    // 3px inside each edge: `depth` is 12, so the specular weight is still
    // strong there, and a flat dark backdrop makes the highlight the only
    // thing that can brighten the pixel.
    const probes = [
      { x: 153, y: BAND_Y }, // left edge
      { x: 347, y: BAND_Y }, // right edge
    ];

    await seedScene(page, [dark, glassCard({ ...lit, lightAngle: 180 })]);
    const [leftWhenLit, rightWhenDark] = await samplePoints(page, probes);

    await updateNode(page, "card", { effects: [{ ...GLASS_DEFAULTS, ...lit, lightAngle: 0 }] });
    const [leftWhenDark, rightWhenLit] = await samplePoints(page, probes);

    // Whichever edge faces the light is the brighter one, and swapping the
    // angle swaps which edge that is.
    expect(leftWhenLit[0]).toBeGreaterThan(rightWhenDark[0] + 25);
    expect(rightWhenLit[0]).toBeGreaterThan(leftWhenDark[0] + 25);
  });

  test("removing the effect leaves the node rendering and drops the material surface", async ({ page }) => {
    await openEditor(page);
    await seedScene(page, [
      { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#2060c0" },
      glassCard(),
    ]);
    expect(await hasMaterialSurface(page, "card")).toBe(true);

    await updateNode(page, "card", { effects: [], fill: "#ff8800" });

    expect(await hasMaterialSurface(page, "card")).toBe(false);
    const centre = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);
    // The node itself still paints — removing an effect must not remove the node.
    expect(centre[0]).toBeGreaterThan(200);
    expect(centre[1]).toBeGreaterThan(100);
    expect(centre[2]).toBeLessThan(80);
  });

  test("rotated, elliptical and nested glass nodes render stably across repeated renders", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(
      ({ glass }) => {
        const w = window as unknown as {
          __sceneStore: { setState: (state: unknown) => void };
          __viewportStore: {
            getState: () => {
              setViewportState: (s: { scale: number; x: number; y: number }) => void;
            };
          };
        };
        const bg = { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 700, height: 500, fill: "#2060c0" };
        const rotated = {
          id: "rotated", type: "rect", name: "Rotated", x: 60, y: 60, width: 140, height: 100,
          rotation: 30, cornerRadius: 16, fill: "#ffffff14", effects: [glass],
        };
        const ellipse = {
          id: "ellipse", type: "ellipse", name: "Ellipse", x: 260, y: 60, width: 140, height: 120,
          fill: "#ffffff14", effects: [glass],
        };
        const outer = {
          id: "outer", type: "frame", name: "Outer", x: 60, y: 260, width: 300, height: 200,
          fill: "#804020", clipsContent: true,
        };
        const inner = {
          id: "inner", type: "rect", name: "Inner glass", x: 40, y: 40, width: 160, height: 120,
          cornerRadius: 20, fill: "#ffffff14", effects: [glass],
        };
        w.__sceneStore.setState({
          nodesById: { bg, rotated, ellipse, outer, inner },
          parentById: { bg: null, rotated: null, ellipse: null, outer: null, inner: "outer" },
          childrenById: { bg: [], rotated: [], ellipse: [], outer: ["inner"], inner: [] },
          rootIds: ["bg", "rotated", "ellipse", "outer"],
          _cachedTree: null,
        });
        w.__viewportStore.getState().setViewportState({ scale: 1, x: 0, y: 0 });
      },
      { glass: GLASS_DEFAULTS },
    );
    // eslint-disable-next-line playwright/no-wait-for-timeout -- outlasts renderScheduler's internal trailing debounce window (120-300ms); see PAINT_MS doc comment above
    await page.waitForTimeout(PAINT_MS);

    // One sample inside each family, taken twice with a render in between:
    // a filter whose uniforms depend on stale per-frame state (bounds, world
    // transform) drifts between two renders of an unchanged scene.
    const points = [
      { x: 120, y: 115 }, // rotated rect
      { x: 330, y: 120 }, // ellipse
      { x: 180, y: 360 }, // glass nested in a clipping frame
    ];
    const first = await Promise.all(points.map((p) => samplePixel(page, p.x, p.y)));
    // eslint-disable-next-line playwright/no-wait-for-timeout -- outlasts renderScheduler's internal trailing debounce window (120-300ms); see PAINT_MS doc comment above
    await page.waitForTimeout(PAINT_MS);
    const second = await Promise.all(points.map((p) => samplePixel(page, p.x, p.y)));

    for (let i = 0; i < points.length; i++) {
      expect(rgbDistance(first[i], second[i])).toBeLessThanOrEqual(2);
      // Each sample must actually be glass over the backdrop, not a hole.
      expect(first[i][3]).toBeGreaterThan(200);
    }
  });

  test("an extract-based export degrades to no material, never to a black box", async ({ page }) => {
    // `renderer.extract` renders into a detached target where a
    // `blendRequired` filter gets no backdrop (Pixi hands it `Texture.EMPTY`).
    // Sampling that empty texture and compositing it would paint an opaque
    // black rectangle — which is what `get_screenshot`, PNG/PDF export and
    // thumbnail capture would then write out. The filter must recognise the
    // empty backdrop and draw nothing instead, so an export loses the effect
    // but still shows the node's own fill over the real background.
    await openEditor(page);
    await seedScene(page, [
      { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#ffffff" },
      glassCard({ frost: 40, refraction: 0, dispersion: 0, lightIntensity: 0 }),
    ]);

    const exported = await page.evaluate(() => {
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
      const RectangleCtor = (
        window as unknown as { __PixiRectangle: new (x: number, y: number, w: number, h: number) => unknown }
      ).__PixiRectangle;
      const { pixels } = refs.app.renderer.extract.pixels({
        target: refs.sceneRoot,
        frame: new RectangleCtor(250, 180, 1, 1),
      });
      return [pixels[0], pixels[1], pixels[2], pixels[3]] as [number, number, number, number];
    });

    // Over a white background with only a #ffffff14 tint on the card, the
    // exported pixel must stay near-white. A black box reads ~20.
    expect(exported[0]).toBeGreaterThan(200);
    expect(exported[1]).toBeGreaterThan(200);
    expect(exported[2]).toBeGreaterThan(200);
  });

  test("migrated background blur is live too", async ({ page }) => {
    await openEditor(page);
    await seedScene(page, [
      { id: "bg", type: "rect", name: "Backdrop", x: 0, y: 0, width: 600, height: 400, fill: "#2060c0" },
      {
        id: "card", type: "rect", name: "Blur card", x: 150, y: 100, width: 200, height: 160,
        cornerRadius: 24, fill: "#ffffff14",
        effects: [{ type: "background-blur", radius: 16, id: "bb-1" }],
      },
    ]);
    const before = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);

    await updateNode(page, "bg", { fill: "#c02020" });
    const after = await samplePixel(page, CARD_CENTER.x, CARD_CENTER.y);

    expect(rgbDistance(before, after)).toBeGreaterThan(30);
    expect(after[0]).toBeGreaterThan(before[0]);
  });
});

/** Whether the node's Pixi container currently carries a material surface child. */
async function hasMaterialSurface(page: Page, nodeId: string): Promise<boolean> {
  return page.evaluate((nodeId) => {
    const refs = (
      window as unknown as {
        __canvasRefStore: {
          getState: () => {
            pixiRefs: {
              sceneRoot: { getChildByLabel: (l: string, deep?: boolean) => unknown };
            } | null;
          };
        };
      }
    ).__canvasRefStore.getState().pixiRefs;
    if (!refs) throw new Error("pixiRefs not ready");
    const container = refs.sceneRoot.getChildByLabel(nodeId, true) as {
      getChildByLabel: (l: string) => unknown;
    } | null;
    if (!container) throw new Error(`no container for ${nodeId}`);
    return container.getChildByLabel("material-surface") != null;
  }, nodeId);
}
