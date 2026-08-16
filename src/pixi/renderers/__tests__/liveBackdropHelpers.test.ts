import { describe, it, expect, afterEach } from "vitest";
import { Container, Graphics } from "pixi.js";
import {
  applyMaterialSurface,
  destroyMaterialSurface,
  resizeMaterialSurface,
  shouldUpdateMaterialSurface,
  ensureMaterialDestroyHook,
  backgroundBlurToGlassEffect,
} from "../liveBackdropHelpers";
import { GlassBackdropFilter } from "../filters/GlassBackdropFilter";
import { useCanvasRefStore, type PixiExportRefs } from "@/store/canvasRefStore";
import type { Effect, FlatSceneNode } from "@/types/scene";

function rectNode(over: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 100, height: 80, ...over } as FlatSceneNode;
}

const glassEffects: Effect[] = [
  {
    type: "glass",
    lightAngle: 135,
    lightIntensity: 0.5,
    refraction: 0.35,
    depth: 12,
    dispersion: 0.15,
    frost: 8,
    splay: 0.4,
  },
];

describe("applyMaterialSurface", () => {
  it("creates exactly one material-surface child, as the first child", () => {
    const c = new Container();
    const existing = new Graphics();
    existing.label = "rect-bg";
    c.addChild(existing);

    applyMaterialSurface(c, rectNode(), glassEffects);

    const surfaces = c.children.filter((ch) => ch.label === "material-surface");
    expect(surfaces).toHaveLength(1);
    expect(c.getChildIndex(surfaces[0])).toBe(0);
    expect(surfaces[0].filters).toBeTruthy();
    expect((surfaces[0].filters as unknown[])[0]).toBeInstanceOf(GlassBackdropFilter);
    c.destroy({ children: true }); // balance the live-surface count for the Finding-D tests below
  });

  it("update with a changed size still leaves exactly one surface (no duplicate)", () => {
    const c = new Container();
    const node = rectNode();

    applyMaterialSurface(c, node, glassEffects);
    applyMaterialSurface(c, { ...node, width: 200 }, glassEffects, 200, 80);

    const surfaces = c.children.filter((ch) => ch.label === "material-surface");
    expect(surfaces).toHaveLength(1);
    c.destroy({ children: true }); // balance the live-surface count for the Finding-D tests below
  });

  it("removing the effect removes the surface without touching the node's other children", () => {
    const c = new Container();
    const other = new Graphics();
    other.label = "rect-bg";
    c.addChild(other);

    applyMaterialSurface(c, rectNode(), glassEffects);
    expect(c.getChildByLabel("material-surface")).toBeTruthy();

    applyMaterialSurface(c, rectNode(), []);

    expect(c.getChildByLabel("material-surface")).toBeNull();
    expect(c.getChildByLabel("rect-bg")).toBe(other);
  });

  it("does not render a fully-opaque no-op effect (background-blur with radius 0)", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode(), [{ type: "background-blur", radius: 0 }]);
    expect(c.getChildByLabel("material-surface")).toBeNull();
  });

  // `vibrancy` alone saturates/contrast-lifts the backdrop, so a glass whose
  // every other param is 0 is still a visible material — it must not be
  // swallowed by the no-op skip.
  it("renders a glass whose only non-zero param is vibrancy", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode(), [
      {
        type: "glass",
        id: "g-vib",
        lightAngle: 0,
        lightIntensity: 0,
        refraction: 0,
        depth: 1,
        dispersion: 0,
        frost: 0,
        splay: 0,
        vibrancy: 0.6,
      },
    ]);
    expect(c.getChildByLabel("material-surface")).toBeTruthy();
    // Keep `liveMaterialSurfaceCount` net-zero for the useBackBuffer block
    // below — see its doc comment.
    c.destroy({ children: true });
  });

  it("does not render a glass with every param, vibrancy included, at zero", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode(), [
      {
        type: "glass",
        id: "g-zero",
        lightAngle: 0,
        lightIntensity: 0,
        refraction: 0,
        depth: 1,
        dispersion: 0,
        frost: 0,
        splay: 0,
        vibrancy: 0,
      },
    ]);
    expect(c.getChildByLabel("material-surface")).toBeNull();
  });

  it("does not render for a hidden node", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode({ visible: false }), glassEffects);
    expect(c.getChildByLabel("material-surface")).toBeNull();
  });

  it("skips rendering when the node's own fill stack is provably opaque", () => {
    const c = new Container();
    const node = rectNode({ fills: [{ id: "f1", type: "solid", color: "#ffffffff" }] });
    applyMaterialSurface(c, node, glassEffects);
    expect(c.getChildByLabel("material-surface")).toBeNull();
  });
});

