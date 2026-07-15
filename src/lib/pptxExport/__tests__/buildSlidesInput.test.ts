import { describe, it, expect } from "vitest";

import { buildSlidesInput, needsRaster } from "../buildSlidesInput";
import type { BuildDeps } from "../buildSlidesInput";
import { getRenderableStrokes } from "@/utils/fillUtils";
import type {
  FrameNode,
  RectNode,
  EllipseNode,
  TextNode,
  LineNode,
  GroupNode,
  RefNode,
  SceneNode,
} from "@/types/scene";

const deps: BuildDeps = {
  layoutChildren: (f) => f.children,
  resolveRef: () => null,
  getNodeFills: (n) => n.fills ?? [],
  getNodeStrokes: (n) => getRenderableStrokes(n),
  getNodeEffects: (n) => n.effects ?? [],
  resolveColor: (lookup) => lookup.color,
  rasterizeNode: () => new Uint8Array([1, 2, 3]),
};

function frame(partial: Partial<FrameNode> = {}): FrameNode {
  return { id: "f1", type: "frame", name: "Slide", x: 0, y: 0, width: 960, height: 540, children: [], ...partial };
}
function rect(partial: Partial<RectNode> = {}): RectNode {
  return { id: "r1", type: "rect", name: "Rect", x: 0, y: 0, width: 100, height: 50, ...partial };
}
function ellipse(partial: Partial<EllipseNode> = {}): EllipseNode {
  return { id: "e1", type: "ellipse", name: "Ellipse", x: 0, y: 0, width: 50, height: 50, ...partial };
}
function text(partial: Partial<TextNode> = {}): TextNode {
  return { id: "t1", type: "text", name: "Text", x: 0, y: 0, width: 100, height: 20, text: "Hi", ...partial };
}
function line(partial: Partial<LineNode> = {}): LineNode {
  return { id: "l1", type: "line", name: "Line", x: 0, y: 0, width: 100, height: 0, points: [0, 0, 100, 0], ...partial };
}
function group(partial: Partial<GroupNode> = {}): GroupNode {
  return { id: "g1", type: "group", name: "Group", x: 0, y: 0, width: 100, height: 100, children: [], ...partial };
}

describe("needsRaster", () => {
  it("path/polygon/embed always raster", () => {
    expect(needsRaster({ ...rect(), type: "path" } as unknown as SceneNode, [], [])).toBe(true);
    expect(needsRaster({ ...rect(), type: "polygon" } as unknown as SceneNode, [], [])).toBe(true);
    expect(needsRaster({ ...rect(), type: "embed" } as unknown as SceneNode, [], [])).toBe(true);
  });

  it("shader present rasters", () => {
    expect(needsRaster(rect({ shader: { kind: "waves", params: {} } }), [], [])).toBe(true);
  });

  it("visible blur/background-blur effect rasters", () => {
    expect(needsRaster(rect(), [], [{ type: "blur", radius: 4 }])).toBe(true);
    expect(needsRaster(rect(), [], [{ type: "background-blur", radius: 4 }])).toBe(true);
    expect(needsRaster(rect(), [], [{ type: "blur", radius: 4, visible: false }])).toBe(false);
  });

  it("image/pattern/video paint rasters", () => {
    expect(needsRaster(rect(), [{ id: "p", type: "image", image: { url: "x", mode: "fill" } }], [])).toBe(true);
    expect(
      needsRaster(rect(), [{ id: "p", type: "pattern", pattern: { url: "x" } }], []),
    ).toBe(true);
    expect(
      needsRaster(rect(), [{ id: "p", type: "video", video: { src: "x", mode: "fill", playback: { autoplay: true, loop: true, muted: true } } }], []),
    ).toBe(true);
  });

  it("more than one visible paint rasters", () => {
    expect(
      needsRaster(
        rect(),
        [
          { id: "p1", type: "solid", color: "#fff" },
          { id: "p2", type: "solid", color: "#000" },
        ],
        [],
      ),
    ).toBe(true);
  });

  it("a hidden second paint does not raster", () => {
    expect(
      needsRaster(
        rect(),
        [
          { id: "p1", type: "solid", color: "#fff" },
          { id: "p2", type: "solid", color: "#000", visible: false },
        ],
        [],
      ),
    ).toBe(false);
  });

  it("non-normal blend mode rasters", () => {
    expect(
      needsRaster(rect(), [{ id: "p", type: "solid", color: "#fff", blendMode: "multiply" }], []),
    ).toBe(true);
  });

  it("ellipse arc/donut rasters", () => {
    expect(needsRaster(ellipse({ sweepAngle: 180 }), [], [])).toBe(true);
    expect(needsRaster(ellipse({ innerRadiusRatio: 0.5 }), [], [])).toBe(true);
    expect(needsRaster(ellipse({ sweepAngle: 360 }), [], [])).toBe(false);
  });

  it("rotated container rasters, rotated leaf does not", () => {
    expect(needsRaster(frame({ rotation: 20 }), [], [])).toBe(true);
    expect(needsRaster(group({ rotation: 20 }), [], [])).toBe(true);
    expect(needsRaster(rect({ rotation: 20 }), [], [])).toBe(false);
  });

  it("a masked child forces the parent container to raster", () => {
    expect(needsRaster(frame({ children: [rect({ isMask: true })] }), [], [])).toBe(true);
  });
});

