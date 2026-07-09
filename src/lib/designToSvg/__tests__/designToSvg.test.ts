import { describe, it, expect } from "vitest";
import { convertDesignNodesToSvg } from "../index";
import { seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import type {
  EllipseNode,
  FlatFrameNode,
  FlatGroupNode,
  FlatSceneNode,
  GradientFill,
  LineNode,
  Paint,
  PolygonNode,
  RectNode,
  TextNode,
} from "@/types/scene";

function frame(id: string, extra: Partial<FlatFrameNode> = {}): FlatFrameNode {
  return {
    id,
    type: "frame",
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    ...extra,
  } as FlatFrameNode;
}

function rect(id: string, extra: Partial<RectNode> = {}): RectNode {
  return {
    id,
    type: "rect",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    ...extra,
  } as RectNode;
}

function ellipse(id: string, extra: Partial<EllipseNode> = {}): EllipseNode {
  return {
    id,
    type: "ellipse",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    ...extra,
  } as EllipseNode;
}

function text(id: string, extra: Partial<TextNode> = {}): TextNode {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    text: "Hello",
    ...extra,
  } as TextNode;
}

function line(id: string, extra: Partial<LineNode> = {}): LineNode {
  return {
    id,
    type: "line",
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    points: [0, 0, 100, 0],
    stroke: "#000000",
    strokeWidth: 2,
    ...extra,
  } as LineNode;
}

function polygon(id: string, extra: Partial<PolygonNode> = {}): PolygonNode {
  return {
    id,
    type: "polygon",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [50, 0, 100, 100, 0, 100],
    fill: "#0000ff",
    ...extra,
  } as PolygonNode;
}

