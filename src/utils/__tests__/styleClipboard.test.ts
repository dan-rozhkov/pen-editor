import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
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
});
