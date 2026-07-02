import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode, FrameNode } from "@/types/scene";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { resolveDrillChild } from "@/pixi/interaction/drillDown";

/**
 * Fixture scene:
 *
 *   frameA (0,0 400x400)
 *     └─ frameB (50,50 200x200)
 *          └─ rect1 (20,20 80x80 -> absolute 70,70..150,150)
 */
function seedDrillScene(): void {
  const frameA = {
    id: "frameA",
    type: "frame",
    name: "Frame A",
    x: 0,
    y: 0,
    width: 400,
    height: 400,
    fill: "#ffffff",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const frameB = {
    id: "frameB",
    type: "frame",
    name: "Frame B",
    x: 50,
    y: 50,
    width: 200,
    height: 200,
    fill: "#eeeeee",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const rect1 = {
    id: "rect1",
    type: "rect",
    name: "Rect 1",
    x: 20,
    y: 20,
    width: 80,
    height: 80,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { frameA, frameB, rect1 },
    parentById: { frameA: null, frameB: "frameA", rect1: "frameB" },
    childrenById: { frameA: ["frameB"], frameB: ["rect1"] },
    rootIds: ["frameA"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("resolveDrillChild (Figma one-level drill)", () => {
  beforeEach(() => {
    resetStores();
    seedDrillScene();
  });

  it("returns the DIRECT child under the point, not the deepest descendant", () => {
    const nodes = useSceneStore.getState().getNodes();
    const frameA = nodes.find((n) => n.id === "frameA") as FrameNode;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;

    // point (80,80) is inside rect1 (deep) — but drilling frameA must yield frameB
    expect(resolveDrillChild(frameA, 80, 80, nodes, calc)).toBe("frameB");
  });

  it("drilling the inner frame yields its direct child", () => {
    const nodes = useSceneStore.getState().getNodes();
    const frameA = nodes.find((n) => n.id === "frameA") as FrameNode;
    const frameB = frameA.children.find((n) => n.id === "frameB") as FrameNode;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;

    expect(resolveDrillChild(frameB, 80, 80, nodes, calc)).toBe("rect1");
  });

  it("returns null when the point hits no child of the container", () => {
    const nodes = useSceneStore.getState().getNodes();
    const frameA = nodes.find((n) => n.id === "frameA") as FrameNode;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;

    // point (390, 390) is inside frameA but outside frameB
    expect(resolveDrillChild(frameA, 390, 390, nodes, calc)).toBeNull();
  });

  it("respects z-order: topmost (last) overlapping child wins", () => {
    const rect2 = {
      id: "rect2",
      type: "rect",
      name: "Rect 2",
      x: 100,
      y: 100,
      width: 250,
      height: 250,
      fill: "#0000ff",
    } as unknown as FlatSceneNode;

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, rect2 },
      parentById: { ...s.parentById, rect2: "frameA" },
      childrenById: { ...s.childrenById, frameA: [...s.childrenById.frameA, "rect2"] },
      _cachedTree: null,
    }));

    const nodes = useSceneStore.getState().getNodes();
    const frameA = nodes.find((n) => n.id === "frameA") as FrameNode;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;

    // (150,150) is inside both frameB (50,50..250,250) and rect2 (100,100..350,350).
    // rect2 was added last -> wins in z-order.
    expect(resolveDrillChild(frameA, 150, 150, nodes, calc)).toBe("rect2");
  });

  it("skips invisible children", () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frameB: { ...s.nodesById.frameB, visible: false } as FlatSceneNode,
      },
      _cachedTree: null,
    }));

    const nodes = useSceneStore.getState().getNodes();
    const frameA = nodes.find((n) => n.id === "frameA") as FrameNode;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;

    // frameB hidden -> rect1 must NOT leak through as a direct-child hit.
    expect(resolveDrillChild(frameA, 80, 80, nodes, calc)).toBeNull();
  });
});