describe("convertDesignNodesToSvg", () => {
  it("returns an empty svg with a warning when the root id is missing", () => {
    const result = convertDesignNodesToSvg("missing", {}, {});
    expect(result.svg).toBe("");
    expect(result.warnings).toEqual(["Node not found: missing"]);
  });

  it("exports a frame with a solid rect and text as a valid SVG document", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1", { fill: "#ffffff" }),
      rect1: rect("rect1", { fill: "#ff0000", cornerRadius: 4 }),
      text1: text("text1", { x: 10, y: 100, fontSize: 16, fill: "#000000" }),
    };
    const childrenById = { frame1: ["rect1", "text1"] };

    const { svg, warnings } = convertDesignNodesToSvg("frame1", nodesById, childrenById);

    expect(warnings).toEqual([]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('width="200" height="150"');
    expect(svg).toContain('viewBox="0 0 200 150"');
    // rect1 translated by its own local x/y, filled + rounded.
    expect(svg).toContain('translate(10 20)');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('rx="4" ry="4"');
    // text renders as a real <text> element with escaped content.
    expect(svg).toContain("<text");
    expect(svg).toContain(">Hello<");
  });

  it("wraps a linked text node in an <a> anchor with underline and link color", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1"),
      text1: text("text1", { link: { url: "https://example.com" } }),
    };
    const { svg } = convertDesignNodesToSvg("frame1", { ...nodesById }, { frame1: ["text1"] });
    expect(svg).toContain('<a href="https://example.com" target="_blank" rel="noopener">');
    // No explicit fill → default link blue, and links force an underline.
    expect(svg).toContain('fill="#0d99ff"');
    expect(svg).toContain('text-decoration="underline"');
  });

  it("omits the anchor for an unsafe javascript: link URL", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1"),
      text1: text("text1", { link: { url: "javascript:alert(1)" } }),
    };
    const { svg } = convertDesignNodesToSvg("frame1", { ...nodesById }, { frame1: ["text1"] });
    expect(svg).not.toContain("<a ");
    expect(svg).not.toContain("javascript:");
  });

  it("root node does not get an extra translate offset", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1", { x: 500, y: 500 }),
    };
    const { svg } = convertDesignNodesToSvg("frame1", nodesById, {});
    expect(svg).not.toContain("translate(500 500)");
  });

  it("renders a gradient fill as a <linearGradient> def referenced via url()", () => {
    const gradient: GradientFill = {
      type: "linear",
      stops: [
        { color: "#ff0000", position: 0 },
        { color: "#0000ff", position: 1 },
      ],
      startX: 0,
      startY: 0,
      endX: 1,
      endY: 0,
    };
    const fills: Paint[] = [{ id: "p1", type: "gradient", gradient }];
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", { fills }),
    };
    const { svg } = convertDesignNodesToSvg("rect1", nodesById, {});

    expect(svg).toContain("<defs>");
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('fill="url(#');
  });

  it("emits a feDropShadow filter for a shadow effect", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        fill: "#ffffff",
        effects: [
          {
            type: "shadow",
            shadowType: "outer",
            color: "#00000080",
            offset: { x: 2, y: 4 },
            blur: 8,
            spread: 0,
          },
        ],
      }),
    };
    const { svg, warnings } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(warnings).toEqual([]);
    expect(svg).toContain("<filter");
    expect(svg).toContain("<feDropShadow");
    expect(svg).toContain('filter="url(#');
  });

  it("applies a feGaussianBlur filter for a layer blur effect", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", { effects: [{ type: "blur", radius: 10 }] }),
    };
    const { svg } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).toContain("<feGaussianBlur");
    expect(svg).toContain('stdDeviation="5"');
  });

  it("warns and skips inner shadows", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        effects: [
          {
            type: "shadow",
            shadowType: "inner",
            color: "#000000",
            offset: { x: 0, y: 0 },
            blur: 4,
            spread: 0,
          },
        ],
      }),
    };
    const { svg, warnings } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).not.toContain("<filter");
    expect(warnings.some((w) => w.includes("Inner shadow"))).toBe(true);
  });

  it("warns with a paint-specific message and skips an image fill", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        fills: [
          { id: "p1", type: "image", image: { url: "https://example.com/a.png", mode: "fill" } },
        ] as unknown as Paint[],
      }),
    };
    const { warnings } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(warnings.some((w) => w.includes("Image fill") && w.includes("not supported"))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes("Pattern fill"))).toBe(false);
  });

  it("warns with a paint-specific message and skips a pattern fill", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        fills: [
          { id: "p1", type: "pattern", pattern: { url: "https://example.com/tile.png" } },
        ] as unknown as Paint[],
      }),
    };
    const { warnings } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(warnings.some((w) => w.includes("Pattern fill") && w.includes("not supported"))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes("Image fill"))).toBe(false);
  });

  it("renders an ellipse as a real <ellipse> element", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      ellipse1: ellipse("ellipse1", { fill: "#00ff00" }),
    };
    const { svg } = convertDesignNodesToSvg("ellipse1", nodesById, {});
    expect(svg).toContain("<ellipse");
    expect(svg).toContain('cx="20" cy="20" rx="20" ry="20"');
    expect(svg).toContain('fill="#00ff00"');
  });

  it("renders a plain ellipse as <ellipse> even with explicit default arc params", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      ellipse1: ellipse("ellipse1", { startAngle: 0, sweepAngle: 360, innerRadiusRatio: 0 }),
    };
    const { svg } = convertDesignNodesToSvg("ellipse1", nodesById, {});
    expect(svg).toContain("<ellipse");
  });

  it("renders a pie slice (partial sweep, no hole) as a single <path>", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      ellipse1: ellipse("ellipse1", { fill: "#00ff00", sweepAngle: 90 }),
    };
    const { svg } = convertDesignNodesToSvg("ellipse1", nodesById, {});
    expect(svg).not.toContain("<ellipse");
    expect(svg).toContain("<path");
    // Single M...Z subpath.
    expect(svg.match(/M/g)?.length).toBe(1);
  });

  it("renders a full donut as a <path> with two M...Z subpaths (hole via winding)", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      ellipse1: ellipse("ellipse1", { fill: "#00ff00", innerRadiusRatio: 0.5 }),
    };
    const { svg } = convertDesignNodesToSvg("ellipse1", nodesById, {});
    expect(svg).toContain("<path");
    expect(svg.match(/M/g)?.length).toBe(2);
  });

  it("renders a star polygon using its explicit points (no special-casing needed)", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      star1: polygon("star1", {
        sides: 5,
        innerRadiusRatio: 0.5,
        points: [50, 0, 60, 40, 100, 40, 70, 65, 80, 100, 50, 80, 20, 100, 30, 65, 0, 40, 40, 40],
      }),
    };
    const { svg } = convertDesignNodesToSvg("star1", nodesById, {});
    expect(svg).toContain("<polygon");
    expect(svg).toContain('points="50,0 60,40 100,40');
  });

  it("renders a line with no markers when caps are unset", () => {
    const nodesById: Record<string, FlatSceneNode> = { line1: line("line1") };
    const { svg } = convertDesignNodesToSvg("line1", nodesById, {});
    expect(svg).toContain("<line");
    expect(svg).not.toContain("marker-start");
    expect(svg).not.toContain("marker-end");
    expect(svg).not.toContain("<marker");
  });

  it("adds marker-start/marker-end defs for line arrowhead caps", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      line1: line("line1", { startCap: "circle", endCap: "triangle" }),
    };
    const { svg } = convertDesignNodesToSvg("line1", nodesById, {});
    expect(svg).toContain("marker-start=");
    expect(svg).toContain("marker-end=");
    expect(svg.match(/<marker/g)?.length).toBe(2);
    expect(svg).toContain("<circle");
    expect(svg).toContain("<polygon");
    // Start marker auto-reverses, end marker just auto-orients.
    expect(svg).toContain('orient="auto-start-reverse"');
    expect(svg).toContain('orient="auto"');
  });

  it("anchors cap markers at refX=0 refY=0 (viewBox coordinates, not an (minX,minY) offset)", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      line1: line("line1", { startCap: "triangle", endCap: "triangle" }),
    };
    const { svg } = convertDesignNodesToSvg("line1", nodesById, {});
    const markerDefs = svg.match(/<marker[^>]*>/g) ?? [];
    expect(markerDefs.length).toBe(2);
    for (const def of markerDefs) {
      expect(def).toContain('refX="0"');
      expect(def).toContain('refY="0"');
    }
  });

  it("renders a non-zero-size marker for the 'bar' cap (a naive bbox collapses to width=0)", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      line1: line("line1", { startCap: "bar", endCap: "none" }),
    };
    const { svg } = convertDesignNodesToSvg("line1", nodesById, {});
    const def = svg.match(/<marker[^>]*>/)?.[0] ?? "";
    const width = Number(def.match(/markerWidth="([^"]+)"/)?.[1]);
    const height = Number(def.match(/markerHeight="([^"]+)"/)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("root <svg> is overflow:visible so cap markers/overflow aren't clipped when the root doesn't clip", () => {
    const nodesById: Record<string, FlatSceneNode> = { line1: line("line1", { endCap: "triangle" }) };
    const { svg } = convertDesignNodesToSvg("line1", nodesById, {});
    expect(svg).toMatch(/^<svg[^>]*overflow="visible"/);
  });

  it("root <svg> clips when the root frame has clip:true", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1", { clip: true }),
    };
    const { svg } = convertDesignNodesToSvg("frame1", nodesById, {});
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/^<svg[^>]*overflow="visible"/);
  });

  it("builds a per-corner rounded rect as a <path> when radii differ", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        fill: "#ff0000",
        cornerRadiusPerCorner: { topLeft: 0, topRight: 10, bottomRight: 0, bottomLeft: 0 },
      }),
    };
    const { svg } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).toContain("<path");
    expect(svg).toContain('fill="#ff0000"');
  });

  it("keeps plain <rect rx/ry> (arc-only) output when cornerSmoothing is unset or 0", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", { fill: "#ff0000", cornerRadius: 12, cornerSmoothing: 0 }),
    };
    const { svg } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).toContain("<rect");
    expect(svg).toContain('rx="12" ry="12"');
    expect(svg).not.toContain("<path");
  });

  it("builds a squircle <path> with cubic bezier (C) commands when cornerSmoothing > 0", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", { fill: "#ff0000", cornerRadius: 12, cornerSmoothing: 0.6 }),
    };
    const { svg } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).toContain("<path");
    expect(svg).toMatch(/d="[^"]*C[^"]*"/);
    // Still has the arc portion for the remaining part of each corner.
    expect(svg).toMatch(/d="[^"]*A[^"]*"/);
    expect(svg).not.toContain("<rect");
  });

  it("applies cornerSmoothing to independent per-corner radii together", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        fill: "#ff0000",
        cornerRadiusPerCorner: { topLeft: 0, topRight: 20, bottomRight: 0, bottomLeft: 0 },
        cornerSmoothing: 0.6,
      }),
    };
    const { svg } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).toContain("<path");
    expect(svg).toMatch(/d="[^"]*C[^"]*"/);
  });

  it("emulates inside/outside stroke alignment by insetting/expanding rect geometry", () => {
    const insideNodes: Record<string, FlatSceneNode> = {
      r: rect("r", { width: 100, height: 100, stroke: "#000000", strokeWidth: 10, strokeAlign: "inside" }),
    };
    const { svg: insideSvg } = convertDesignNodesToSvg("r", insideNodes, {});
    expect(insideSvg).toContain('x="5" y="5" width="90" height="90"');

    const outsideNodes: Record<string, FlatSceneNode> = {
      r: rect("r", { width: 100, height: 100, stroke: "#000000", strokeWidth: 10, strokeAlign: "outside" }),
    };
    const { svg: outsideSvg } = convertDesignNodesToSvg("r", outsideNodes, {});
    expect(outsideSvg).toContain('x="-5" y="-5" width="110" height="110"');
  });

  it("replaces an embed node with a placeholder and records a warning", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1"),
      embed1: { id: "embed1", type: "embed", x: 0, y: 0, width: 50, height: 50, htmlContent: "<div>hi</div>" },
    };
    const { svg, warnings } = convertDesignNodesToSvg("frame1", nodesById, { frame1: ["embed1"] });
    expect(svg).toContain("stroke-dasharray");
    expect(warnings.some((w) => w.includes("Embed node"))).toBe(true);
  });

  it("replaces a component instance (ref) node with a placeholder and records a warning", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1"),
      ref1: { id: "ref1", type: "ref", x: 0, y: 0, width: 50, height: 50, componentId: "comp1" },
    };
    const { warnings } = convertDesignNodesToSvg("frame1", nodesById, { frame1: ["ref1"] });
    expect(warnings.some((w) => w.includes("Component instance"))).toBe(true);
  });

  it("warns when a node carries a shader but still renders its base fill", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      rect1: rect("rect1", {
        fill: "#ff0000",
        shader: { kind: "meshGradient", params: {} },
      }),
    };
    const { svg, warnings } = convertDesignNodesToSvg("rect1", nodesById, {});
    expect(svg).toContain('fill="#ff0000"');
    expect(warnings.some((w) => w.includes("Shader"))).toBe(true);
  });

  it("skips invisible/disabled nodes", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1"),
      rect1: rect("rect1", { visible: false }),
      rect2: rect("rect2", { enabled: false }),
    };
    const { svg } = convertDesignNodesToSvg("frame1", nodesById, { frame1: ["rect1", "rect2"] });
    // Only the frame's own (fill-less) background rect should render — both
    // children are hidden and contribute no <rect> of their own.
    expect(svg.match(/<rect/g)).toHaveLength(1);
  });

  it("clips a frame's children to its (rounded) bounds via a <clipPath>", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      frame1: frame("frame1", { clip: true, cornerRadius: 8 }),
    };
    const { svg } = convertDesignNodesToSvg("frame1", nodesById, {});
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("clip-path=\"url(#");
  });

  it("clips a group via its clipGeometry path", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      group1: {
        id: "group1",
        type: "group",
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        clipGeometry: "M0 0 L50 0 L25 50 Z",
      } as FlatGroupNode,
    };
    const { svg } = convertDesignNodesToSvg("group1", nodesById, {});
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("M0 0 L50 0 L25 50 Z");
  });

  describe("layer masks", () => {
    it("wraps a masked sibling in <g mask=...> and builds a <mask> def from the masker", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        frame1: frame("frame1"),
        maskShape: ellipse("maskShape", { x: 0, y: 0, width: 40, height: 40, isMask: true }),
        picture: rect("picture", { x: 0, y: 0, width: 100, height: 50, fill: "#00ff00" }),
      };
      const childrenById = { frame1: ["maskShape", "picture"] };

      const { svg, warnings } = convertDesignNodesToSvg("frame1", nodesById, childrenById);

      expect(warnings).toEqual([]);
      // The masker itself is not rendered as normal (unmasked) content.
      expect(svg).not.toMatch(/<g[^>]*>(?!.*mask=)[^<]*<ellipse/);
      expect(svg).toContain("<mask id=");
      expect(svg).toContain("<ellipse");
      expect(svg).toMatch(/<g mask="url\(#pen-svg-mask-\d+\)">.*<rect/);
      expect(svg).toContain('fill="#00ff00"');
    });

    it("does not mask a sibling that renders below the masker", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        frame1: frame("frame1"),
        below: rect("below", { fill: "#111111" }),
        maskShape: rect("maskShape", { isMask: true }),
      };
      const childrenById = { frame1: ["below", "maskShape"] };

      const { svg } = convertDesignNodesToSvg("frame1", nodesById, childrenById);
      expect(svg).not.toContain("mask=\"url(#");
      expect(svg).toContain('fill="#111111"');
    });

    it("shares one <mask> def across every sibling covered by the same masker", () => {
      const nodesById: Record<string, FlatSceneNode> = {
        frame1: frame("frame1"),
        maskShape: rect("maskShape", { isMask: true }),
        a: rect("a", { fill: "#111111" }),
        b: rect("b", { fill: "#222222" }),
      };
      const childrenById = { frame1: ["maskShape", "a", "b"] };

      const { svg } = convertDesignNodesToSvg("frame1", nodesById, childrenById);
      const maskDefCount = (svg.match(/<mask id=/g) ?? []).length;
      expect(maskDefCount).toBe(1);
      const maskRefCount = (svg.match(/mask="url\(#pen-svg-mask-\d+\)"/g) ?? []).length;
      expect(maskRefCount).toBe(2);
    });
  });

  it("matches the project's seed-scene fixture (frame1 with rect1 + text1)", () => {
    useSceneStore.getState();
    seedScene();
    const { nodesById, childrenById } = useSceneStore.getState();
    const { svg, warnings } = convertDesignNodesToSvg("frame1", nodesById, childrenById);

    expect(warnings).toEqual([]);
    expect(svg).toContain('width="400" height="300"');
    // rect1 sits at its own local (10, 20) inside frame1.
    expect(svg).toContain("translate(10 20)");
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain(">Hello<");
  });
});
