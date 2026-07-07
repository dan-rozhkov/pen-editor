import { describe, expect, it } from "vitest";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import {
  createGradientPaint,
  createPatternPaint,
  createSolidPaint,
} from "@/utils/fillUtils";
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

  it("keeps back-compat: legacy gradientFill + fillOpacity exports gradient with opacity", () => {
    const node = baseRect({
      gradientFill: {
        type: "linear",
        stops: [
          { color: "#000000", position: 0 },
          { color: "#ffffff", position: 1 },
        ],
        startX: 0,
        startY: 0,
        endX: 1,
        endY: 0,
      },
      fillOpacity: 0.5,
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fills).toBeUndefined();
    expect(exported.fill).toEqual({
      type: "gradient",
      gradientType: "linear",
      colors: [
        { color: "#000000", position: 0 },
        { color: "#ffffff", position: 1 },
      ],
      center: { x: 0.5, y: 0 },
      size: { height: 1 },
      opacity: 0.5,
    });
  });

  it("keeps back-compat: legacy imageFill + fillOpacity exports image with opacity", () => {
    const node = baseRect({
      imageFill: { url: "https://example.com/img.png", mode: "fill" },
      fillOpacity: 0.5,
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fills).toBeUndefined();
    expect(exported.fill).toEqual({
      type: "image",
      url: "https://example.com/img.png",
      mode: "fill",
      opacity: 0.5,
    });
  });

  it("collapses to scalar fill when only one paint remains after hiding", () => {
    const node = baseRect({
      fills: [
        createSolidPaint("#ff0000"),
        createSolidPaint("#00ff00", { visible: false }),
      ],
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.fill).toBe("#ff0000");
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

describe("publicPenExport — pattern paint", () => {
  it("exports a bare pattern paint with only the tile url (defaults omitted)", () => {
    const node = baseRect({
      fills: [createPatternPaint({ url: "https://example.com/tile.png" })],
    });

    const doc = exportNodes([node]);
    expect(doc.children[0].fill).toEqual({
      type: "pattern",
      url: "https://example.com/tile.png",
    });
  });

  it("exports all tiling params and layer opacity when set", () => {
    const node = baseRect({
      fills: [
        createSolidPaint("#ffffff"),
        createPatternPaint(
          {
            url: "https://example.com/tile.png",
            scale: 0.5,
            spacingX: 4,
            spacingY: 6,
            offsetX: 2,
            offsetY: -3,
            rowOffset: 0.5,
          },
          { opacity: 0.8 },
        ),
      ],
    });

    const doc = exportNodes([node]);
    expect(doc.children[0].fills).toEqual([
      "#ffffff",
      {
        type: "pattern",
        url: "https://example.com/tile.png",
        scale: 0.5,
        spacingX: 4,
        spacingY: 6,
        offsetX: 2,
        offsetY: -3,
        rowOffset: 0.5,
        opacity: 0.8,
      },
    ]);
  });

  it("excludes a hidden pattern paint", () => {
    const node = baseRect({
      fills: [
        createSolidPaint("#ff0000"),
        createPatternPaint({ url: "https://x/t.png" }, { visible: false }),
      ],
    });

    const doc = exportNodes([node]);
    expect(doc.children[0].fill).toBe("#ff0000");
    expect(doc.children[0].fills).toBeUndefined();
  });
});
