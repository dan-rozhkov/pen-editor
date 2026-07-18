import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "pixi.js";
import { createAutoLayoutManager } from "../syncAutoLayout";
import { useViewportStore } from "@/store/viewportStore";
import type { SceneState } from "@/store/sceneStore";
import type { SyncContext, RegistryEntry } from "../syncHelpers";

// Minimal fake cullingIndex — updateCulling only calls `queryVisible`, so a
// controllable stub is enough; `rebuild`/`updateForChanged` are unused here.
function makeCullingIndex(visible: Set<string>) {
  return {
    // Snapshot into a fresh Set each call — mirrors the real cullingIndex,
    // which never hands back a reference the caller can accidentally alias
    // with its own `lastVisible` bookkeeping.
    queryVisible: vi.fn(() => new Set(visible)),
    rebuild: vi.fn(),
    updateForChanged: vi.fn(),
  } as unknown as SyncContext["cullingIndex"];
}

function makeCtx(visible: Set<string>) {
  const registry = new Map<string, RegistryEntry>();
  const cullingIndex = makeCullingIndex(visible);
  const sceneRoot = new Container();
  return { sceneRoot, registry, cullingIndex, visible };
}

function makeEntry(isMask = false): RegistryEntry {
  return {
    container: new Container(),
    node: { id: "n", type: "rect", isMask, width: 10, height: 10 } as unknown as RegistryEntry["node"],
  };
}

describe("createAutoLayoutManager", () => {
  beforeEach(() => {
    useViewportStore.setState({ scale: 1, x: 0, y: 0 });
  });

  describe("hasCulledDescendant (Bug 1a dep)", () => {
    it("returns false when the frame itself isn't currently visible", () => {
      const ctx = makeCtx(new Set());
      const mgr = createAutoLayoutManager(ctx);
      const child = makeEntry();
      child.container.renderable = false;
      ctx.registry.set("f1", makeEntry());
      ctx.registry.set("c1", child);
      const state = { childrenById: { f1: ["c1"] } } as unknown as SceneState;

      expect(mgr.hasCulledDescendant("f1", state)).toBe(false);
    });

    it("returns true when the frame is visible and a non-mask descendant's container is not renderable", () => {
      const ctx = makeCtx(new Set(["f1"]));
      const mgr = createAutoLayoutManager(ctx);
      const frame = makeEntry();
      const child = makeEntry();
      child.container.renderable = false;
      ctx.registry.set("f1", frame);
      ctx.registry.set("c1", child);
      const state = { childrenById: { f1: ["c1"] } } as unknown as SceneState;

      mgr.updateCulling(); // makes f1 "visible" per the fake index
      expect(mgr.hasCulledDescendant("f1", state)).toBe(true);
    });

    it("returns false when every descendant's container is renderable", () => {
      const ctx = makeCtx(new Set(["f1"]));
      const mgr = createAutoLayoutManager(ctx);
      ctx.registry.set("f1", makeEntry());
      ctx.registry.set("c1", makeEntry());
      const state = { childrenById: { f1: ["c1"] } } as unknown as SceneState;

      mgr.updateCulling();
      expect(mgr.hasCulledDescendant("f1", state)).toBe(false);
    });

    it("does not treat a non-renderable mask descendant as culled (masks are owned by sibling-mask resolution, not culling)", () => {
      const ctx = makeCtx(new Set(["f1"]));
      const mgr = createAutoLayoutManager(ctx);
      const maskChild = makeEntry(true);
      maskChild.container.renderable = false;
      ctx.registry.set("f1", makeEntry());
      ctx.registry.set("c1", maskChild);
      const state = { childrenById: { f1: ["c1"] } } as unknown as SceneState;

      mgr.updateCulling();
      expect(mgr.hasCulledDescendant("f1", state)).toBe(false);
    });

    it("walks multiple levels deep", () => {
      const ctx = makeCtx(new Set(["f1"]));
      const mgr = createAutoLayoutManager(ctx);
      const grandchild = makeEntry();
      grandchild.container.renderable = false;
      ctx.registry.set("f1", makeEntry());
      ctx.registry.set("c1", makeEntry());
      ctx.registry.set("gc1", grandchild);
      const state = {
        childrenById: { f1: ["c1"], c1: ["gc1"] },
      } as unknown as SceneState;

      mgr.updateCulling();
      expect(mgr.hasCulledDescendant("f1", state)).toBe(true);
    });
  });

  describe("culling-eviction callback (Bug 1b/1c)", () => {
    it("notifies onCullingEviction with ids that flip false->true visible (show transitions)", () => {
      const visible = new Set<string>();
      const ctx = makeCtx(visible);
      const onCullingEviction = vi.fn();
      const mgr = createAutoLayoutManager(ctx, { onCullingEviction });
      ctx.registry.set("c1", makeEntry());

      mgr.updateCulling(); // nothing visible yet
      expect(onCullingEviction).not.toHaveBeenCalled();

      visible.add("c1"); // c1 becomes visible (e.g. pan reveals it)
      mgr.updateCulling();
      expect(onCullingEviction).toHaveBeenCalledWith(["c1"]);
    });

    it("does not call onCullingEviction when nothing newly became visible", () => {
      const ctx = makeCtx(new Set(["c1"]));
      const onCullingEviction = vi.fn();
      const mgr = createAutoLayoutManager(ctx, { onCullingEviction });
      ctx.registry.set("c1", makeEntry());

      mgr.updateCulling();
      onCullingEviction.mockClear();
      mgr.updateCulling(); // steady state, no membership change
      expect(onCullingEviction).not.toHaveBeenCalled();
    });

    it("notifies onCullingEviction with every currently-cached frame id on an overview scale flip", () => {
      const ctx = makeCtx(new Set());
      const onCullingEviction = vi.fn();
      const getCachedFrameIds = vi.fn(() => ["f1", "f2"]);
      const mgr = createAutoLayoutManager(ctx, { onCullingEviction, getCachedFrameIds });

      useViewportStore.setState({ scale: 1, x: 0, y: 0 });
      mgr.updateCulling(); // establishes lastOverview = false

      useViewportStore.setState({ scale: 0.1, x: 0, y: 0 }); // <= 0.2 => overview
      mgr.updateCulling();
      expect(onCullingEviction).toHaveBeenCalledWith(["f1", "f2"]);
    });

    it("does not call onCullingEviction on overview flip when nothing is cached", () => {
      const ctx = makeCtx(new Set());
      const onCullingEviction = vi.fn();
      const getCachedFrameIds = vi.fn(() => [] as string[]);
      const mgr = createAutoLayoutManager(ctx, { onCullingEviction, getCachedFrameIds });

      mgr.updateCulling();
      useViewportStore.setState({ scale: 0.1, x: 0, y: 0 });
      mgr.updateCulling();
      expect(onCullingEviction).not.toHaveBeenCalled();
    });
  });
});
