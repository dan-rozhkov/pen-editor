import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode, SceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { resetStores } from "@/test/fixtures";

/** Row auto-layout frame, width=fit, gap 0, no padding, with one 100-wide rect. */
function seedFitWidthFrame(): void {
  const frame = {
    id: "fit",
    type: "frame",
    name: "Fit",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    layout: {
      autoLayout: true,
      flexDirection: "row",
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    sizing: { widthMode: "fit_content", heightMode: "fixed" },
  } as unknown as FlatSceneNode;

  const a = {
    id: "a",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    sizing: { widthMode: "fixed", heightMode: "fixed" },
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { fit: frame, a },
    parentById: { fit: null, a: "fit" },
    childrenById: { fit: ["a"] },
    rootIds: ["fit"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

function effectiveWidthOf(id: string): number {
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const nodes = useSceneStore.getState().getNodes();
  const size = getNodeEffectiveSize(nodes, id, calc);
  return size!.width;
}

describe("fit-width frame resize on insert", () => {
  beforeEach(() => {
    resetStores();
    seedFitWidthFrame();
  });

  it("intrinsic width reflects the single child", () => {
    expect(effectiveWidthOf("fit")).toBe(100);
  });

  it("grows when a second child is inserted via addChildToFrame", () => {
    expect(effectiveWidthOf("fit")).toBe(100);
    const b = {
      id: "b",
      type: "rect",
      x: 0,
      y: 0,
      width: 50,
      height: 60,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    } as unknown as SceneNode;
    useSceneStore.getState().addChildToFrame("fit", b);
    expect(effectiveWidthOf("fit")).toBe(150);
  });
});
