import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resolveTargetFrame } from "../resolveTargetFrame";
import type { FlatSceneNode } from "@/types/scene";

describe("resolveTargetFrame", () => {
  beforeEach(() => {
    resetStores();
    seedScene(); // frame1 → [rect1, text1]; rect2 root (non-frame)
  });

  it("uses a selected frame directly", () => {
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("uses the parent frame of a selected child", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("falls back to the first top-level frame when nothing is selected", () => {
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("returns null when there is no frame at all", () => {
    resetStores(); // empty scene
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolveTargetFrame()).toBeNull();
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
    expect(resolveTargetFrame()).toBe("frame2");
  });
});
