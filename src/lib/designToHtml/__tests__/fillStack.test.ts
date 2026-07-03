import { describe, it, expect } from "vitest";
import { generateVisualStyles } from "../styleGeneration";
import { splitSelectorList } from "@/lib/htmlToDesign/cssScoping";
import type { RectNode, TextNode, GradientFill, Paint, Effect } from "@/types/scene";

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
  endX: 0,
  endY: 1,
};

describe("designToHtml fill stack", () => {
  it("single solid paint → background-color (legacy-equivalent)", () => {
    const styles = generateVisualStyles(
      rect({ fills: [{ id: "p1", type: "solid", color: "#ff0000" }] }),
    );
    expect(styles["background-color"]).toBe("#ff0000");
    expect(styles["background-image"]).toBeUndefined();
  });

  it("single solid with layer opacity bakes alpha into color", () => {
    const styles = generateVisualStyles(
      rect({ fills: [{ id: "p1", type: "solid", color: "#ff0000", opacity: 0.5 }] }),
    );
    expect(styles["background-color"]).toBe("rgba(255,0,0,0.5)");
  });

  it("empty stack → no background", () => {
    const styles = generateVisualStyles(rect({ fills: [] }));
    expect(styles["background-color"]).toBeUndefined();
    expect(styles["background-image"]).toBeUndefined();
  });

  it("stack [solid, gradient, image] → multiple backgrounds in reverse order", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" }, // bottom
      { id: "p2", type: "gradient", gradient: linearGradient },
      { id: "p3", type: "image", image: { url: "http://x/y.png", mode: "fill" } }, // top
    ];
    const styles = generateVisualStyles(rect({ fills }));

    // bottommost solid is hoisted to background-color
    expect(styles["background-color"]).toBe("#112233");

    // CSS list is top-to-bottom: image first, then gradient
    const images = splitSelectorList(styles["background-image"]);
    expect(images[0]).toContain('url("http://x/y.png")');
    expect(images[1]).toContain("linear-gradient(");
    // bottom solid was hoisted, so only 2 image layers remain
    expect(images).toHaveLength(2);

    const sizes = splitSelectorList(styles["background-size"]);
    expect(sizes[0]).toBe("cover"); // fill image
  });

  it("blendMode emitted per-layer in reverse order", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" },
      { id: "p2", type: "gradient", gradient: linearGradient, blendMode: "multiply" },
    ];
    const styles = generateVisualStyles(rect({ fills }));
    // The bottom solid is hoisted into background-color, so only the gradient
    // layer remains in the image list → a single blend-mode entry.
    expect(styles["background-blend-mode"]).toBe("multiply");
  });

  it("text node uses primary solid color via color", () => {
    const node: TextNode = {
      id: "t1",
      type: "text",
      text: "hi",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [{ id: "p1", type: "solid", color: "#00ff00" }],
    };
    const styles = generateVisualStyles(node);
    expect(styles.color).toBe("#00ff00");
    expect(styles["background-color"]).toBeUndefined();
  });

  it("two solids → top becomes flat gradient, bottom is background-color", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#000000" },
      { id: "p2", type: "solid", color: "#ffffff", opacity: 0.5 },
    ];
    const styles = generateVisualStyles(rect({ fills }));
    expect(styles["background-color"]).toBe("#000000");
    expect(styles["background-image"]).toBe(
      "linear-gradient(rgba(255,255,255,0.5), rgba(255,255,255,0.5))",
    );
  });
});

describe("designToHtml effect stack", () => {
  it("single shadow → box-shadow", () => {
    const styles = generateVisualStyles(
      rect({
        effect: {
          type: "shadow",
          shadowType: "outer",
          color: "#00000040",
          offset: { x: 0, y: 2 },
          blur: 4,
          spread: 0,
        },
      }),
    );
    expect(styles["box-shadow"]).toBe("0px 2px 4px 0px #00000040");
  });

  it("multiple shadows → comma list in reverse (top first), inset for inner", () => {
    const effects: Effect[] = [
      {
        type: "shadow",
        shadowType: "outer",
        color: "#00000040",
        offset: { x: 0, y: 2 },
        blur: 4,
        spread: 0,
      },
      {
        type: "shadow",
        shadowType: "inner",
        color: "#ffffff80",
        offset: { x: 1, y: 1 },
        blur: 2,
        spread: 1,
      },
    ];
    const styles = generateVisualStyles(rect({ effects }));
    // stack is bottom-to-top; CSS reverses → inner (top) first
    expect(styles["box-shadow"]).toBe(
      "inset 1px 1px 2px 1px #ffffff80, 0px 2px 4px 0px #00000040",
    );
  });

  it("converts a layer blur effect to css filter: blur()", () => {
    const effects: Effect[] = [{ type: "blur", radius: 6 }];
    const styles = generateVisualStyles(rect({ effects }));
    expect(styles.filter).toBe("blur(6px)");
    expect(styles["box-shadow"]).toBeUndefined();
  });

  it("emits both box-shadow and filter for a shadow + blur stack", () => {
    const effects: Effect[] = [
      {
        type: "shadow",
        shadowType: "outer",
        color: "#00000040",
        offset: { x: 0, y: 2 },
        blur: 4,
        spread: 0,
      },
      { type: "blur", radius: 10 },
    ];
    const styles = generateVisualStyles(rect({ effects }));
    expect(styles["box-shadow"]).toBe("0px 2px 4px 0px #00000040");
    expect(styles.filter).toBe("blur(10px)");
  });

  it("skips invisible and zero-radius blurs", () => {
    const effects: Effect[] = [
      { type: "blur", radius: 6, visible: false },
      { type: "blur", radius: 0 },
    ];
    const styles = generateVisualStyles(rect({ effects }));
    expect(styles.filter).toBeUndefined();
  });
});