describe("buildSlidesInput", () => {
  it("frame background becomes a full-slide rect shape", () => {
    const input = buildSlidesInput([frame({ fills: [{ id: "p1", type: "solid", color: "#ffffff" }] })], deps);
    const shape = input.slides[0].shapes[0];
    expect(shape).toMatchObject({
      kind: "rect",
      rect: { x: 0, y: 0, width: 960, height: 540 },
      fill: { kind: "solid", rgb: "FFFFFF", alpha: 1 },
    });
  });

  it("smaller second frame is scaled and centered", () => {
    const s1 = frame({ id: "a", width: 960, height: 540 });
    const s2 = frame({
      id: "b",
      width: 480,
      height: 270,
      children: [
        rect({
          x: 0,
          y: 0,
          width: 480,
          height: 270,
          fills: [{ id: "p", type: "solid", color: "#000000" }],
        }),
      ],
    });
    const input = buildSlidesInput([s1, s2], deps);
    expect(input.widthPx).toBe(960);
    // 480×270 → fitScale 2, offset 0: child covers the full slide
    const shape = input.slides[1].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") {
      expect(shape.rect).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    }
  });

  it("image-filled rect becomes a picture via rasterizeNode", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [rect({ fills: [{ id: "p", type: "image", image: { url: "data:x", mode: "fill" } }] })],
        }),
      ],
      deps,
    );
    expect(input.slides[0].shapes[0].kind).toBe("picture");
  });

  it("a slide frame whose own background can't map (image fill) rasters the whole slide", () => {
    // The slide frame itself has an image fill — it must degrade to a single
    // full-slide picture, not silently drop the background and only emit
    // children.
    const input = buildSlidesInput(
      [
        frame({
          fills: [{ id: "p", type: "image", image: { url: "data:x", mode: "fill" } }],
          children: [rect({ fills: [{ id: "c", type: "solid", color: "#000000" }] })],
        }),
      ],
      deps,
    );
    expect(input.slides[0].shapes).toHaveLength(1);
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("picture");
    if (shape.kind === "picture") {
      expect(shape.rect).toEqual({ x: 0, y: 0, width: 960, height: 540 });
    }
  });

  it("rasterizeNode returning null skips the node", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [rect({ fills: [{ id: "p", type: "image", image: { url: "data:x", mode: "fill" } }] })],
        }),
      ],
      { ...deps, rasterizeNode: () => null },
    );
    expect(input.slides[0].shapes).toHaveLength(0);
  });

  it("nested offsets accumulate through frame > group > rect", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            group({
              x: 10,
              y: 20,
              children: [rect({ x: 5, y: 5, width: 20, height: 20, stroke: "#000", strokeWidth: 1 })],
            }),
          ],
        }),
      ],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") {
      expect(shape.rect).toMatchObject({ x: 15, y: 25 });
    }
  });

  it("ref nodes are resolved via deps.resolveRef and walked at the ref position", () => {
    // Mirrors resolveRefToTree: the resolved tree carries the ref's own x/y/width/height.
    const target = rect({ id: "resolved", x: 30, y: 30, width: 40, height: 40 });
    const refNode: RefNode = {
      id: "ref1",
      type: "ref",
      componentId: "comp1",
      x: 30,
      y: 30,
      width: 40,
      height: 40,
    };
    const input = buildSlidesInput(
      [frame({ children: [refNode] })],
      { ...deps, resolveRef: () => target },
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") {
      expect(shape.rect).toMatchObject({ x: 30, y: 30 });
    }
  });

  it("ref resolving to null is skipped without crashing", () => {
    const refNode: RefNode = { id: "ref1", type: "ref", componentId: "comp1", x: 0, y: 0, width: 10, height: 10 };
    const input = buildSlidesInput([frame({ children: [refNode] })], { ...deps, resolveRef: () => null });
    expect(input.slides[0].shapes).toHaveLength(0);
  });

  it("skips invisible/disabled/zero-opacity/connector nodes", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            rect({ id: "hidden1", visible: false }),
            rect({ id: "hidden2", enabled: false }),
            rect({ id: "hidden3", opacity: 0 }),
            { id: "conn1", type: "connector", name: "c", x: 0, y: 0, width: 1, height: 1, startConnection: { nodeId: "a", anchor: "top" }, endConnection: { nodeId: "b", anchor: "top" }, points: [0, 0, 1, 1] },
          ],
        }),
      ],
      deps,
    );
    expect(input.slides[0].shapes).toHaveLength(0);
  });

  it("text mapping: transform, align, anchor, and bold weight >= 600", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            text({
              text: "hello",
              textTransform: "uppercase",
              textAlign: "center",
              textAlignVertical: "middle",
              fontWeight: "700",
            }),
          ],
        }),
      ],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("text");
    if (shape.kind === "text") {
      expect(shape.paragraphs).toEqual([{ text: "HELLO", align: "ctr" }]);
      expect(shape.anchor).toBe("ctr");
      expect(shape.font.bold).toBe(true);
    }
  });

  it("gradient angle math: vertical vector (0,0)→(0,1) is 90deg", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            rect({
              fills: [
                {
                  id: "p",
                  type: "gradient",
                  gradient: {
                    type: "linear",
                    startX: 0,
                    startY: 0,
                    endX: 0,
                    endY: 1,
                    stops: [
                      { color: "#ffffff", position: 0 },
                      { color: "#000000", position: 1 },
                    ],
                  },
                },
              ],
            }),
          ],
        }),
      ],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect" && shape.fill?.kind === "gradient") {
      expect(shape.fill.angleDeg).toBe(90);
    }
  });

  it("per-side stroke collapses to the max side width", () => {
    const input = buildSlidesInput(
      [frame({ children: [rect({ stroke: "#000000", strokeWidthPerSide: { top: 1, right: 3, bottom: 2, left: 0 } })] })],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") expect(shape.stroke?.widthPx).toBe(3);
  });

  it("gradient stroke is approximated with its first stop's color", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            rect({
              strokeWidth: 4,
              strokes: [
                {
                  id: "s",
                  type: "gradient",
                  gradient: {
                    type: "linear",
                    startX: 0,
                    startY: 0,
                    endX: 1,
                    endY: 0,
                    stops: [
                      { color: "#ff0000", position: 0 },
                      { color: "#0000ff", position: 1 },
                    ],
                  },
                },
              ],
            }),
          ],
        }),
      ],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") {
      expect(shape.stroke).toMatchObject({ rgb: "FF0000", widthPx: 4 });
    }
  });

  it("multi-paint stroke stack approximates with the topmost visible paint", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            rect({
              strokeWidth: 2,
              strokes: [
                { id: "bottom", type: "solid", color: "#000000" },
                { id: "top", type: "solid", color: "#00ff00" },
              ],
            }),
          ],
        }),
      ],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") expect(shape.stroke).toMatchObject({ rgb: "00FF00", widthPx: 2 });
  });

  it("stroke stack with only a hidden paint yields no stroke, not a crash", () => {
    const input = buildSlidesInput(
      [frame({ children: [rect({ strokeWidth: 2, strokes: [{ id: "s", type: "solid", color: "#000", visible: false }] })] })],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") expect(shape.stroke).toBeUndefined();
  });

  it("shadow effect mapping", () => {
    const input = buildSlidesInput(
      [
        frame({
          children: [
            rect({
              effects: [
                { type: "shadow", shadowType: "outer", color: "#00000080", offset: { x: 0, y: 4 }, blur: 8, spread: 0 },
              ],
            }),
          ],
        }),
      ],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") {
      expect(shape.shadows).toHaveLength(1);
      expect(shape.shadows?.[0]).toMatchObject({ variant: "outer", offsetY: 4, blurPx: 8 });
    }
  });

  it("rect corner radii: per-corner overrides uniform, only emitted when > 0", () => {
    const withUniform = buildSlidesInput([frame({ children: [rect({ cornerRadius: 8 })] })], deps);
    const shape1 = withUniform.slides[0].shapes[0];
    expect(shape1.kind).toBe("rect");
    if (shape1.kind === "rect") expect(shape1.cornerRadii).toEqual([8, 8, 8, 8]);

    const withPerCorner = buildSlidesInput(
      [frame({ children: [rect({ cornerRadius: 8, cornerRadiusPerCorner: { topLeft: 2 } })] })],
      deps,
    );
    const shape2 = withPerCorner.slides[0].shapes[0];
    expect(shape2.kind).toBe("rect");
    if (shape2.kind === "rect") expect(shape2.cornerRadii).toEqual([2, 8, 8, 8]);

    const sharp = buildSlidesInput([frame({ children: [rect()] })], deps);
    const shape3 = sharp.slides[0].shapes[0];
    expect(shape3.kind).toBe("rect");
    if (shape3.kind === "rect") expect(shape3.cornerRadii).toBeUndefined();
  });

  it("line endpoints are absolute and pass through cap styles", () => {
    const input = buildSlidesInput(
      [frame({ children: [line({ x: 10, y: 20, points: [0, 0, 50, 0], stroke: "#ff0000", endCap: "arrow" })] })],
      deps,
    );
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("line");
    if (shape.kind === "line") {
      expect(shape).toMatchObject({ x1: 10, y1: 20, x2: 60, y2: 20, endCap: "arrow" });
    }
  });

  it("leaf rotation passes through as rotationDeg", () => {
    const input = buildSlidesInput([frame({ children: [rect({ rotation: 33, stroke: "#000", strokeWidth: 1 })] })], deps);
    const shape = input.slides[0].shapes[0];
    expect(shape.kind).toBe("rect");
    if (shape.kind === "rect") expect(shape.rotationDeg).toBe(33);
  });

  it("group nodes have no own visuals and simply walk children", () => {
    const input = buildSlidesInput(
      [frame({ children: [group({ children: [rect({ stroke: "#000", strokeWidth: 1 })] })] })],
      deps,
    );
    expect(input.slides[0].shapes).toHaveLength(1);
    expect(input.slides[0].shapes[0].kind).toBe("rect");
  });
});