describe("destroyMaterialSurface", () => {
  it("is idempotent and destroys the filter", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode(), glassEffects);
    const surface = c.getChildByLabel("material-surface");
    expect(surface).toBeTruthy();
    const filter = (surface!.filters as GlassBackdropFilter[])[0];

    destroyMaterialSurface(c);
    expect(c.getChildByLabel("material-surface")).toBeNull();

    expect(() => destroyMaterialSurface(c)).not.toThrow();
    // GlassBackdropFilter.destroy() clears its surface ref — a cheap signal
    // that destroy() actually ran (Filter has no public `destroyed` flag).
    expect(filter.surface).toBeNull();
  });
});

describe("ensureMaterialDestroyHook", () => {
  it("attaches only once per container", () => {
    const c = new Container();
    ensureMaterialDestroyHook(c);
    ensureMaterialDestroyHook(c);
    expect(() => c.destroy({ children: true })).not.toThrow();
  });

  it("frees the owned filter when the container is destroyed", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode(), glassEffects);
    const surface = c.getChildByLabel("material-surface");
    const filter = (surface!.filters as GlassBackdropFilter[])[0];

    c.destroy({ children: true });

    expect(filter.surface).toBeNull();
  });
});

describe("resizeMaterialSurface", () => {
  it("redraws geometry and rewrites size/radii uniforms without creating a second surface", () => {
    const c = new Container();
    applyMaterialSurface(c, rectNode({ cornerRadius: 4 }), glassEffects);
    const surface = c.getChildByLabel("material-surface");
    const filter = (surface!.filters as GlassBackdropFilter[])[0];

    resizeMaterialSurface(c, rectNode({ cornerRadius: 4 }), 300, 150);

    expect(c.children.filter((ch) => ch.label === "material-surface")).toHaveLength(1);
    // Same filter instance kept — not recreated on a pure resize.
    expect((c.getChildByLabel("material-surface")!.filters as GlassBackdropFilter[])[0]).toBe(filter);
    c.destroy({ children: true }); // balance the live-surface count for the Finding-D tests below
  });

  it("is a no-op when there is no active material surface", () => {
    const c = new Container();
    expect(() => resizeMaterialSurface(c, rectNode(), 50, 50)).not.toThrow();
    expect(c.getChildByLabel("material-surface")).toBeNull();
  });
});

