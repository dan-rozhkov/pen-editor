import { describe, expect, it } from "vitest";
import type { FlatFrameNode } from "@/types/scene";
import { createNodeContainer } from "../index";

describe("frameRenderer", () => {
  it("clips frame children without clipping the frame's drop shadow", () => {
    const frame = {
      id: "frame",
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      clip: true,
      effect: {
        type: "shadow",
        shadowType: "outer",
        color: "#00000040",
        offset: { x: 0, y: 4 },
        blur: 8,
        spread: 2,
      },
    } as FlatFrameNode;

    const container = createNodeContainer(frame, { frame }, { frame: [] });
    const clipMask = container.getChildByLabel("frame-mask");
    const children = container.getChildByLabel("frame-children");
    const shadow = container.getChildByLabel("shadow-layer");

    expect(clipMask).toBeTruthy();
    expect(shadow).toBeTruthy();
    expect(container.mask).toBeFalsy();
    expect(children?.mask).toBe(clipMask);
    expect(shadow?.parent).toBe(container);
  });
});
