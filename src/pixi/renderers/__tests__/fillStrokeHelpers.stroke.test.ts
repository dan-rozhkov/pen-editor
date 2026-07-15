import { describe, expect, it, vi, afterEach } from "vitest";
import { Graphics } from "pixi.js";
import type { FlatSceneNode, GradientFill } from "@/types/scene";
import { createSolidPaint, createGradientPaint } from "@/utils/fillUtils";
import { applyStroke, buildPixiGradient } from "../fillStrokeHelpers";

function makeNode(props: Partial<FlatSceneNode>): FlatSceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 400, height: 200, ...props } as FlatSceneNode;
}

const linearGradient: GradientFill = {
  type: "linear",
  stops: [
    { color: "#000000", position: 0 },
    { color: "#ffffff", position: 1 },
  ],
  startX: 0,
  startY: 0.5,
  endX: 1,
  endY: 0.5,
};

const radialGradient: GradientFill = {
  ...linearGradient,
  type: "radial",
  startX: 0.5,
  startY: 0.5,
  endX: 0.5,
  endY: 0.5,
  startRadius: 0,
  endRadius: 0.5,
};

describe("buildPixiGradient", () => {
  it("keeps normalized 0..1 local-space coordinates for fills (unchanged default behavior)", () => {
    const g = buildPixiGradient(linearGradient, 400, 200);
    expect(g.textureSpace).toBe("local");
    expect(g.start).toEqual({ x: 0, y: 0.5 });
    expect(g.end).toEqual({ x: 1, y: 0.5 });
  });

  it("forStroke: converts linear gradient endpoints to px-space and switches to textureSpace global", () => {
    const g = buildPixiGradient(linearGradient, 400, 200, { forStroke: true });
    expect(g.textureSpace).toBe("global");
    // Matches the task spec's verified test case: node 400x200, horizontal
    // gradient across the full bbox -> start {0, H/2}, end {W, H/2}.
    expect(g.start).toEqual({ x: 0, y: 100 });
    expect(g.end).toEqual({ x: 400, y: 100 });
  });

  it("forStroke: converts radial gradient center/radii to px-space", () => {
    const g = buildPixiGradient(radialGradient, 400, 200, { forStroke: true });
    expect(g.textureSpace).toBe("global");
    expect(g.center).toEqual({ x: 200, y: 100 });
    expect(g.outerCenter).toEqual({ x: 200, y: 100 });
    expect(g.innerRadius).toBe(0);
    expect(g.outerRadius).toBe(200); // 0.5 * width(400)
  });

  it("forStroke: radial gradient on a non-square bbox gets a bbox-aspect scale, not a true circle", () => {
    // 400x200 node: outerRadius is x-basis (0.5 * 400 = 200px). Figma stretches
    // the gradient to the bbox aspect ratio (a 400x200 ellipse), so the
    // effective y-radius must come out to 0.5 * height (100px) via `scale`,
    // not stay a 200px circle. See buildPixiGradient's doc comment for the
    // from-source derivation of why `scale: height / width` achieves this.
    const g = buildPixiGradient(radialGradient, 400, 200, { forStroke: true });
    expect(g.scale).toBe(200 / 400);
    expect(g.outerRadius * g.scale).toBe(100); // effective y-radius = 0.5 * height
  });

  it("forStroke: radial gradient on a square bbox keeps scale 1 (true circle, unchanged)", () => {
    const g = buildPixiGradient(radialGradient, 300, 300, { forStroke: true });
    expect(g.scale).toBe(1);
  });

  it("non-forStroke (fill) radial gradient leaves scale at Pixi's default (bbox-aspect handled by generateTextureFillMatrix's local bounds scale, not FillGradient.scale)", () => {
    const g = buildPixiGradient(radialGradient, 400, 200);
    expect(g.scale).toBe(1);
  });
});

