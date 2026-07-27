import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

/**
 * Seeds a single top-level frame with the given children (already positioned
 * relative to the frame — same convention as the real flat store) and no
 * auto-layout, mirroring what a user would have laid out manually before
 * turning auto-layout on.
 */
function seedFrameWithChildren(
  frame: { width: number; height: number },
  children: FlatSceneNode[],
): void {
  const frameNode: FlatFrameNode = {
    id: "frame1",
    type: "frame",
    name: "Screen",
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
    layout: { autoLayout: false },
  } as unknown as FlatFrameNode;

  const nodesById: Record<string, FlatSceneNode> = { frame1: frameNode };
  const parentById: Record<string, string | null> = { frame1: null };
  for (const child of children) {
    nodesById[child.id] = child;
    parentById[child.id] = "frame1";
  }

  useSceneStore.setState({
    nodesById,
    parentById,
    childrenById: { frame1: children.map((c) => c.id) },
    rootIds: ["frame1"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

function rectNode(id: string, x: number, y: number, width: number, height: number): FlatSceneNode {
  return { id, type: "rect", name: id, x, y, width, height, fill: "#ff0000" } as unknown as FlatSceneNode;
}

describe("enableAutoLayoutOnFrame (FIR-60)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("infers column direction, gap, padding, and visual order for vertically stacked children", () => {
    // Children stacked top-to-bottom with a 24px gap and a 16px inset from
    // every frame edge, inserted into the tree in REVERSE visual order.
    seedFrameWithChildren(
      { width: 232, height: 176 },
      [
        rectNode("bottom", 16, 100, 200, 60),
        rectNode("top", 16, 16, 200, 60),
      ],
    );

    const before = pastLen();
    const ok = scene().enableAutoLayoutOnFrame("frame1");
    expect(ok).toBe(true);

    const s = scene();
    const frame = s.nodesById["frame1"] as FlatFrameNode;
    expect(frame.layout?.autoLayout).toBe(true);
    expect(frame.layout?.flexDirection).toBe("column");
    expect(frame.layout?.gap).toBe(24); // 100 - (16 + 60)
    expect(frame.layout?.paddingTop).toBe(16);
    expect(frame.layout?.paddingLeft).toBe(16);
    expect(frame.layout?.paddingRight).toBe(16); // 232 - (16 + 200)
    expect(frame.layout?.paddingBottom).toBe(16); // 176 - (100 + 60)
    expect(frame.sizing?.heightMode).toBe("fit_content");

    // Visual order (top before bottom), not insertion/tree order.
    expect(s.childrenById["frame1"]).toEqual(["top", "bottom"]);

    // Single history entry for the whole operation.
    expect(pastLen()).toBe(before + 1);
  });

  it("infers row direction and gap for horizontally stacked children", () => {
    seedFrameWithChildren(
      { width: 300, height: 100 },
      [
        rectNode("left", 0, 0, 100, 100),
        rectNode("right", 140, 0, 100, 100),
      ],
    );

    const ok = scene().enableAutoLayoutOnFrame("frame1");
    expect(ok).toBe(true);

    const frame = scene().nodesById["frame1"] as FlatFrameNode;
    expect(frame.layout?.flexDirection).toBe("row");
    expect(frame.layout?.gap).toBe(40);
    expect(scene().childrenById["frame1"]).toEqual(["left", "right"]);
  });

  it("grows the frame instead of clamping children that overflow its top-left", () => {
    // `a` bleeds 20px left and 10px above the frame. Padding can't be
    // negative, so the frame must grow (and shift) to keep both children
    // exactly where they are on screen.
    seedFrameWithChildren(
      { width: 100, height: 100 },
      [
        rectNode("a", -20, -10, 50, 40),
        rectNode("b", -20, 50, 50, 40),
      ],
    );
    // Give the frame a non-zero origin so the shift is observable.
    useSceneStore.setState({
      nodesById: {
        ...scene().nodesById,
        frame1: { ...scene().nodesById["frame1"], x: 200, y: 300 } as FlatSceneNode,
      },
      _cachedTree: null,
    });

    expect(scene().enableAutoLayoutOnFrame("frame1")).toBe(true);

    const s = scene();
    const frame = s.nodesById["frame1"] as FlatFrameNode;
    // Frame absorbed the overflow: origin moved by (-20,-10), size grew to match.
    expect(frame.x).toBe(180);
    expect(frame.y).toBe(290);
    expect(frame.width).toBe(120);
    expect(frame.height).toBe(110);

    // Children re-based into the grown frame — same absolute position as before.
    expect(s.nodesById["a"].x).toBe(0);
    expect(s.nodesById["a"].y).toBe(0);
    expect(s.nodesById["b"].y).toBe(60);

    // No negative padding was needed, and none was silently swallowed.
    expect(frame.layout?.paddingLeft).toBe(0);
    expect(frame.layout?.paddingTop).toBe(0);
    expect(frame.layout?.paddingRight).toBe(70); // 120 - 50
    expect(frame.layout?.gap).toBe(20); // 60 - (0 + 40)
  });

  it("grows the frame when a child overflows its bottom-right", () => {
    seedFrameWithChildren(
      { width: 60, height: 60 },
      [
        rectNode("a", 0, 0, 50, 40),
        rectNode("b", 0, 60, 80, 40), // extends to x=80 (>60) and y=100 (>60)
      ],
    );

    expect(scene().enableAutoLayoutOnFrame("frame1")).toBe(true);

    const frame = scene().nodesById["frame1"] as FlatFrameNode;
    expect(frame.x).toBe(0); // no top-left overflow, origin unchanged
    expect(frame.y).toBe(0);
    expect(frame.width).toBe(80);
    expect(frame.height).toBe(100);
    expect(frame.layout?.paddingRight).toBe(0);
    expect(frame.layout?.paddingBottom).toBe(0);
  });

  it("is a no-op (no history entry) for a non-frame node", () => {
    seedFrameWithChildren({ width: 100, height: 100 }, [rectNode("a", 0, 0, 50, 50)]);
    const before = pastLen();
    expect(scene().enableAutoLayoutOnFrame("a")).toBe(false);
    expect(pastLen()).toBe(before);
  });

  it("handles a frame with zero children without throwing", () => {
    seedFrameWithChildren({ width: 100, height: 100 }, []);
    expect(scene().enableAutoLayoutOnFrame("frame1")).toBe(true);
    const frame = scene().nodesById["frame1"] as FlatFrameNode;
    expect(frame.layout?.autoLayout).toBe(true);
    expect(frame.layout?.paddingTop).toBe(0);
  });
});
