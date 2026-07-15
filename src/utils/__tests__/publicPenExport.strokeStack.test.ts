import { describe, expect, it } from "vitest";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import { createGradientPaint, createSolidPaint } from "@/utils/fillUtils";
import type { RectNode } from "@/types/scene";

function baseRect(overrides: Partial<RectNode>): RectNode {
  return {
    id: "rect-1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  };
}

function exportNodes(nodes: RectNode[]) {
  const json = serializePublicPenDocument(nodes, [], "light");
  return JSON.parse(json);
}

describe("publicPenExport — stroke paint stack", () => {
  it("exports a legacy single-color stroke as stroke.fill (unchanged behavior)", () => {
    const node = baseRect({ stroke: "#000000", strokeWidth: 2 });
    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.stroke).toEqual({ thickness: 2, fill: "#000000" });
  });

  it("exports a single-item strokes stack as stroke.fill, not stroke.fills", () => {
    const node = baseRect({
      strokeWidth: 2,
      strokes: [createSolidPaint("#ff0000")],
    });
    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.stroke.fill).toBe("#ff0000");
    expect(exported.stroke.fills).toBeUndefined();
  });

  it("exports a gradient stroke instead of dropping it", () => {
    const node = baseRect({
      strokeWidth: 4,
      strokes: [
        createGradientPaint({
          type: "linear",
          startX: 0,
          startY: 0,
          endX: 1,
          endY: 0,
          stops: [
            { color: "#000000", position: 0 },
            { color: "#ffffff", position: 1 },
          ],
        }),
      ],
    });
    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.stroke.fill).toMatchObject({
      type: "gradient",
      gradientType: "linear",
      colors: [
        { color: "#000000", position: 0 },
        { color: "#ffffff", position: 1 },
      ],
    });
  });

  it("exports a multi-paint stroke stack as stroke.fills, bottom-to-top", () => {
    const node = baseRect({
      strokeWidth: 2,
      strokes: [createSolidPaint("#000000"), createSolidPaint("#00ff00", { opacity: 0.5 })],
    });
    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.stroke.fill).toBeUndefined();
    expect(exported.stroke.fills).toEqual(["#000000", { type: "color", color: "#00ff0080" }]);
  });

  it("hidden/zero-opacity stroke paints are excluded", () => {
    const node = baseRect({
      strokeWidth: 2,
      strokes: [createSolidPaint("#000000", { visible: false }), createSolidPaint("#00ff00")],
    });
    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.stroke.fill).toBe("#00ff00");
  });
});
