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

  it("pattern paint → repeating background layer with offset position (degrade: no spacing/stagger in CSS)", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" }, // bottom
      {
        id: "p2",
        type: "pattern",
        pattern: { url: "http://x/tile.png", scale: 0.5, spacingX: 4, offsetX: 8, offsetY: -2, rowOffset: 0.5 },
      },
    ];
    const styles = generateVisualStyles(rect({ fills }));

    expect(styles["background-color"]).toBe("#112233");
    expect(styles["background-image"]).toBe('url("http://x/tile.png")');
    expect(styles["background-repeat"]).toBe("repeat");
    expect(styles["background-size"]).toBe("auto");
    expect(styles["background-position"]).toBe("8px -2px");
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

describe("designToHtml image crop", () => {
  it("uncropped image fill uses the plain mode-based size/position", () => {
    const styles = generateVisualStyles(
      rect({ fills: [{ id: "p1", type: "image", image: { url: "http://x/y.png", mode: "fill" } }] }),
    );
    expect(styles["background-size"]).toBe("cover");
    expect(styles["background-position"]).toBe("center");
  });

  it("a cropped `stretch` image fill maps to oversized background-size + percentage position (no aspect preservation, matches Pixi stretch)", () => {
    const styles = generateVisualStyles(
      rect({
        fills: [
          {
            id: "p1",
            type: "image",
            image: { url: "http://x/y.png", mode: "stretch", crop: { x: 0.25, y: 0, width: 0.5, height: 1 } },
          },
        ],
      }),
    );
    expect(styles["background-size"]).toBe("200% 100%");
    expect(styles["background-position"]).toBe("50% 0%");
  });

  it("a cropped `fill` image fill computes the cover-within-crop sub-rect first, so it never stretches non-uniformly on a square box", () => {
    // A wide crop (0.5 x 1) inside a square (100x100) box: `fill` must further
    // crop the tall axis to a square sub-rect (like Pixi's coverPixelRect)
    // instead of just stretching the wide crop non-uniformly onto the box.
    const styles = generateVisualStyles(
      rect({
        width: 100,
        height: 100,
        fills: [
          {
            id: "p1",
            type: "image",
            image: { url: "http://x/y.png", mode: "fill", crop: { x: 0.25, y: 0, width: 0.5, height: 1 } },
          },
        ],
      }),
    );
    const [sizeX, sizeY] = (styles["background-size"] as string).split(" ");
    // Uniform scale on both axes = no distortion (unlike the old "200% 100%").
    expect(sizeX).toBe(sizeY);
    expect(styles["background-size"]).toBe("200% 200%");
    expect(styles["background-position"]).toBe("50% 50%");
  });

  it("a cropped `fit` image fill pads the crop to the box aspect instead of stretching it", () => {
    const styles = generateVisualStyles(
      rect({
        width: 100,
        height: 100,
        fills: [
          {
            id: "p1",
            type: "image",
            image: { url: "http://x/y.png", mode: "fit", crop: { x: 0.25, y: 0, width: 0.5, height: 1 } },
          },
        ],
      }),
    );
    const [sizeX, sizeY] = (styles["background-size"] as string).split(" ");
    expect(sizeX).toBe(sizeY);
  });

  it("an identity crop rect ({0,0,1,1}) behaves the same as no crop", () => {
    const withCrop = generateVisualStyles(
      rect({
        fills: [
          {
            id: "p1",
            type: "image",
            image: { url: "http://x/y.png", mode: "fit", crop: { x: 0, y: 0, width: 1, height: 1 } },
          },
        ],
      }),
    );
    const withoutCrop = generateVisualStyles(
      rect({ fills: [{ id: "p1", type: "image", image: { url: "http://x/y.png", mode: "fit" } }] }),
    );
    expect(withCrop["background-size"]).toBe(withoutCrop["background-size"]);
    expect(withCrop["background-position"]).toBe(withoutCrop["background-position"]);
  });
});
