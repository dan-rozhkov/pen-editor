import { beforeEach, describe, expect, it } from "vitest";
import { applyEyedropperColor } from "../eyedropper";
import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function getNode(id: string): FlatSceneNode {
  const node = useSceneStore.getState().nodesById[id];
  if (!node) throw new Error(`missing node ${id}`);
  return node;
}

describe("applyEyedropperColor", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("sets a new solid fill when the node has no existing paint", () => {
    useSceneStore.getState().updateNode("rect1", { fills: [] });

    applyEyedropperColor("#00ff00", ["rect1"]);

    const node = getNode("rect1");
    expect(node.fills).toHaveLength(1);
    expect(node.fills![0]).toMatchObject({ type: "solid", color: "#00ff00" });
  });

  it("replaces the color of the existing primary solid paint (legacy fill field)", () => {
    // seedScene's rect1 has a legacy `fill: "#ff0000"` field, no `fills` array.
    applyEyedropperColor("#00ff00", ["rect1"]);

    const node = getNode("rect1");
    expect(node.fills).toHaveLength(1);
    expect(node.fills![0]).toMatchObject({ type: "solid", color: "#00ff00" });
    // Legacy fields cleared so the two representations don't diverge.
    expect(node.fill).toBeUndefined();
  });

  it("preserves other paints when replacing the primary solid paint", () => {
    useSceneStore.getState().updateNode("rect1", {
      fills: [
        { id: "img1", type: "image", image: { url: "data:image/png;base64,x", mode: "fill" } },
        { id: "solid1", type: "solid", color: "#111111" },
      ],
    });

    applyEyedropperColor("#00ff00", ["rect1"]);

    const node = getNode("rect1");
    expect(node.fills).toHaveLength(2);
    expect(node.fills![0]).toMatchObject({ id: "img1", type: "image" });
    expect(node.fills![1]).toMatchObject({ id: "solid1", type: "solid", color: "#00ff00" });
  });

  it("applies the color to every selected node", () => {
    applyEyedropperColor("#0000ff", ["rect1", "rect2"]);

    expect(getNode("rect1").fills![0]).toMatchObject({ type: "solid", color: "#0000ff" });
    expect(getNode("rect2").fills![0]).toMatchObject({ type: "solid", color: "#0000ff" });
  });

  it("skips ids that don't resolve to a node, without throwing", () => {
    expect(() => applyEyedropperColor("#0000ff", ["rect1", "does-not-exist"])).not.toThrow();
    expect(getNode("rect1").fills![0]).toMatchObject({ type: "solid", color: "#0000ff" });
  });

  it("is a no-op when there are no selected ids", () => {
    const before = useHistoryStore.getState().past.length;
    applyEyedropperColor("#0000ff", []);
    expect(useHistoryStore.getState().past.length).toBe(before);
    expect(getNode("rect1").fill).toBe("#ff0000");
  });

  it("applying to a single node produces exactly one undo step", () => {
    const before = useHistoryStore.getState().past.length;
    applyEyedropperColor("#0000ff", ["rect1"]);
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
  });

  it("applying to multiple nodes produces exactly one undo step, and undo reverts all of them", () => {
    const before = useHistoryStore.getState().past.length;

    applyEyedropperColor("#0000ff", ["rect1", "rect2"]);

    expect(useHistoryStore.getState().past.length).toBe(before + 1);
    expect(getNode("rect1").fills![0]).toMatchObject({ color: "#0000ff" });
    expect(getNode("rect2").fills![0]).toMatchObject({ color: "#0000ff" });

    // Undo the single batched step and confirm both nodes revert together.
    const snapshot = useHistoryStore.getState().undo(createSnapshot(useSceneStore.getState()));
    expect(snapshot).not.toBeNull();
    useSceneStore.getState().restoreSnapshot!(snapshot!);

    expect(getNode("rect1").fill).toBe("#ff0000");
    expect(getNode("rect2").fill).toBe("#00ff00");
  });
});
