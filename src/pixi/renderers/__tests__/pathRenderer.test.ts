import { describe, expect, it, vi } from "vitest";
import { Graphics } from "pixi.js";
import { createPathContainer, drawPath, updatePathContainer } from "../pathRenderer";
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

describe("drawPath compound paths", () => {
  it("preserves the hole in a Figma-style nonzero path with opposite-winding loops", () => {
    const node = pathNode({
      fill: "#ffffff",
      fillRule: "nonzero",
      geometry: "M0 0 L100 0 L100 100 L0 100 Z M30 30 L30 70 L70 70 L70 30 Z",
    });

    const gfx = new Graphics();
    drawPath(gfx, node);

    expect(gfx.containsPoint({ x: 10, y: 10 })).toBe(true);
    expect(gfx.containsPoint({ x: 50, y: 50 })).toBe(false);
  });

  it("keeps a same-winding nested contour filled under the nonzero rule", () => {
    const gfx = new Graphics();
    drawPath(gfx, pathNode({
      fill: "#ffffff",
      fillRule: "nonzero",
      geometry: "M0 0 L100 0 L100 100 L0 100 Z M30 30 L70 30 L70 70 L30 70 Z",
    }));

    expect(gfx.containsPoint({ x: 50, y: 50 })).toBe(true);
  });

  it("preserves holes in multiple disjoint nonzero shapes", () => {
    const gfx = new Graphics();
    drawPath(gfx, pathNode({
      fill: "#ffffff",
      fillRule: "nonzero",
      geometry: [
        "M0 0 L40 0 L40 40 L0 40 Z",
        "M10 10 L10 30 L30 30 L30 10 Z",
        "M60 60 L100 60 L100 100 L60 100 Z",
        "M70 70 L70 90 L90 90 L90 70 Z",
      ].join(" "),
    }));

    expect(gfx.containsPoint({ x: 5, y: 5 })).toBe(true);
    expect(gfx.containsPoint({ x: 20, y: 20 })).toBe(false);
    expect(gfx.containsPoint({ x: 65, y: 65 })).toBe(true);
    expect(gfx.containsPoint({ x: 80, y: 80 })).toBe(false);
  });

  it("associates a hole with its own outer when a later disjoint shape exists", () => {
    const gfx = new Graphics();
    drawPath(gfx, pathNode({
      fill: "#ffffff",
      fillRule: "nonzero",
      geometry: [
        "M0 0 L40 0 L40 40 L0 40 Z",
        "M10 10 L10 30 L30 30 L30 10 Z",
        "M60 0 L100 0 L100 40 L60 40 Z",
      ].join(" "),
    }));

    const fillInstructions = gfx.context.instructions.filter(
      (instruction) => instruction.action === "fill",
    );
    expect(fillInstructions).toHaveLength(2);
    expect(gfx.containsPoint({ x: 20, y: 20 })).toBe(false);
    expect(gfx.containsPoint({ x: 80, y: 20 })).toBe(true);
  });

  it("redraws when only the fill rule changes", () => {
    const geometry = "M0 0 L100 0 L100 100 L0 100 Z M30 30 L70 30 L70 70 L30 70 Z";
    const previous = pathNode({ fill: "#ffffff", fillRule: "nonzero", geometry });
    const next = { ...previous, fillRule: "evenodd" as const };
    const container = createPathContainer(previous);
    const gfx = container.getChildByLabel("path-gfx") as Graphics;

    expect(gfx.containsPoint({ x: 50, y: 50 })).toBe(true);
    updatePathContainer(container, next, previous);
    expect(gfx.containsPoint({ x: 50, y: 50 })).toBe(false);
  });
});
