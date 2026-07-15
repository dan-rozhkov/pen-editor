import { describe, it, expect, vi } from "vitest";

// happy-dom has no SVGGeometryElement.getBBox(); stub the path measurement so
// VECTOR/BOOLEAN_OPERATION conversion is testable without a real DOM.
vi.mock("../svgUtils", () => ({
  getPathBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
}));

import {
  convertPixsoNode,
  parsePixsoJson,
  parsePixsoNodes,
} from "../pixsoImportUtils";
import type {
  FrameNode,
  GroupNode,
  RectNode,
  EllipseNode,
  TextNode,
  PolygonNode,
  LineNode,
  PathNode,
  SolidPaint,
  ImagePaint,
  ShadowEffect,
  BlurEffect,
  BackgroundBlurEffect,
} from "../../types/scene";

const base = {
  id: "1",
  name: "n",
  type: "RECTANGLE",
  visible: true,
  locked: false,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
};

describe("convertPixsoNode — node types", () => {
  it("RECTANGLE → rect with position/size", () => {
    const n = convertPixsoNode({ ...base }) as RectNode;
    expect(n.type).toBe("rect");
    expect(n).toMatchObject({ x: 10, y: 20, width: 100, height: 50, name: "n" });
  });

  it("ELLIPSE → ellipse", () => {
    const n = convertPixsoNode({ ...base, type: "ELLIPSE" }) as EllipseNode;
    expect(n.type).toBe("ellipse");
  });

  it("ELLIPSE arcData → startAngle/sweepAngle/innerRadiusRatio", () => {
    const n = convertPixsoNode({
      ...base,
      type: "ELLIPSE",
      arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.4 },
    }) as EllipseNode;
    expect(n.type).toBe("ellipse");
    // start 0 is the default and is intentionally omitted.
    expect(n.startAngle ?? 0).toBeCloseTo(0);
    expect(n.sweepAngle).toBeCloseTo(180);
    expect(n.innerRadiusRatio).toBeCloseTo(0.4);
  });

  it("FRAME → frame with children", () => {
    const n = convertPixsoNode({
      ...base,
      type: "FRAME",
      children: [{ ...base, id: "2", type: "RECTANGLE" }],
    }) as FrameNode;
    expect(n.type).toBe("frame");
    expect(n.children).toHaveLength(1);
  });

  it("COMPONENT → reusable frame", () => {
    const n = convertPixsoNode({ ...base, type: "COMPONENT", children: [] }) as FrameNode;
    expect(n.type).toBe("frame");
    expect(n.reusable).toBe(true);
  });

  it("COMPONENT_SET → frame (variant container)", () => {
    const n = convertPixsoNode({ ...base, type: "COMPONENT_SET", children: [] }) as FrameNode;
    expect(n.type).toBe("frame");
  });

  it("INSTANCE → flattened frame", () => {
    const n = convertPixsoNode({ ...base, type: "INSTANCE", children: [] }) as FrameNode;
    expect(n.type).toBe("frame");
  });

  it("GROUP → group", () => {
    const n = convertPixsoNode({ ...base, type: "GROUP", children: [] }) as GroupNode;
    expect(n.type).toBe("group");
  });

  it("STAR → polygon star", () => {
    const n = convertPixsoNode({
      ...base,
      type: "STAR",
      pointCount: 5,
      innerRadius: 0.5,
    }) as PolygonNode;
    expect(n.type).toBe("polygon");
    expect(n.sides).toBe(5);
    expect(n.innerRadiusRatio).toBeCloseTo(0.5);
  });

  it("REGULAR_POLYGON → polygon", () => {
    const n = convertPixsoNode({ ...base, type: "REGULAR_POLYGON", pointCount: 3 }) as PolygonNode;
    expect(n.type).toBe("polygon");
    expect(n.sides).toBe(3);
  });

  it("LINE → line", () => {
    const n = convertPixsoNode({ ...base, type: "LINE" }) as LineNode;
    expect(n.type).toBe("line");
    expect(n.points).toEqual([0, 0, 100, 0]);
  });

  it("TEXT → text", () => {
    const n = convertPixsoNode({
      ...base,
      type: "TEXT",
      characters: "hi",
      fontSize: 16,
    }) as TextNode;
    expect(n.type).toBe("text");
    expect(n.text).toBe("hi");
    expect(n.fontSize).toBe(16);
  });

  it("VECTOR with geometry → path", () => {
    const n = convertPixsoNode({
      ...base,
      type: "VECTOR",
      fillGeometry: [{ path: "M0 0 L10 0 L10 10 Z" }],
    }) as PathNode;
    expect(n.type).toBe("path");
    expect(n.geometry).toContain("M0 0");
  });

  it("BOOLEAN_OPERATION with geometry → path", () => {
    const n = convertPixsoNode({
      ...base,
      type: "BOOLEAN_OPERATION",
      fillGeometry: [{ path: "M0 0 L10 0 L10 10 Z" }],
    }) as PathNode;
    expect(n.type).toBe("path");
  });

  it("SLICE → null (skipped)", () => {
    expect(convertPixsoNode({ ...base, type: "SLICE" })).toBeNull();
  });

  it("unknown type with children → frame fallback", () => {
    const n = convertPixsoNode({
      ...base,
      type: "WHATEVER",
      children: [{ ...base, id: "2", type: "RECTANGLE" }],
    }) as FrameNode;
    expect(n.type).toBe("frame");
    expect(n.children).toHaveLength(1);
  });

  it("unknown leaf type → rect fallback", () => {
    const n = convertPixsoNode({ ...base, type: "WHATEVER" }) as RectNode;
    expect(n.type).toBe("rect");
  });
});

