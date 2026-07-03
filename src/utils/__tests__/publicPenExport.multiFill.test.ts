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

describe("publicPenExport — paint stack", () => {
  it("exports a fills array of length 3, bottom-to-top, with opacity applied to the second stop", () => {
    const node = baseRect({
      fills: [
        createSolidPaint("#ff0000"),
        createSolidPaint("#00ff00", { opacity: 0.5 }),
        createGradientPaint({
          type: "linear",
          stops: [
            { color: "#000000", position: 0 },
            { color: "#ffffff", position: 1 },
          ],
          startX: 0,
          startY: 0,
          endX: 1,
          endY: 0,
        }),
      ],
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fill).toBeUndefined();
    expect(exported.fills).toEqual([
      "#ff0000",
      { type: "color", color: "#00ff0080" },
      {
        type: "gradient",
        gradientType: "linear",
        colors: [
          { color: "#000000", position: 0 },
          { color: "#ffffff", position: 1 },
        ],
        center: { x: 0.5, y: 0 },
        size: { height: 1 },
      },
    ]);
  });

  it("excludes a hidden paint (visible: false)", () => {
    const node = baseRect({
      fills: [
        createSolidPaint("#ff0000"),
        createSolidPaint("#00ff00", { visible: false }),
        createSolidPaint("#0000ff"),
      ],
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fills).toEqual(["#ff0000", "#0000ff"]);
  });

  it("keeps back-compat: legacy fill only exports scalar fill, no fills key", () => {
    const node = baseRect({ fill: "#123456" });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fill).toBe("#123456");
    expect(exported.fills).toBeUndefined();
  });

  it("exports a scalar fill (no fills key) when fills has exactly one paint", () => {
    const node = baseRect({
      fills: [createSolidPaint("#abcdef")],
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fill).toBe("#abcdef");
    expect(exported.fills).toBeUndefined();
  });
});
