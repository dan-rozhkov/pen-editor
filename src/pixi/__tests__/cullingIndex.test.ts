import { describe, expect, it } from "vitest";
import { generatePerfScene } from "@/dev/perfScene";
import { createCullingIndex } from "../cullingIndex";
import { computeViewportRenderability } from "../viewportCulling";

describe("cullingIndex", () => {
  it("queryVisible matches computeViewportRenderability's renderable set for unrotated scenes", () => {
    const scene = generatePerfScene(20, 30);
    const state = scene as never;
    const index = createCullingIndex();
    index.rebuild(state);
    const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1200 };
    const legacy = computeViewportRenderability({ ...scene, bounds, margin: 0 });
    const legacyVisible = new Set([...legacy].filter(([, v]) => v).map(([id]) => id));
    expect(index.queryVisible(bounds)).toEqual(legacyVisible);
  });

  it("a rotated node is culled by its rotated AABB (legacy never culls it)", () => {
    const scene = generatePerfScene(1, 1);
    scene.nodesById["perf-0-0"] = { ...scene.nodesById["perf-0-0"], rotation: 45, x: 100000, y: 100000 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    expect(index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }).has("perf-0-0")).toBe(false);
  });

  it("updateForChanged moves a node between cells", () => {
    const scene = generatePerfScene(2, 5);
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const moved = { ...scene.nodesById["perf-0-0"], x: 50000 };
    const next = { ...scene, nodesById: { ...scene.nodesById, "perf-0-0": moved } };
    index.updateForChanged(next as never, new Set(["perf-0-0"]));
    expect(index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }).has("perf-0-0")).toBe(false);
  });

  it("queryVisible includes the full ancestor chain of a hit", () => {
    const scene = generatePerfScene(1, 1);
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-0-0")).toBe(true);
    expect(visible.has("perf-frame-0")).toBe(true);
  });

  it("a rotated, fully off-screen node hides its whole subtree (no per-descendant grid hits)", () => {
    const scene = generatePerfScene(1, 3);
    scene.nodesById["perf-frame-0"] = { ...scene.nodesById["perf-frame-0"], rotation: 45, x: 500000, y: 500000 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-frame-0")).toBe(false);
    expect(visible.has("perf-0-0")).toBe(false);
    expect(visible.has("perf-0-1")).toBe(false);
    expect(visible.has("perf-0-2")).toBe(false);
  });

  it("a rotated node that IS on-screen makes its whole subtree visible, even though children are indexed nowhere", () => {
    const scene = generatePerfScene(1, 3);
    scene.nodesById["perf-frame-0"] = { ...scene.nodesById["perf-frame-0"], rotation: 45 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-frame-0")).toBe(true);
    expect(visible.has("perf-0-0")).toBe(true);
    expect(visible.has("perf-0-1")).toBe(true);
    expect(visible.has("perf-0-2")).toBe(true);
  });

  it("removing a rotated ancestor's rotation re-indexes descendants individually (scroll-away-and-back doesn't leave them stuck)", () => {
    const scene = generatePerfScene(1, 1);
    scene.nodesById["perf-frame-0"] = { ...scene.nodesById["perf-frame-0"], rotation: 45, x: 500000, y: 500000 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    // Off-screen while rotated far away.
    expect(index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }).has("perf-0-0")).toBe(false);

    // Un-rotate and move back on-screen.
    const restored = { ...scene.nodesById["perf-frame-0"], rotation: 0, x: 0, y: 0 };
    const next = { ...scene, nodesById: { ...scene.nodesById, "perf-frame-0": restored } };
    index.updateForChanged(next as never, new Set(["perf-frame-0"]));
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-frame-0")).toBe(true);
    expect(visible.has("perf-0-0")).toBe(true);
  });

  it("removed ids are dropped from the index", () => {
    const scene = generatePerfScene(1, 1);
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const remainingNodes = { ...scene.nodesById };
    delete remainingNodes["perf-0-0"];
    const remainingChildren = { ...scene.childrenById, "perf-frame-0": [] };
    const next = { ...scene, nodesById: remainingNodes, childrenById: remainingChildren };
    index.updateForChanged(next as never, new Set(["perf-0-0"]));
    expect(index.queryVisible({ minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 }).has("perf-0-0")).toBe(false);
  });
});
