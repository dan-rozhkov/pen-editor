import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { getEffects, getFills } from "@/utils/fillUtils";
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
      expect("effects" in updates).toBe(false);
      expect("effect" in updates).toBe(false);
      expect(updates.opacity).toBe(0.5);
    });
  });
});
