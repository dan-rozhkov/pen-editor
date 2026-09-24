import type { GradientPaint, RectNode, ShadowEffect } from "@/types/scene";

// Shared node fixtures for buildCss.test.ts (designToCss) and css.test.ts
// (codegen) — the codegen `css.ts` wraps `buildCssForNodes` directly, so
// both suites exercise the same underlying shapes.

export function gradientRect(): RectNode {
  const gradient: GradientPaint = {
    id: "p1",
    type: "gradient",
    gradient: {
      type: "linear",
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 1,
      stops: [
        { position: 0, color: "#ff0000" },
        { position: 1, color: "#0000ff" },
      ],
    },
  };
  const shadow: ShadowEffect = {
    type: "shadow",
    shadowType: "outer",
    color: "#00000040",
    offset: { x: 0, y: 4 },
    blur: 8,
    spread: 0,
    id: "e1",
  };
  return {
    id: "rect1",
    type: "rect",
    name: "Card",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cornerRadius: 12,
    fills: [gradient],
    effects: [shadow],
  } as unknown as RectNode;
}

/** A 100x40 "Button" rect with a solid fill bound to `var-primary`. */
export function boundFillButtonRect(): RectNode {
  return {
    id: "rect1",
    type: "rect",
    name: "Button",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    fills: [
      {
        id: "p1",
        type: "solid",
        color: "#3366ff",
        colorBinding: { variableId: "var-primary" },
      },
    ],
  } as unknown as RectNode;
}