describe("shouldUpdateMaterialSurface", () => {
  it("true when the effect stack changes", () => {
    const base = rectNode({ effects: glassEffects });
    expect(shouldUpdateMaterialSurface(rectNode({ effects: [] }), base)).toBe(true);
    expect(shouldUpdateMaterialSurface(base, base)).toBe(false);
  });

  it("true when width or height changes", () => {
    const base = rectNode();
    expect(shouldUpdateMaterialSurface({ ...base, width: 200 }, base)).toBe(true);
    expect(shouldUpdateMaterialSurface({ ...base, height: 200 }, base)).toBe(true);
  });

  it("true when corner radius changes", () => {
    const base = rectNode({ cornerRadius: 4 });
    expect(shouldUpdateMaterialSurface(rectNode({ cornerRadius: 8 }), base)).toBe(true);
    expect(shouldUpdateMaterialSurface(rectNode({ cornerRadius: 4 }), base)).toBe(false);
  });

  it("true when a hidden node becomes visible, false the other way / while unchanged", () => {
    const hidden = rectNode({ visible: false });
    const shown = rectNode({ visible: true });
    expect(shouldUpdateMaterialSurface(shown, hidden)).toBe(true);
    expect(shouldUpdateMaterialSurface(hidden, shown)).toBe(false);
    expect(shouldUpdateMaterialSurface(hidden, hidden)).toBe(false);
  });

  // Finding B: applyMaterialSurface gates on hasOpaqueEffectiveFill (for
  // box-filling types), so a fill-related change that flips that verdict
  // must also be a trigger — otherwise the material surface goes stale
  // relative to the very check that suppressed it.
  it("true when the fill stack (fills) changes", () => {
    const base = rectNode({ fills: [{ id: "f1", type: "solid", color: "#ffffffff" }] });
    const next = rectNode({ fills: [{ id: "f1", type: "solid", color: "#ffffff80" }] });
    expect(shouldUpdateMaterialSurface(next, base)).toBe(true);
  });

  it("true when legacy fill/fillOpacity/fillBinding/gradientFill change", () => {
    const base = rectNode({ fill: "#ffffff" });
    expect(shouldUpdateMaterialSurface(rectNode({ fill: "#000000" }), base)).toBe(true);
    expect(shouldUpdateMaterialSurface(rectNode({ fill: "#ffffff", fillOpacity: 0.5 }), base)).toBe(true);
    expect(shouldUpdateMaterialSurface(rectNode({ fill: "#ffffff", fillBinding: { variableId: "v1" } }), base)).toBe(
      true,
    );
    expect(
      shouldUpdateMaterialSurface(
        rectNode({
          fill: "#ffffff",
          gradientFill: { type: "linear", stops: [], startX: 0, startY: 0, endX: 1, endY: 1 },
        }),
        base,
      ),
    ).toBe(true);
    expect(shouldUpdateMaterialSurface(base, base)).toBe(false);
  });

  it("true when node opacity changes", () => {
    const base = rectNode({ opacity: 1 });
    expect(shouldUpdateMaterialSurface(rectNode({ opacity: 0.5 }), base)).toBe(true);
    expect(shouldUpdateMaterialSurface(base, base)).toBe(false);
  });
});

describe("applyMaterialSurface + fill-opacity gating (Finding B, integration)", () => {
  it("an opaque fill dropping to partial alpha brings the material surface back without a resize/effect-toggle", () => {
    const c = new Container();
    const opaque = rectNode({ fills: [{ id: "f1", type: "solid", color: "#ffffffff" }] });
    applyMaterialSurface(c, opaque, glassEffects);
    expect(c.getChildByLabel("material-surface")).toBeNull();

    const translucent = rectNode({ fills: [{ id: "f1", type: "solid", color: "#ffffff80" }] });
    expect(shouldUpdateMaterialSurface(translucent, opaque)).toBe(true);
    applyMaterialSurface(c, translucent, glassEffects);
    expect(c.getChildByLabel("material-surface")).toBeTruthy();

    c.destroy({ children: true });
  });
});

describe("fillCoversNodeShape gating (Finding C)", () => {
  it("a black-filled text node still gets a material surface (fill is glyph colour, not a background)", () => {
    const c = new Container();
    const textNode = {
      id: "t1",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      fills: [{ id: "f1", type: "solid", color: "#000000ff" }],
    } as unknown as FlatSceneNode;

    applyMaterialSurface(c, textNode, glassEffects);

    expect(c.getChildByLabel("material-surface")).toBeTruthy();
    c.destroy({ children: true });
  });

  it("an opaque-filled rect (a genuine box background) is still suppressed", () => {
    const c = new Container();
    const opaqueRect = rectNode({ fills: [{ id: "f1", type: "solid", color: "#000000ff" }] });
    applyMaterialSurface(c, opaqueRect, glassEffects);
    expect(c.getChildByLabel("material-surface")).toBeNull();
  });
});

