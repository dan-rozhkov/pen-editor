import { describe, expect, it } from "vitest";
import { tidyUpNodes } from "../alignmentUtils";
import type { FrameNode, SceneNode } from "../../types/scene";

function rect(id: string, x: number, y: number, width: number, height: number): SceneNode {
  return { id, type: "rect", name: id, x, y, width, height, fill: "#ffffff" } as unknown as SceneNode;
}

describe("tidyUpNodes", () => {
  it("returns no updates for fewer than two nodes", () => {
    const nodes = [rect("a", 0, 0, 10, 10)];
    expect(tidyUpNodes(["a"], nodes)).toEqual([]);
  });

  it("arranges a chaotic single-row selection with the median gap", () => {
    const nodes = [
      rect("a", 0, 5, 20, 20),
      rect("b", 30, 0, 20, 20), // gap 10
      rect("c", 90, 8, 20, 20), // gap 40
      rect("d", 120, 2, 20, 20), // gap 10
    ];

    const updates = tidyUpNodes(["a", "b", "c", "d"], nodes);
    const byId = Object.fromEntries(updates.map((u) => [u.id, u]));

    expect(byId.a.y).toBe(byId.b.y);
    expect(byId.b.y).toBe(byId.c.y);
    expect(byId.c.y).toBe(byId.d.y);
    expect(byId.b.x! - (byId.a.x! + 20)).toBe(10);
    expect(byId.c.x! - (byId.b.x! + 20)).toBe(10);
    expect(byId.d.x! - (byId.c.x! + 20)).toBe(10);
  });

  it("converts absolute positions back into each node's own parent-relative space", () => {
    // frame at absolute (100, 100); its child is at relative (10, 10) i.e.
    // absolute (110, 110). A root-level sibling sits at absolute (300, 108),
    // close enough vertically to land in the same row as the child.
    const frame: FrameNode = {
      id: "frame1",
      type: "frame",
      name: "Frame",
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      fill: "#ffffff",
      layout: { autoLayout: false, gap: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
      children: [rect("child", 10, 10, 20, 20)],
    } as unknown as FrameNode;
    const sibling = rect("sibling", 300, 108, 20, 20);

    const nodes: SceneNode[] = [frame, sibling];
    const updates = tidyUpNodes(["child", "sibling"], nodes);
    const byId = Object.fromEntries(updates.map((u) => [u.id, u]));

    // child's update stays in frame-relative coordinates (small numbers),
    // not absolute (which would be >= 100).
    expect(byId.child.x!).toBeLessThan(100);
    expect(byId.child.y!).toBeLessThan(100);
    // sibling stays in absolute/root coordinates (no parent offset).
    expect(byId.sibling.x!).toBeGreaterThanOrEqual(100);
  });
});