describe("applyStroke", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no-ops when the node has no stroke paint", () => {
    const gfx = new Graphics();
    const strokeSpy = vi.spyOn(gfx, "stroke");
    const drawShape = vi.fn();
    applyStroke(gfx, makeNode({}), 400, 200, drawShape);
    expect(strokeSpy).not.toHaveBeenCalled();
    expect(drawShape).not.toHaveBeenCalled();
  });

  it("no-ops when strokeWidth is unset even if a stroke color is present", () => {
    const gfx = new Graphics();
    const strokeSpy = vi.spyOn(gfx, "stroke");
    applyStroke(gfx, makeNode({ stroke: "#ff0000" }), 400, 200, vi.fn());
    expect(strokeSpy).not.toHaveBeenCalled();
  });

  it("strokes a single solid legacy color, reusing a fresh path when pathReady", () => {
    const gfx = new Graphics();
    const strokeSpy = vi.spyOn(gfx, "stroke");
    const drawShape = vi.fn();
    applyStroke(gfx, makeNode({ stroke: "#ff0000", strokeWidth: 4 }), 400, 200, drawShape, true);
    expect(drawShape).not.toHaveBeenCalled();
    expect(strokeSpy).toHaveBeenCalledTimes(1);
    expect(strokeSpy.mock.calls[0][0]).toMatchObject({ width: 4, alignment: 0.5 });
  });

  it("redraws the shape when the path isn't fresh", () => {
    const gfx = new Graphics();
    const drawShape = vi.fn();
    applyStroke(gfx, makeNode({ stroke: "#ff0000", strokeWidth: 4 }), 400, 200, drawShape, false);
    expect(drawShape).toHaveBeenCalledTimes(1);
  });

  it("renders a multi-paint stack (solid + gradient), redrawing the shape between layers", () => {
    const gfx = new Graphics();
    // happy-dom's stubbed 2D context (src/test/setup.ts) has no
    // createLinearGradient — stub `stroke()` itself so this test can assert
    // on the call args without building a real gradient texture (same
    // constraint as the rest of the pure-logic-only render test coverage;
    // WebGL/canvas-gradient rendering itself is e2e territory).
    const strokeSpy = vi.spyOn(gfx, "stroke").mockImplementation(() => gfx);
    const drawShape = vi.fn();
    const node = makeNode({
      strokeWidth: 4,
      strokes: [createSolidPaint("#000000"), createGradientPaint(linearGradient, { opacity: 0.6 })],
    });
    applyStroke(gfx, node, 400, 200, drawShape, true);

    expect(strokeSpy).toHaveBeenCalledTimes(2);
    // First layer reused the fresh path (no redraw); second layer redrew.
    expect(drawShape).toHaveBeenCalledTimes(1);
    expect(strokeSpy.mock.calls[0][0]).toMatchObject({ width: 4 });
    expect((strokeSpy.mock.calls[1][0] as { fill?: unknown; alpha?: number }).alpha).toBe(0.6);
    expect((strokeSpy.mock.calls[1][0] as { fill?: { textureSpace?: string } }).fill?.textureSpace).toBe(
      "global",
    );
  });

  it("skips hidden/zero-opacity paints without consuming a redraw", () => {
    const gfx = new Graphics();
    const strokeSpy = vi.spyOn(gfx, "stroke");
    const node = makeNode({
      strokeWidth: 4,
      strokes: [
        createSolidPaint("#111111", { visible: false }),
        createSolidPaint("#222222", { opacity: 0 }),
        createSolidPaint("#333333"),
      ],
    });
    applyStroke(gfx, node, 400, 200, vi.fn(), true);
    expect(strokeSpy).toHaveBeenCalledTimes(1);
  });

  it("per-side stroke uses only the topmost visible solid paint, ignoring gradient paints", () => {
    const gfx = new Graphics();
    const strokeSpy = vi.spyOn(gfx, "stroke");
    const node = makeNode({
      strokeWidthPerSide: { top: 2, right: 2, bottom: 2, left: 2 },
      strokes: [createSolidPaint("#111111"), createGradientPaint(linearGradient)],
    });
    applyStroke(gfx, node, 400, 200, vi.fn(), true);
    // drawPerSideStroke issues one stroke() call per non-zero side (4 here).
    expect(strokeSpy).toHaveBeenCalledTimes(4);
    for (const call of strokeSpy.mock.calls) {
      expect(call[0]).not.toHaveProperty("fill");
    }
  });
});
