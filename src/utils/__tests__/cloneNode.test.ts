import { describe, expect, it } from "vitest";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import { createShadowEffect, createSolidPaint } from "@/utils/fillUtils";
import type { FrameNode } from "@/types/scene";

function makeReusableFrame(overrides: Partial<FrameNode> = {}): FrameNode {
  return {
    id: "frame-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    enabled: true,
    reusable: true,
    children: [],
    ...overrides,
  } as FrameNode;
}

describe("cloneNodeWithNewId — reusable frame -> ref", () => {
  it("carries the paint stack and effects onto the ref node", () => {
    const frame = makeReusableFrame({
      fills: [createSolidPaint("#ff0000"), createSolidPaint("#00ff00")],
      effects: [createShadowEffect()],
    });

    const result = cloneNodeWithNewId(frame);

    expect(result.type).toBe("ref");
    if (result.type !== "ref") throw new Error("expected ref node");
    expect(result.fills).toHaveLength(2);
    expect(result.fills?.[0].type).toBe("solid");
    expect(result.fills?.map((p) => (p.type === "solid" ? p.color : null))).toEqual([
      "#ff0000",
      "#00ff00",
    ]);
    expect(result.effects).toHaveLength(1);
  });

  it("omits fills key when the reusable frame has no fills", () => {
    const frame = makeReusableFrame();

    const result = cloneNodeWithNewId(frame);

    expect(result.type).toBe("ref");
    expect("fills" in result).toBe(false);
    expect("effects" in result).toBe(false);
  });
});