describe("convertPixsoNode — common properties", () => {
  it("opacity", () => {
    const n = convertPixsoNode({ ...base, opacity: 0.5 }) as RectNode;
    expect(n.opacity).toBe(0.5);
  });

  it("opacity omitted when 1", () => {
    const n = convertPixsoNode({ ...base, opacity: 1 }) as RectNode;
    expect(n.opacity).toBeUndefined();
  });

  it("rotation negated (Figma CCW → our CW)", () => {
    const n = convertPixsoNode({ ...base, rotation: 30 }) as RectNode;
    expect(n.rotation).toBe(-30);
  });

  it("visible false", () => {
    const n = convertPixsoNode({ ...base, visible: false }) as RectNode;
    expect(n.visible).toBe(false);
  });

  it("single solid fill → legacy fill", () => {
    const n = convertPixsoNode({
      ...base,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    }) as RectNode;
    expect(n.fill).toBe("#ff0000");
  });

  it("multiple fills → fills stack", () => {
    const n = convertPixsoNode({
      ...base,
      fills: [
        { type: "SOLID", color: { r: 1, g: 0, b: 0 } },
        { type: "SOLID", color: { r: 0, g: 1, b: 0 }, opacity: 0.5 },
      ],
    }) as RectNode;
    expect(n.fills).toHaveLength(2);
    const top = n.fills![1] as SolidPaint;
    expect(top.type).toBe("solid");
    expect(top.color).toBe("#00ff00");
    expect(top.opacity).toBe(0.5);
  });

  it("gradient fill → gradientFill", () => {
    const n = convertPixsoNode({
      ...base,
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0 } },
            { position: 1, color: { r: 0, g: 0, b: 1 } },
          ],
        },
      ],
    }) as RectNode;
    expect(n.gradientFill?.type).toBe("linear");
    expect(n.gradientFill?.stops).toHaveLength(2);
  });

  it("image fill resolved from image map → fills stack", () => {
    const n = convertPixsoNode(
      {
        ...base,
        fills: [
          { type: "IMAGE", imageHash: "abc", scaleMode: "FILL" },
        ],
      },
      { imageMap: { abc: "data:image/png;base64,AAAA" } },
    ) as RectNode;
    const img = n.fills?.[0] as ImagePaint | undefined;
    expect(img?.type).toBe("image");
    expect(img?.image.url).toBe("data:image/png;base64,AAAA");
    expect(img?.image.mode).toBe("fill");
  });

  it("image fill without bytes → skipped", () => {
    const n = convertPixsoNode({
      ...base,
      fills: [{ type: "IMAGE", imageHash: "missing", scaleMode: "FILL" }],
    }) as RectNode;
    expect(n.fills).toBeUndefined();
    expect(n.imageFill).toBeUndefined();
  });

  it("stroke solid + weight + align", () => {
    const n = convertPixsoNode({
      ...base,
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
      strokeAlign: "INSIDE",
    }) as RectNode;
    expect(n.stroke).toBe("#000000");
    expect(n.strokeWidth).toBe(2);
    expect(n.strokeAlign).toBe("inside");
  });

  it("gradient stroke → strokes stack, not silently dropped", () => {
    const n = convertPixsoNode({
      ...base,
      strokes: [
        {
          type: "GRADIENT_LINEAR",
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0 } },
            { position: 1, color: { r: 0, g: 0, b: 1 } },
          ],
        },
      ],
      strokeWeight: 4,
    }) as RectNode;
    expect(n.stroke).toBeUndefined();
    expect(n.strokes).toHaveLength(1);
    expect(n.strokes![0].type).toBe("gradient");
    expect(n.strokeWidth).toBe(4);
  });

  it("multiple stroke paints → strokes stack", () => {
    const n = convertPixsoNode({
      ...base,
      strokes: [
        { type: "SOLID", color: { r: 0, g: 0, b: 0 } },
        { type: "SOLID", color: { r: 0, g: 1, b: 0 }, opacity: 0.5 },
      ],
      strokeWeight: 2,
    }) as RectNode;
    expect(n.stroke).toBeUndefined();
    expect(n.strokes).toHaveLength(2);
    const top = n.strokes![1] as SolidPaint;
    expect(top.color).toBe("#00ff00");
    expect(top.opacity).toBe(0.5);
  });

  it("image stroke paint is excluded (unsupported on a stroke)", () => {
    const n = convertPixsoNode(
      {
        ...base,
        strokes: [
          { type: "SOLID", color: { r: 0, g: 0, b: 0 } },
          { type: "IMAGE", imageHash: "abc", scaleMode: "FILL" },
        ],
        strokeWeight: 2,
      },
      { imageMap: { abc: "data:image/png;base64,AAAA" } },
    ) as RectNode;
    expect(n.stroke).toBe("#000000");
    expect(n.strokes).toBeUndefined();
  });

  it("effects: drop shadow / inner shadow / blur / bg blur", () => {
    const n = convertPixsoNode({
      ...base,
      effects: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 1, y: 2 }, radius: 4, spread: 1, visible: true },
        { type: "INNER_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 0 }, radius: 3, spread: 0, visible: true },
        { type: "LAYER_BLUR", radius: 8, visible: true },
        { type: "BACKGROUND_BLUR", radius: 12, visible: true },
      ],
    }) as RectNode;
    expect(n.effects).toHaveLength(4);
    const drop = n.effects![0] as ShadowEffect;
    expect(drop.type).toBe("shadow");
    expect(drop.shadowType).toBe("outer");
    expect(drop.offset).toEqual({ x: 1, y: 2 });
    expect(drop.blur).toBe(4);
    expect(drop.spread).toBe(1);
    const inner = n.effects![1] as ShadowEffect;
    expect(inner.shadowType).toBe("inner");
    const blur = n.effects![2] as BlurEffect;
    expect(blur.type).toBe("blur");
    expect(blur.radius).toBe(8);
    const bg = n.effects![3] as BackgroundBlurEffect;
    expect(bg.type).toBe("background-blur");
    expect(bg.radius).toBe(12);
  });
});

