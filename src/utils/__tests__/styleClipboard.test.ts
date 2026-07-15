import { describe, expect, it } from "vitest";
import type { FlatSceneNode, RefNode } from "@/types/scene";
import { getEffects, getFills, getRenderableStrokes } from "@/utils/fillUtils";
import { extractNodeStyle, pickStyleUpdatesForNode } from "@/utils/styleClipboard";

const rectSource: FlatSceneNode = {
  id: "rect1",
  type: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  fill: "#ff0000",
  stroke: "#000000",
  strokeWidth: 2,
  strokeAlign: "inside",
  opacity: 0.8,
  fillOpacity: 0.9,
  cornerRadius: 8,
  cornerRadiusPerCorner: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
  cornerSmoothing: 0.6,
  effects: [{ type: "shadow", shadowType: "outer", color: "#00000080", offset: { x: 1, y: 1 }, blur: 4, spread: 0 }],
} as FlatSceneNode;

const rectTarget: FlatSceneNode = {
  id: "rect2",
  type: "rect",
  x: 10,
  y: 10,
  width: 200,
  height: 80,
  fill: "#ffffff",
} as FlatSceneNode;

const textSource: FlatSceneNode = {
  id: "text1",
  type: "text",
  x: 0,
  y: 0,
  width: 80,
  height: 20,
  text: "Hello",
  fill: "#111111",
  fontSize: 24,
  fontFamily: "Inter",
  fontWeight: "700",
  lineHeight: 1.5,
  letterSpacing: 0.2,
} as FlatSceneNode;

const textTarget: FlatSceneNode = {
  id: "text2",
  type: "text",
  x: 0,
  y: 0,
  width: 40,
  height: 20,
  text: "World",
} as FlatSceneNode;

describe("extractNodeStyle", () => {
  it("captures fills, strokes, effects, corner radius and opacity from a rect", () => {
    const style = extractNodeStyle(rectSource);
    expect(style.fill).toBe("#ff0000");
    expect(style.stroke).toBe("#000000");
    expect(style.strokeWidth).toBe(2);
    expect(style.strokeAlign).toBe("inside");
    expect(style.opacity).toBe(0.8);
    expect(style.fillOpacity).toBe(0.9);
    expect(style.cornerRadius).toBe(8);
    expect(style.cornerRadiusPerCorner).toEqual({ topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 });
    expect(style.cornerSmoothing).toBe(0.6);
    expect(style.effects).toHaveLength(1);
    // Text-only fields must not appear on a rect-derived style
    expect(style.fontSize).toBeUndefined();
  });

  it("captures text styles from a text node", () => {
    const style = extractNodeStyle(textSource);
    expect(style.fontSize).toBe(24);
    expect(style.fontFamily).toBe("Inter");
    expect(style.fontWeight).toBe("700");
    expect(style.lineHeight).toBe(1.5);
    expect(style.letterSpacing).toBe(0.2);
    expect(style.fill).toBe("#111111");
    // cornerRadius is meaningless on text, must not be captured
    expect(style.cornerRadius).toBeUndefined();
  });
});