// Finding D: `renderer.backBuffer.useBackBuffer` is ref-counted by live
// material-surface count, not left on unconditionally. `liveMaterialSurfaceCount`
// is a module-private singleton shared by the WHOLE test file, so every test
// above that creates a surface is careful to also destroy its container —
// see the `c.destroy({ children: true })` calls added alongside this finding.
// That keeps the count net-zero entering this block, but the invariant this
// test actually leans on is ambient-independent: "at least one live surface
// implies the flag is true" holds regardless of what any other test left
// behind; only the final "back to false" assertion assumes a net-zero
// baseline.
describe("useBackBuffer gating (Finding D)", () => {
  function fakePixiRefs(): { refs: PixiExportRefs; renderer: { backBuffer: { useBackBuffer: boolean } } } {
    const renderer = { backBuffer: { useBackBuffer: false } };
    const refs = { app: { renderer } } as unknown as PixiExportRefs;
    return { refs, renderer };
  }

  afterEach(() => {
    useCanvasRefStore.getState().setPixiRefs(null);
  });

  it("flips useBackBuffer on while >=1 material surface is live, and off once the last one is gone", () => {
    const { refs, renderer } = fakePixiRefs();
    useCanvasRefStore.getState().setPixiRefs(refs);
    expect(renderer.backBuffer.useBackBuffer).toBe(false);

    const c1 = new Container();
    applyMaterialSurface(c1, rectNode(), glassEffects);
    // Ambient-independent: a live surface exists, so the flag must be true.
    expect(renderer.backBuffer.useBackBuffer).toBe(true);

    const c2 = new Container();
    applyMaterialSurface(c2, rectNode(), glassEffects);
    expect(renderer.backBuffer.useBackBuffer).toBe(true);

    destroyMaterialSurface(c1);
    // c2 is still live, so still ambient-independent.
    expect(renderer.backBuffer.useBackBuffer).toBe(true);

    destroyMaterialSurface(c2);
    // Assumes a net-zero baseline from every earlier test in this file.
    expect(renderer.backBuffer.useBackBuffer).toBe(false);

    c1.destroy({ children: true });
    c2.destroy({ children: true });
  });

  it("repeated applyMaterialSurface calls on an already-live surface don't re-toggle the flag off", () => {
    const { refs, renderer } = fakePixiRefs();
    useCanvasRefStore.getState().setPixiRefs(refs);

    const c = new Container();
    applyMaterialSurface(c, rectNode(), glassEffects);
    expect(renderer.backBuffer.useBackBuffer).toBe(true);

    applyMaterialSurface(c, rectNode(), glassEffects); // update, not create
    expect(renderer.backBuffer.useBackBuffer).toBe(true);

    destroyMaterialSurface(c);
    c.destroy({ children: true });
  });

  it("does not throw when no Pixi app is registered (pixiRefs is null)", () => {
    useCanvasRefStore.getState().setPixiRefs(null);
    const c = new Container();
    expect(() => applyMaterialSurface(c, rectNode(), glassEffects)).not.toThrow();
    expect(() => destroyMaterialSurface(c)).not.toThrow();
    c.destroy({ children: true });
  });
});

describe("backgroundBlurToGlassEffect", () => {
  it("pins the background-blur -> glass params mapping", () => {
    expect(backgroundBlurToGlassEffect({ type: "background-blur", radius: 12, id: "e1", visible: true })).toEqual({
      type: "glass",
      lightAngle: 0,
      lightIntensity: 0,
      refraction: 0,
      depth: 1,
      dispersion: 0,
      frost: 12,
      splay: 0,
      vibrancy: 0,
      id: "e1",
      visible: true,
    });
  });

  it("keeps vibrancy at 0 — background blur must stay a pure gaussian blur with no vibrancy lift", () => {
    expect(
      backgroundBlurToGlassEffect({ type: "background-blur", radius: 4, id: "e2", visible: true }).vibrancy,
    ).toBe(0);
  });
});
