import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "pixi.js";
import * as renderers from "../renderers";
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

  describe("resetFramesLeavingAutoLayout (undo/disable auto-layout snaps children back)", () => {
    // Registry entry whose container starts at a stale yoga position, with a
    // node carrying the stored (pre-auto-layout) coordinates/size.
    function childEntry(
      id: string,
      stored: { x: number; y: number; width: number; height: number },
      staleContainerPos: { x: number; y: number },
    ): RegistryEntry {
      const container = new Container();
      container.position.set(staleContainerPos.x, staleContainerPos.y);
      return {
        container,
        node: { id, type: "rect", ...stored } as unknown as RegistryEntry["node"],
      };
    }

    function autoLayoutFrame(id: string): RegistryEntry["node"] {
      return {
        id,
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        layout: { autoLayout: true },
      } as unknown as RegistryEntry["node"];
    }

    function plainFrame(id: string): RegistryEntry["node"] {
      return {
        id,
        type: "frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        layout: { autoLayout: false },
      } as unknown as RegistryEntry["node"];
    }

    it("snaps a child container back to its stored position when the frame leaves auto-layout", () => {
      const ctx = makeCtx(new Set());
      const mgr = createAutoLayoutManager(ctx);

      const child = childEntry(
        "c1",
        { x: 50, y: 200, width: 30, height: 30 },
        { x: 10, y: 10 }, // stale yoga position
      );
      ctx.registry.set("f1", { container: new Container(), node: plainFrame("f1") });
      ctx.registry.set("c1", child);

      const prev = {
        nodesById: { f1: autoLayoutFrame("f1"), c1: child.node },
        childrenById: { f1: ["c1"] },
        parentById: { c1: "f1" },
      } as unknown as SceneState;
      const state = {
        nodesById: { f1: plainFrame("f1"), c1: child.node },
        childrenById: { f1: ["c1"] },
        parentById: { c1: "f1" },
      } as unknown as SceneState;

      mgr.resetFramesLeavingAutoLayout(state, prev, new Set(["f1"]));

      expect(child.container.position.x).toBe(50);
      expect(child.container.position.y).toBe(200);
    });

    it("leaves children untouched when the frame still has auto-layout", () => {
      const ctx = makeCtx(new Set());
      const mgr = createAutoLayoutManager(ctx);

      const child = childEntry(
        "c1",
        { x: 50, y: 200, width: 30, height: 30 },
        { x: 10, y: 10 },
      );
      ctx.registry.set("c1", child);

      const prev = {
        nodesById: { f1: autoLayoutFrame("f1"), c1: child.node },
        childrenById: { f1: ["c1"] },
        parentById: { c1: "f1" },
      } as unknown as SceneState;
      // Still auto-layout in the new state.
      const state = {
        nodesById: { f1: autoLayoutFrame("f1"), c1: child.node },
        childrenById: { f1: ["c1"] },
        parentById: { c1: "f1" },
      } as unknown as SceneState;

      mgr.resetFramesLeavingAutoLayout(state, prev, new Set(["f1"]));

      // Untouched — yoga still owns the position.
      expect(child.container.position.x).toBe(10);
      expect(child.container.position.y).toBe(10);
    });

    it("repositions but does NOT resize a child that is itself an auto-layout frame (its own layout owns its size)", () => {
      const ctx = makeCtx(new Set());
      const mgr = createAutoLayoutManager(ctx);

      // Child is a nested auto-layout frame sitting at a stale yoga position,
      // with a container size (fit-content, 200x60) that diverges from its
      // stored size (300x300).
      const nestedNode = {
        id: "nested",
        type: "frame",
        x: 40,
        y: 90,
        width: 300,
        height: 300,
        layout: { autoLayout: true },
      } as unknown as RegistryEntry["node"];
      const container = new Container();
      container.position.set(5, 5); // stale yoga position
      ctx.registry.set("nested", { container, node: nestedNode });

      const prev = {
        nodesById: { f1: autoLayoutFrame("f1"), nested: nestedNode },
        childrenById: { f1: ["nested"] },
        parentById: { nested: "f1" },
      } as unknown as SceneState;
      const state = {
        nodesById: { f1: plainFrame("f1"), nested: nestedNode },
        childrenById: { f1: ["nested"] },
        parentById: { nested: "f1" },
      } as unknown as SceneState;

      const sizeSpy = vi.spyOn(renderers, "applyLayoutSize");
      mgr.resetFramesLeavingAutoLayout(state, prev, new Set(["f1"]));
      sizeSpy.mockRestore();

      // Position snapped to stored coordinates…
      expect(container.position.x).toBe(40);
      expect(container.position.y).toBe(90);
      // …but size was left untouched — the nested frame's own layout owns it.
      expect(sizeSpy).not.toHaveBeenCalled();
    });

    it("does nothing for a frame that was never auto-layout", () => {
      const ctx = makeCtx(new Set());
      const mgr = createAutoLayoutManager(ctx);

      const child = childEntry(
        "c1",
        { x: 50, y: 200, width: 30, height: 30 },
        { x: 10, y: 10 },
      );
      ctx.registry.set("c1", child);

      const prev = {
        nodesById: { f1: plainFrame("f1"), c1: child.node },
        childrenById: { f1: ["c1"] },
        parentById: { c1: "f1" },
      } as unknown as SceneState;
      const state = {
        nodesById: { f1: plainFrame("f1"), c1: child.node },
        childrenById: { f1: ["c1"] },
        parentById: { c1: "f1" },
      } as unknown as SceneState;

      mgr.resetFramesLeavingAutoLayout(state, prev, new Set(["f1"]));

      expect(child.container.position.x).toBe(10);
      expect(child.container.position.y).toBe(10);
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