describe("convertPixsoNode — code-review regressions", () => {
  it("single gradient with layer opacity → fills stack (opacity preserved)", () => {
    const n = convertPixsoNode({
      ...base,
      fills: [
        {
          type: "GRADIENT_LINEAR",
          opacity: 0.5,
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0 } },
            { position: 1, color: { r: 0, g: 0, b: 1 } },
          ],
        },
      ],
    }) as RectNode;
    expect(n.gradientFill).toBeUndefined();
    expect(n.fills?.[0].type).toBe("gradient");
    expect(n.fills?.[0].opacity).toBe(0.5);
  });

  it("single solid with blendMode → fills stack (blendMode preserved)", () => {
    const n = convertPixsoNode({
      ...base,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, blendMode: "MULTIPLY" }],
    }) as RectNode;
    expect(n.fill).toBeUndefined();
    const p = n.fills?.[0] as SolidPaint;
    expect(p.blendMode).toBe("multiply");
  });

  it("per-side stroke widths keep the stroke color (strokeWeight absent)", () => {
    const n = convertPixsoNode({
      ...base,
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      individualStrokeWeights: { top: 4, right: 0, bottom: 4, left: 0 },
    }) as RectNode;
    expect(n.stroke).toBe("#000000");
    expect(n.strokeWidthPerSide).toEqual({ top: 4, right: 0, bottom: 4, left: 0 });
  });

  it("image CROP scaleMode → fill (aspect-preserving)", () => {
    const n = convertPixsoNode(
      {
        ...base,
        fills: [{ type: "IMAGE", imageHash: "abc", scaleMode: "CROP" }],
      },
      { imageMap: { abc: "data:image/png;base64,AAAA" } },
    ) as RectNode;
    const img = n.fills?.[0] as ImagePaint;
    expect(img.image.mode).toBe("fill");
  });

  it("VECTOR node keeps effects (drop shadow not dropped)", () => {
    const n = convertPixsoNode({
      ...base,
      type: "VECTOR",
      fillGeometry: [{ path: "M0 0 L10 0 L10 10 Z" }],
      effects: [
        { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.3 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true },
      ],
    }) as PathNode;
    expect(n.type).toBe("path");
    expect(n.effects).toHaveLength(1);
    expect((n.effects![0] as ShadowEffect).type).toBe("shadow");
  });

  it("VECTOR node keeps a multi-fill paint stack", () => {
    const n = convertPixsoNode({
      ...base,
      type: "VECTOR",
      fillGeometry: [{ path: "M0 0 L10 0 L10 10 Z" }],
      fills: [
        { type: "SOLID", color: { r: 1, g: 0, b: 0 } },
        { type: "SOLID", color: { r: 0, g: 1, b: 0 }, opacity: 0.5 },
      ],
    }) as PathNode;
    expect(n.type).toBe("path");
    expect(n.fills).toHaveLength(2);
  });
});

