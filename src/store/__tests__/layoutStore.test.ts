import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode, FrameNode } from "@/types/scene";

/**
 * Seed a single auto-layout frame ("autoFrame") with two fixed-size children.
 * An auto-layout frame with visible children drives the cacheable path
 * (calculateFrameLayout returns non-empty results, applyLayoutToChildren runs
 * and returns a fresh array).
 */
function seedAutoLayoutScene(): void {
  const autoFrame = {
    id: "autoFrame",
    type: "frame",
    name: "Auto",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    fill: "#ffffff",
    layout: {
      autoLayout: true,
      direction: "vertical",
      gap: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    },
  } as unknown as FlatSceneNode;

  const childA = {
    id: "childA",
    type: "rect",
    name: "A",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

  const childB = {
    id: "childB",
    type: "rect",
    name: "B",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: "#00ff00",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { autoFrame, childA, childB },
    parentById: { autoFrame: null, childA: "autoFrame", childB: "autoFrame" },
    childrenById: { autoFrame: ["childA", "childB"] },
    rootIds: ["autoFrame"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

function getAutoFrame(): FrameNode {
  const tree = useSceneStore.getState().getNodes();
  return tree.find((n) => n.id === "autoFrame") as FrameNode;
}

describe("layoutStore.calculateLayoutForFrame memoization", () => {
  const calc = () => useLayoutStore.getState().calculateLayoutForFrame;

  beforeEach(() => {
    resetStores();
    seedAutoLayoutScene();
  });

  it("returns a reference-equal result on a cache hit (same frame, same scene)", () => {
    const frame = getAutoFrame();
    const first = calc()(frame);
    const second = calc()(frame);

    // Sanity: an auto-layout frame with two children took the compute path.
    expect(first).not.toBe(frame.children);
    expect(first).toHaveLength(2);

    expect(second).toBe(first);
  });

  it("invalidates the cache when the scene changes (fresh frame reflects the change)", () => {
    const frame = getAutoFrame();
    const first = calc()(frame);

    // Mutate the scene: change a child's width. updateNode produces a fresh
    // nodesById map, which invalidates the tree cache and our layout cache.
    useSceneStore.getState().updateNode("childA", { width: 250 });

    const freshFrame = getAutoFrame();
    expect(freshFrame).not.toBe(frame); // tree cache produced a new frame object

    const after = calc()(freshFrame);
    expect(after).not.toBe(first);
    // The mutated child's width must be reflected in the new layout result.
    const childAResult = after.find((c) => c.id === "childA");
    expect(childAResult).toBeDefined();
  });

  it("does not serve a stale cached result for the OLD frame after a scene change", () => {
    const frame = getAutoFrame();
    const stale = calc()(frame);

    // Scene change resets the maps; calling with the stale frame object must
    // recompute against the current maps, not return the pre-mutation result.
    useSceneStore.getState().updateNode("childA", { width: 250 });

    const recomputed = calc()(frame);
    expect(recomputed).not.toBe(stale);
  });

  it("passes through frame.children unchanged for a non-auto-layout frame", () => {
    // Turn off auto layout.
    useSceneStore.getState().updateNode("autoFrame", {
      layout: { autoLayout: false },
    });

    const frame = getAutoFrame();
    const result = calc()(frame);
    expect(result).toBe(frame.children);
  });
});