describe("pickStyleUpdatesForNode", () => {
  it("applies every compatible property rect -> rect", () => {
    const style = extractNodeStyle(rectSource);
    const updates = pickStyleUpdatesForNode(rectTarget, style);
    expect(updates.fill).toBe("#ff0000");
    expect(updates.stroke).toBe("#000000");
    expect(updates.strokeWidth).toBe(2);
    expect(updates.opacity).toBe(0.8);
    expect((updates as Record<string, unknown>).cornerRadius).toBe(8);
    expect((updates as Record<string, unknown>).cornerRadiusPerCorner).toEqual({
      topLeft: 1,
      topRight: 2,
      bottomRight: 3,
      bottomLeft: 4,
    });
    expect((updates as Record<string, unknown>).cornerSmoothing).toBe(0.6);
    expect((updates as Record<string, unknown>).effects).toHaveLength(1);
  });

  it("only transfers shared properties rect -> text (no cornerRadius on text)", () => {
    const style = extractNodeStyle(rectSource);
    const updates = pickStyleUpdatesForNode(textTarget, style);
    expect(updates.fill).toBe("#ff0000");
    expect(updates.stroke).toBe("#000000");
    expect(updates.opacity).toBe(0.8);
    expect((updates as Record<string, unknown>).cornerRadius).toBeUndefined();
    expect((updates as Record<string, unknown>).cornerRadiusPerCorner).toBeUndefined();
    expect((updates as Record<string, unknown>).cornerSmoothing).toBeUndefined();
  });

  it("does not push text styles onto a rectangle", () => {
    const style = extractNodeStyle(textSource);
    const updates = pickStyleUpdatesForNode(rectTarget, style);
    expect(updates.fill).toBe("#111111");
    expect((updates as Record<string, unknown>).fontSize).toBeUndefined();
    expect((updates as Record<string, unknown>).fontFamily).toBeUndefined();
    expect((updates as Record<string, unknown>).lineHeight).toBeUndefined();
  });

  it("applies text styles text -> text", () => {
    const style = extractNodeStyle(textSource);
    const updates = pickStyleUpdatesForNode(textTarget, style);
    expect((updates as Record<string, unknown>).fontSize).toBe(24);
    expect((updates as Record<string, unknown>).fontFamily).toBe("Inter");
    expect((updates as Record<string, unknown>).lineHeight).toBe(1.5);
    expect((updates as Record<string, unknown>).letterSpacing).toBe(0.2);
  });

  it("omits undefined source properties instead of overwriting the target with undefined", () => {
    const style = extractNodeStyle(rectTarget); // rectTarget has no stroke/cornerRadius
    const updates = pickStyleUpdatesForNode(rectSource, style);
    expect("stroke" in updates).toBe(false);
    expect("cornerRadius" in updates).toBe(false);
  });

  // Legacy-vs-paint-stack invariant (see fillUtils.ts): when `fills` is set it
  // supersedes the legacy `fill`/`gradientFill`/`imageFill` fields, so a paste
  // that writes one representation must clear the counterpart on the target.
  describe("legacy fill vs `fills` normalization", () => {
    const legacyFillSource = {
      id: "s1",
      type: "rect",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fill: "#ff0000",
    } as FlatSceneNode;

    const paintStackTarget = {
      id: "t1",
      type: "rect",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [{ id: "p1", type: "solid", color: "#0000ff" }],
    } as FlatSceneNode;

    it("clears the target's stale `fills` when pasting a legacy-only fill", () => {
      const style = extractNodeStyle(legacyFillSource);
      const updates = pickStyleUpdatesForNode(paintStackTarget, style);
      const merged = { ...paintStackTarget, ...updates } as FlatSceneNode;
      const fills = getFills(merged);
      expect(fills).toHaveLength(1);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#ff0000" });
    });

    it("clears the target's stale legacy fill fields when pasting a paint stack", () => {
      const paintStackSource = {
        ...legacyFillSource,
        fill: undefined,
        fills: [{ id: "p2", type: "solid", color: "#00ff00" }],
      } as FlatSceneNode;
      const legacyTarget = {
        ...paintStackTarget,
        fills: undefined,
        fill: "#123456",
        gradientFill: { type: "linear", stops: [], startX: 0, startY: 0, endX: 1, endY: 1 },
      } as FlatSceneNode;

      const style = extractNodeStyle(paintStackSource);
      const updates = pickStyleUpdatesForNode(legacyTarget, style);
      const merged = { ...legacyTarget, ...updates } as FlatSceneNode;
      expect(merged.fill).toBeUndefined();
      expect(merged.gradientFill).toBeUndefined();
      const fills = getFills(merged);
      expect(fills).toHaveLength(1);
      expect(fills[0]).toMatchObject({ type: "solid", color: "#00ff00" });
    });

    it("clears the target's stale `effects` when pasting a legacy-only `effect`", () => {
      const legacyEffectSource = {
        ...legacyFillSource,
        effect: { type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 2 }, blur: 6, spread: 0 },
      } as FlatSceneNode;
      const effectsTarget = {
        ...paintStackTarget,
        effects: [{ type: "blur", radius: 12 }],
      } as FlatSceneNode;

      const style = extractNodeStyle(legacyEffectSource);
      const updates = pickStyleUpdatesForNode(effectsTarget, style);
      const merged = { ...effectsTarget, ...updates } as FlatSceneNode;
      const effects = getEffects(merged);
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({ type: "shadow", blur: 6 });
    });

    it("clears the target's stale legacy `effect` when pasting an effect stack", () => {
      const effectsSource = {
        ...legacyFillSource,
        effects: [{ type: "blur", radius: 8 }],
      } as FlatSceneNode;
      const legacyEffectTarget = {
        ...paintStackTarget,
        effect: { type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 2 }, blur: 6, spread: 0 },
      } as FlatSceneNode;

      const style = extractNodeStyle(effectsSource);
      const updates = pickStyleUpdatesForNode(legacyEffectTarget, style);
      const merged = { ...legacyEffectTarget, ...updates } as FlatSceneNode;
      expect(merged.effect).toBeUndefined();
      const effects = getEffects(merged);
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({ type: "blur", radius: 8 });
    });

    it("copies a gradient `strokes` stack instead of dropping it", () => {
      const gradientStrokeSource = {
        ...legacyFillSource,
        stroke: undefined,
        strokes: [
          {
            id: "s1",
            type: "gradient",
            gradient: { type: "linear", startX: 0, startY: 0, endX: 1, endY: 0, stops: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }] },
          },
        ],
      } as unknown as FlatSceneNode;

      const style = extractNodeStyle(gradientStrokeSource);
      const updates = pickStyleUpdatesForNode(paintStackTarget, style);
      const merged = { ...paintStackTarget, ...updates } as FlatSceneNode;
      const strokes = getRenderableStrokes(merged);
      expect(strokes).toHaveLength(1);
      expect(strokes[0]).toMatchObject({ type: "gradient" });
    });

    it("clears the target's stale legacy stroke fields when pasting a `strokes` stack", () => {
      const strokeStackSource = {
        ...legacyFillSource,
        stroke: undefined,
        strokes: [{ id: "p2", type: "solid", color: "#00ff00" }],
      } as unknown as FlatSceneNode;
      const legacyStrokeTarget = {
        ...paintStackTarget,
        stroke: "#123456",
        strokeOpacity: 0.5,
      } as FlatSceneNode;

      const style = extractNodeStyle(strokeStackSource);
      const updates = pickStyleUpdatesForNode(legacyStrokeTarget, style);
      const merged = { ...legacyStrokeTarget, ...updates } as FlatSceneNode;
      expect(merged.stroke).toBeUndefined();
      const strokes = getRenderableStrokes(merged);
      expect(strokes).toHaveLength(1);
      expect(strokes[0]).toMatchObject({ type: "solid", color: "#00ff00" });
    });

    it("clears the target's stale `strokes` stack when pasting a legacy-only stroke", () => {
      const legacyStrokeSource = {
        ...legacyFillSource,
        stroke: "#abcdef",
      } as FlatSceneNode;
      const strokeStackTarget = {
        ...paintStackTarget,
        strokes: [{ id: "p1", type: "solid", color: "#0000ff" }],
      } as unknown as FlatSceneNode;

      const style = extractNodeStyle(legacyStrokeSource);
      const updates = pickStyleUpdatesForNode(strokeStackTarget, style);
      const merged = { ...strokeStackTarget, ...updates } as FlatSceneNode;
      const strokes = getRenderableStrokes(merged);
      expect(strokes).toHaveLength(1);
      expect(strokes[0]).toMatchObject({ type: "solid", color: "#abcdef" });
    });

    it("leaves the target's fills and effects untouched when the source has neither", () => {
      const bareSource = {
        id: "s2",
        type: "rect",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        opacity: 0.5,
      } as FlatSceneNode;
      const style = extractNodeStyle(bareSource);
      const updates = pickStyleUpdatesForNode(paintStackTarget, style) as Record<string, unknown>;
      expect("fills" in updates).toBe(false);
      expect("fill" in updates).toBe(false);
      expect("strokes" in updates).toBe(false);
      expect("effects" in updates).toBe(false);
      expect("effect" in updates).toBe(false);
      expect(updates.opacity).toBe(0.5);
    });
  });

  // Regression: pasting style properties onto a component instance (`ref`
  // node) used to write COMMON_STYLE_KEYS verbatim — including `fills`,
  // `effects`, `opacity` — even though `resolveRefToTree`
  // (`@/utils/instanceRuntime`) only ever forwards `fill`/`stroke`/
  // `strokeWidth`/`fillBinding`/`strokeBinding` from the ref node to the
  // resolved render tree. Writing the rest mutated data (and created an undo
  // entry) but rendered nothing, i.e. a silent no-op paste.
  describe("pasting onto a component instance (ref)", () => {
    const refTarget: RefNode = {
      id: "ref1",
      type: "ref",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      componentId: "comp1",
      fill: "#ffffff",
    } as RefNode;

    it("only carries over the properties resolveRefToTree actually forwards", () => {
      const style = extractNodeStyle(rectSource);
      const updates = pickStyleUpdatesForNode(refTarget as unknown as FlatSceneNode, style) as Record<
        string,
        unknown
      >;

      expect(updates.fill).toBe("#ff0000");
      expect(updates.stroke).toBe("#000000");
      expect(updates.strokeWidth).toBe(2);

      // Not honored by resolveRefToTree — must never be written as dead data.
      expect("fills" in updates).toBe(false);
      expect("strokes" in updates).toBe(false);
      expect("effects" in updates).toBe(false);
      expect("effect" in updates).toBe(false);
      expect("opacity" in updates).toBe(false);
      expect("fillOpacity" in updates).toBe(false);
      expect("cornerRadius" in updates).toBe(false);
    });

    it("carries fillBinding/strokeBinding, which resolveRefToTree also forwards", () => {
      const boundSource = {
        ...rectSource,
        fillBinding: { variableId: "var1" },
        strokeBinding: { variableId: "var2" },
      } as FlatSceneNode;
      const style = extractNodeStyle(boundSource);
      const updates = pickStyleUpdatesForNode(refTarget as unknown as FlatSceneNode, style) as Record<
        string,
        unknown
      >;

      expect(updates.fillBinding).toEqual({ variableId: "var1" });
      expect(updates.strokeBinding).toEqual({ variableId: "var2" });
    });
  });

  // Regression: pen-drawn `path` nodes style their stroke via `pathStroke`,
  // not `stroke`/`strokeWidth` — copying style from one path to another used
  // to drop the visible stroke entirely.
  describe("path -> path carries pathStroke", () => {
    const pathSource = {
      id: "path1",
      type: "path",
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      geometry: "M0 0 L40 40",
      pathStroke: { align: "center", thickness: 3, join: "round", cap: "round", fill: "#ff00ff" },
    } as FlatSceneNode;

    const pathTarget = {
      id: "path2",
      type: "path",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      geometry: "M0 0 L20 20",
    } as FlatSceneNode;

    it("extractNodeStyle captures pathStroke from a path source", () => {
      const style = extractNodeStyle(pathSource);
      expect((style as Record<string, unknown>).pathStroke).toEqual({
        align: "center",
        thickness: 3,
        join: "round",
        cap: "round",
        fill: "#ff00ff",
      });
    });

    it("pickStyleUpdatesForNode applies pathStroke path -> path", () => {
      const style = extractNodeStyle(pathSource);
      const updates = pickStyleUpdatesForNode(pathTarget, style) as Record<string, unknown>;
      expect(updates.pathStroke).toEqual({
        align: "center",
        thickness: 3,
        join: "round",
        cap: "round",
        fill: "#ff00ff",
      });
    });

    it("does not leak pathStroke onto a non-path target", () => {
      const style = extractNodeStyle(pathSource);
      const updates = pickStyleUpdatesForNode(rectTarget, style) as Record<string, unknown>;
      expect("pathStroke" in updates).toBe(false);
    });
  });
});