describe("convertPixsoNode — frame/layout props", () => {
  it("clipsContent → clip", () => {
    const n = convertPixsoNode({ ...base, type: "FRAME", children: [], clipsContent: true }) as FrameNode;
    expect(n.clip).toBe(true);
  });

  it("cornerSmoothing", () => {
    const n = convertPixsoNode({ ...base, type: "RECTANGLE", cornerRadius: 8, cornerSmoothing: 0.6 }) as RectNode;
    expect(n.cornerSmoothing).toBe(0.6);
  });

  it("auto-layout row with wrap + stretch", () => {
    const n = convertPixsoNode({
      ...base,
      type: "FRAME",
      children: [],
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      layoutWrap: "WRAP",
      counterAxisAlignItems: "STRETCH",
      primaryAxisAlignItems: "SPACE_BETWEEN",
    }) as FrameNode;
    expect(n.layout?.flexDirection).toBe("row");
    expect(n.layout?.gap).toBe(8);
    expect(n.layout?.flexWrap).toBe(true);
    expect(n.layout?.alignItems).toBe("stretch");
    expect(n.layout?.justifyContent).toBe("space-between");
  });

  it("min/max sizing clamps", () => {
    const n = convertPixsoNode({
      ...base,
      type: "FRAME",
      children: [],
      layoutMode: "VERTICAL",
      minWidth: 50,
      maxWidth: 200,
    }) as FrameNode;
    expect(n.sizing?.minWidth).toBe(50);
    expect(n.sizing?.maxWidth).toBe(200);
  });

  it("child layoutPositioning ABSOLUTE → absolutePosition", () => {
    const parent = convertPixsoNode({
      ...base,
      type: "FRAME",
      layoutMode: "VERTICAL",
      children: [{ ...base, id: "2", type: "RECTANGLE", layoutPositioning: "ABSOLUTE" }],
    }) as FrameNode;
    expect(parent.children[0].absolutePosition).toBe(true);
  });

  it("child layoutGrow → fill sizing on primary axis", () => {
    const parent = convertPixsoNode({
      ...base,
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      children: [{ ...base, id: "2", type: "RECTANGLE", layoutGrow: 1 }],
    }) as FrameNode;
    expect(parent.children[0].sizing?.widthMode).toBe("fill_container");
  });
});

