import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { resetStores } from "@/test/fixtures";

/**
 * Pin: mutating stroke GEOMETRY through the real store path re-runs auto
 * layout (layout cache keys off nodesById identity; no special wiring).
 * Guards the "layout invalidation" clause of the CSS-aligned auto layout
 * spec — if layout caching ever becomes finer-grained, this must not break.
 */

function seedRow(): void {
  const row = {
    id: "row",
    type: "frame",
    name: "Row",
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    layout: { autoLayout: true, flexDirection: "row", gap: 0 },
    sizing: { widthMode: "fixed", heightMode: "fixed" },
  } as unknown as FlatSceneNode;
  const child = {
    id: "a",
    type: "rect",
    x: 0,
    y: 0,
    width: 50,
    height: 40,
    sizing: { widthMode: "fixed", heightMode: "fixed" },
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { row, a: child },
    parentById: { row: null, a: "row" },
    childrenById: { row: ["a"] },
    rootIds: ["row"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

function childX(): number {
  const scene = useSceneStore.getState();
  const tree = scene.getNodes();
  const frame = tree.find((n) => n.id === "row");
  if (!frame || frame.type !== "frame") throw new Error("row frame missing");
  const laidOut = useLayoutStore
    .getState()
    .calculateLayoutForFrame(frame);
  const a = laidOut.find((n) => n.id === "a");
  if (!a) throw new Error("child missing from layout");
  return a.x;
}

describe("stroke mutation invalidates auto layout", () => {
  beforeEach(() => {
    resetStores();
    seedRow();
  });

  it("adding an inside stroke to the frame moves children on the next layout read", () => {
    expect(childX()).toBe(0);

    useSceneStore.getState().updateNode("row", {
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
    });

    expect(childX()).toBe(10);
  });

  it("changing strokeAlign back to center restores the original layout", () => {
    useSceneStore.getState().updateNode("row", {
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
    });
    expect(childX()).toBe(10);

    useSceneStore.getState().updateNode("row", { strokeAlign: "center" });
    expect(childX()).toBe(0);
  });
});