// Regression: line caps, ellipse arc angles, and the star/donut
// innerRadiusRatio are style-like (visual proportion/decoration) by the
// codebase's own convention (cornerRadius/cornerSmoothing and
// strokeWidth/strokeAlign are included; only points-count geometry like
// `sides`/`points` is excluded) but were omitted from the copy/paste
// allowlists.
describe("line cap / ellipse arc / star ratio style transfer", () => {
  const lineSource = {
    id: "line1",
    type: "line",
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    points: [0, 0, 100, 0],
    stroke: "#000000",
    strokeWidth: 2,
    startCap: "circle",
    endCap: "triangle",
  } as unknown as FlatSceneNode;

  const lineTarget = {
    id: "line2",
    type: "line",
    x: 0,
    y: 0,
    width: 50,
    height: 0,
    points: [0, 0, 50, 0],
  } as unknown as FlatSceneNode;

  it("carries startCap/endCap line -> line", () => {
    const style = extractNodeStyle(lineSource);
    expect((style as Record<string, unknown>).startCap).toBe("circle");
    expect((style as Record<string, unknown>).endCap).toBe("triangle");
    const updates = pickStyleUpdatesForNode(lineTarget, style) as Record<string, unknown>;
    expect(updates.startCap).toBe("circle");
    expect(updates.endCap).toBe("triangle");
  });

  it("does not leak caps onto a non-line target", () => {
    const style = extractNodeStyle(lineSource);
    const updates = pickStyleUpdatesForNode(rectTarget, style) as Record<string, unknown>;
    expect("startCap" in updates).toBe(false);
    expect("endCap" in updates).toBe(false);
  });

  const ellipseSource = {
    id: "ellipse1",
    type: "ellipse",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    fill: "#ff0000",
    startAngle: 30,
    sweepAngle: 180,
    innerRadiusRatio: 0.4,
  } as unknown as FlatSceneNode;

  const ellipseTarget = {
    id: "ellipse2",
    type: "ellipse",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
  } as unknown as FlatSceneNode;

  it("carries startAngle/sweepAngle/innerRadiusRatio ellipse -> ellipse", () => {
    const style = extractNodeStyle(ellipseSource);
    const updates = pickStyleUpdatesForNode(ellipseTarget, style) as Record<string, unknown>;
    expect(updates.startAngle).toBe(30);
    expect(updates.sweepAngle).toBe(180);
    expect(updates.innerRadiusRatio).toBe(0.4);
  });

  it("does not leak startAngle/sweepAngle onto a non-ellipse target", () => {
    const style = extractNodeStyle(ellipseSource);
    const updates = pickStyleUpdatesForNode(rectTarget, style) as Record<string, unknown>;
    expect("startAngle" in updates).toBe(false);
    expect("sweepAngle" in updates).toBe(false);
  });

  const starSource = {
    id: "poly1",
    type: "polygon",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    points: [0, 0],
    sides: 5,
    innerRadiusRatio: 0.5,
  } as unknown as FlatSceneNode;

  const polygonTarget = {
    id: "poly2",
    type: "polygon",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    points: [0, 0],
    sides: 5,
  } as unknown as FlatSceneNode;

  it("carries innerRadiusRatio (star ratio) polygon -> polygon but not the points-count geometry", () => {
    const style = extractNodeStyle(starSource);
    const updates = pickStyleUpdatesForNode(polygonTarget, style) as Record<string, unknown>;
    expect(updates.innerRadiusRatio).toBe(0.5);
    expect("sides" in updates).toBe(false);
    expect("points" in updates).toBe(false);
  });
});

// Regression: `extractNodeStyle` used to copy `fills`/`effects` (and other
// array/object style fields) by reference, so the clipboard, the source node,
// and any paste target ended up sharing the same array/object instances —
// mutating one silently mutated the others.
describe("extractNodeStyle deep-copies array/object style fields", () => {
  it("mutating the source node's fills array after copy does not affect the clipboard snapshot", () => {
    const source = {
      id: "rectA",
      type: "rect",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [{ id: "p1", type: "solid", color: "#0000ff" }],
      effects: [{ type: "blur", radius: 4 }],
    } as unknown as FlatSceneNode;

    const style = extractNodeStyle(source);

    // Mutate the source's arrays/objects after the copy.
    (source as unknown as { fills: Array<{ color: string }> }).fills[0].color = "#ff0000";
    (source as unknown as { effects: Array<{ radius: number }> }).effects[0].radius = 999;
    (source as unknown as { fills: unknown[] }).fills.push({ id: "p2", type: "solid", color: "#00ff00" });

    expect(style.fills?.[0]).toMatchObject({ color: "#0000ff" });
    expect(style.fills).toHaveLength(1);
    expect((style.effects?.[0] as unknown as { radius: number }).radius).toBe(4);
  });
});