describe("convertPixsoNode — text props", () => {
  it("textCase → textTransform", () => {
    const n = convertPixsoNode({ ...base, type: "TEXT", characters: "a", textCase: "UPPER" }) as TextNode;
    expect(n.textTransform).toBe("uppercase");
  });

  it("textAutoResize → textWidthMode", () => {
    const n = convertPixsoNode({ ...base, type: "TEXT", characters: "a", textAutoResize: "WIDTH_AND_HEIGHT" }) as TextNode;
    expect(n.textWidthMode).toBe("auto");
  });

  it("numeric fontWeight from fontName style", () => {
    const n = convertPixsoNode({
      ...base,
      type: "TEXT",
      characters: "a",
      fontName: { family: "Inter", style: "SemiBold" },
    }) as TextNode;
    expect(n.fontWeight).toBe("600");
  });

  it("hyperlink → link", () => {
    const n = convertPixsoNode({
      ...base,
      type: "TEXT",
      characters: "a",
      hyperlink: { type: "URL", value: "https://x.com" },
    }) as TextNode;
    expect(n.link?.url).toBe("https://x.com");
  });

  it("paragraphSpacing + maxLines", () => {
    const n = convertPixsoNode({
      ...base,
      type: "TEXT",
      characters: "a",
      paragraphSpacing: 12,
      maxLines: 3,
    }) as TextNode;
    expect(n.paragraphSpacing).toBe(12);
    expect(n.maxLines).toBe(3);
  });
});

describe("parsePixsoNodes / parsePixsoJson", () => {
  it("bare node", () => {
    const nodes = parsePixsoNodes(JSON.stringify({ ...base }));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("rect");
  });

  it("{ data: node } wrapper", () => {
    const nodes = parsePixsoNodes(JSON.stringify({ data: { ...base } }));
    expect(nodes).toHaveLength(1);
  });

  it("DOCUMENT/PAGE wrapper → unwrap children", () => {
    const nodes = parsePixsoNodes(
      JSON.stringify({
        type: "DOCUMENT",
        children: [
          { type: "PAGE", children: [{ ...base, id: "a" }, { ...base, id: "b", type: "ELLIPSE" }] },
        ],
      }),
    );
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.type).sort()).toEqual(["ellipse", "rect"]);
  });

  it("images map from wrapper resolves image paint", () => {
    const nodes = parsePixsoNodes(
      JSON.stringify({
        data: { ...base, fills: [{ type: "IMAGE", imageHash: "h1", scaleMode: "FIT" }] },
        images: { h1: "data:image/png;base64,ZZZ" },
      }),
    );
    const img = (nodes[0] as RectNode).fills?.[0] as ImagePaint;
    expect(img.image.url).toBe("data:image/png;base64,ZZZ");
    expect(img.image.mode).toBe("fit");
  });

  it("parsePixsoJson returns first root (back-compat)", () => {
    const n = parsePixsoJson(JSON.stringify({ ...base }));
    expect(n.type).toBe("rect");
  });

  it("throws on empty/unsupported", () => {
    expect(() => parsePixsoJson(JSON.stringify({ type: "SLICE" }))).toThrow();
  });
});
