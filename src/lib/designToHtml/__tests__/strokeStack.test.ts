import { describe, it, expect } from "vitest";
import { generateVisualStyles } from "../styleGeneration";
import type { RectNode, GradientFill, Paint } from "@/types/scene";

function rect(extra: Partial<RectNode>): RectNode {
  return {
    id: "r1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  };
}

const linearGradient: GradientFill = {
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

describe("designToHtml stroke stack", () => {
  it("legacy single stroke still emits a plain border (unchanged behavior)", () => {
    const styles = generateVisualStyles(rect({ stroke: "#00ff00", strokeWidth: 3 }));
    expect(styles.border).toBe("3px solid #00ff00");
    expect(styles["border-image-source"]).toBeUndefined();
  });

  it("a single solid paint in the strokes stack behaves like the legacy field", () => {
    const strokes: Paint[] = [{ id: "s1", type: "solid", color: "#00ff00", opacity: 0.5 }];
    const styles = generateVisualStyles(rect({ strokes, strokeWidth: 3 }));
    expect(styles.border).toBe("3px solid rgba(0,255,0,0.5)");
  });

  it("a gradient stroke emits border-image-source + border-image-slice: 1 (fixes Figma's unrenderable Copy-as-CSS output)", () => {
    const strokes: Paint[] = [{ id: "s1", type: "gradient", gradient: linearGradient }];
    const styles = generateVisualStyles(rect({ strokes, strokeWidth: 4 }));
    expect(styles.border).toBe("4px solid transparent");
    expect(styles["border-image-source"]).toContain("linear-gradient(");
    expect(styles["border-image-slice"]).toBe("1");
  });

  it("a multi-paint stroke stack is approximated with the topmost paint (CSS has one border slot, like SVG's one stroke=)", () => {
    const strokes: Paint[] = [
      { id: "s1", type: "solid", color: "#000000" },
      { id: "s2", type: "gradient", gradient: linearGradient },
    ];
    const styles = generateVisualStyles(rect({ strokes, strokeWidth: 2 }));
    expect(styles["border-image-source"]).toContain("linear-gradient(");
  });

  it("gradient stroke + strokeAlign inside sets box-sizing: border-box", () => {
    const strokes: Paint[] = [{ id: "s1", type: "gradient", gradient: linearGradient }];
    const styles = generateVisualStyles(rect({ strokes, strokeWidth: 2, strokeAlign: "inside" }));
    expect(styles["box-sizing"]).toBe("border-box");
  });

  it("no strokes/legacy stroke → no border styles at all", () => {
    const styles = generateVisualStyles(rect({}));
    expect(styles.border).toBeUndefined();
    expect(styles.outline).toBeUndefined();
    expect(styles["border-image-source"]).toBeUndefined();
  });
});
