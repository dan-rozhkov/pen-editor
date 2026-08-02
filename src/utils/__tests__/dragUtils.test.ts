import { describe, it, expect } from "vitest";
import { calculateDropPosition } from "@/utils/dragUtils";
import type { FrameNode } from "@/types/scene";

describe("calculateDropPosition — inside-stroke content insets (finding G/E)", () => {
  it("offsets the empty-frame indicator by padding + inside stroke, via resolveContentInsets", () => {
    const frame = {
      id: "f",
      type: "frame",
      x: 0,
      y: 0,
      width: 300,
      height: 100,
      layout: { autoLayout: true, flexDirection: "row", paddingLeft: 5, paddingTop: 5 },
      children: [],
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
    } as unknown as FrameNode;

    const result = calculateDropPosition(
      { x: 50, y: 50 },
      frame,
      { x: 0, y: 0 },
      "dragged",
      [],
    );

    expect(result).not.toBeNull();
    // padding (5) + inside stroke (10) = 15 on both axes.
    expect(result!.indicator.x).toBe(15);
    expect(result!.indicator.y).toBe(15);
  });
});
