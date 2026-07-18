import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resolveTargetFrame } from "../resolveTargetFrame";
import type { FlatSceneNode } from "@/types/scene";

function resolve(): string | null {
  const { nodesById, parentById, rootIds } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();
  return resolveTargetFrame(nodesById, parentById, rootIds, selectedIds);
}

describe("resolveTargetFrame", () => {
  beforeEach(() => {
    resetStores();
    seedScene(); // frame1 → [rect1, text1]; rect2 root (non-frame)
  });

  it("uses a selected frame directly", () => {
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    expect(resolve()).toBe("frame1");
  });

  it("uses the parent frame of a selected child", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    expect(resolve()).toBe("frame1");
  });

  it("falls back to the first top-level frame when nothing is selected", () => {
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolve()).toBe("frame1");
  });

  it("returns null when there is no frame at all", () => {
    resetStores(); // empty scene
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolve()).toBeNull();
  });

  it("uses the nearest ancestor frame when the selected node is nested inside a group inside a non-first frame", () => {
    // frame1 (empty, first top-level frame) ; frame2 → group1 → rectA
    const frame1 = {
      id: "frame1",
      type: "frame",
      name: "Empty",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "#ffffff",
      layout: { autoLayout: false, gap: 8, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
    } as unknown as FlatSceneNode;

    const frame2 = {
      id: "frame2",
      type: "frame",
      name: "Screen",
      x: 200,
      y: 0,
      width: 400,
      height: 300,
      fill: "#ffffff",
      layout: { autoLayout: false, gap: 8, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
    } as unknown as FlatSceneNode;

    const group1 = {
      id: "group1",
      type: "group",
      name: "Group",
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    } as unknown as FlatSceneNode;

    const rectA = {
      id: "rectA",
      type: "rect",
      name: "Nested",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: "#0000ff",
    } as unknown as FlatSceneNode;

    useSceneStore.setState({
      nodesById: { frame1, frame2, group1, rectA },
      parentById: { frame1: null, frame2: null, group1: "frame2", rectA: "group1" },
      childrenById: { frame2: ["group1"], group1: ["rectA"] },
      rootIds: ["frame1", "frame2"],
      componentArtifactsById: {},
      _cachedTree: null,
    });

    useSelectionStore.setState({ selectedIds: ["rectA"] });
    expect(resolve()).toBe("frame2");
  });

  it("resolves to the new ancestor frame after a reparent (pins the staleness bug)", () => {
    // Two frames; rect1 starts inside frame1, then gets reparented into
    // frame2. The resolved target must track the NEW ancestor, not the one
    // computed before the reparent — this is what the pure-args signature
    // (subscribed via a selector) fixes versus the old getState()-during-
    // render read that dummy subscriptions couldn't fully cover.
    const frame1 = {
      id: "frame1",
      type: "frame",
      name: "Frame1",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "#ffffff",
      layout: { autoLayout: false, gap: 8, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
    } as unknown as FlatSceneNode;

    const frame2 = {
      id: "frame2",
      type: "frame",
      name: "Frame2",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      fill: "#ffffff",
      layout: { autoLayout: false, gap: 8, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
    } as unknown as FlatSceneNode;

    const rect1 = {
      id: "rect1",
      type: "rect",
      name: "Rect",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: "#0000ff",
    } as unknown as FlatSceneNode;

    useSceneStore.setState({
      nodesById: { frame1, frame2, rect1 },
      parentById: { frame1: null, frame2: null, rect1: "frame1" },
      childrenById: { frame1: ["rect1"], frame2: [] },
      rootIds: ["frame1", "frame2"],
      componentArtifactsById: {},
      _cachedTree: null,
    });

    useSelectionStore.setState({ selectedIds: ["rect1"] });
    expect(resolve()).toBe("frame1");

    // Reparent rect1 from frame1 to frame2, without touching selectedIds.
    useSceneStore.setState({
      parentById: { frame1: null, frame2: null, rect1: "frame2" },
      childrenById: { frame1: [], frame2: ["rect1"] },
      _cachedTree: null,
    });

    expect(resolve()).toBe("frame2");
  });
});
