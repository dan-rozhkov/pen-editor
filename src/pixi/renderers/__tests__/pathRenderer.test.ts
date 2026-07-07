import { describe, expect, it, vi } from "vitest";
import { Graphics } from "pixi.js";
import { drawPath } from "../pathRenderer";
import * as fillStrokeHelpers from "../fillStrokeHelpers";
import type { PathNode } from "@/types/scene";

function pathNode(overrides: Partial<PathNode> = {}): PathNode {
  return {
    id: "path1",
    type: "path",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    geometry: "M0,0 L100,0 L100,100 L0,100 Z",
    ...overrides,
  } as PathNode;
}

describe("drawPathFillStack (pattern-on-path safety net)", () => {
  it("skips a pattern paint entirely (no gradient/solid fill call) instead of half-rendering it", () => {
    const gradientSpy = vi.spyOn(fillStrokeHelpers, "buildPixiGradient");
    const solidSpy = vi.spyOn(fillStrokeHelpers, "fillSolidPaint");

    const node = pathNode({
      fills: [
        { id: "p1", type: "pattern", pattern: { url: "https://example.com/tile.png" } },
      ],
    } as unknown as Partial<PathNode>);

    const gfx = new Graphics();
    expect(() => drawPath(gfx, node)).not.toThrow();

    // Neither fill implementation should ever be invoked for a pattern-only
    // stack: it must be dropped, not stretched/half-rendered.
    expect(gradientSpy).not.toHaveBeenCalled();
    expect(solidSpy).not.toHaveBeenCalled();

    gradientSpy.mockRestore();
    solidSpy.mockRestore();
  });

  it("still renders a solid layer that sits alongside a dropped pattern layer", () => {
    const solidSpy = vi.spyOn(fillStrokeHelpers, "fillSolidPaint");

    const node = pathNode({
      fills: [
        { id: "p1", type: "pattern", pattern: { url: "https://example.com/tile.png" } },
        { id: "p2", type: "solid", color: "#ff0000" },
      ],
    } as unknown as Partial<PathNode>);

    const gfx = new Graphics();
    drawPath(gfx, node);

    expect(solidSpy).toHaveBeenCalledTimes(1);
    solidSpy.mockRestore();
  });
});
