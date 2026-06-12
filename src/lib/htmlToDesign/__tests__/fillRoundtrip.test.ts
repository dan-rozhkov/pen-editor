import { describe, it, expect } from "vitest";
import { generateVisualStyles } from "@/lib/designToHtml/styleGeneration";
import { parseBackgroundToPaints } from "../backgroundParsing";
import type { RectNode, Paint, GradientFill } from "@/types/scene";

function rect(extra: Partial<RectNode>): RectNode {
  return { id: "r1", type: "rect", x: 0, y: 0, width: 100, height: 100, ...extra };
}

const gradient: GradientFill = {
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

describe("fill stack roundtrip: design → CSS → design", () => {
  it("[solid, gradient, image] survives the roundtrip (up to ids)", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" },
      { id: "p2", type: "gradient", gradient },
      { id: "p3", type: "image", image: { url: "http://x/y.png", mode: "fill" } },
    ];
    const css = generateVisualStyles(rect({ fills }));

    const back = parseBackgroundToPaints({
      backgroundColor: css["background-color"] ?? "",
      backgroundImage: css["background-image"] ?? "none",
      backgroundSize: css["background-size"] ?? "",
      backgroundBlendMode: css["background-blend-mode"] ?? "",
    });

    expect(back).not.toBeNull();
    expect(back!.map((p) => p.type)).toEqual(["solid", "gradient", "image"]);
    expect(back![0]).toMatchObject({ type: "solid", color: "#112233" });
    expect(back![2]).toMatchObject({
      type: "image",
      image: { url: "http://x/y.png", mode: "fill" },
    });
    const grad = back![1] as Extract<Paint, { type: "gradient" }>;
    expect(grad.gradient.type).toBe("linear");
    expect(grad.gradient.stops.map((s) => s.color)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("image-fit mode survives via background-size: contain", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#000000" },
      { id: "p2", type: "image", image: { url: "http://x/y.png", mode: "fit" } },
    ];
    const css = generateVisualStyles(rect({ fills }));
    const back = parseBackgroundToPaints({
      backgroundColor: css["background-color"] ?? "",
      backgroundImage: css["background-image"] ?? "none",
      backgroundSize: css["background-size"] ?? "",
      backgroundBlendMode: css["background-blend-mode"] ?? "",
    });
    expect(back).not.toBeNull();
    const img = back!.find((p) => p.type === "image") as Extract<Paint, { type: "image" }>;
    expect(img.image.mode).toBe("fit");
  });

  it("image-stretch mode survives via background-size: 100% 100%", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#000000" },
      { id: "p2", type: "image", image: { url: "http://x/y.png", mode: "stretch" } },
    ];
    const css = generateVisualStyles(rect({ fills }));
    expect(css["background-size"]).toBe("100% 100%");

    const back = parseBackgroundToPaints({
      backgroundColor: css["background-color"] ?? "",
      backgroundImage: css["background-image"] ?? "none",
      backgroundSize: css["background-size"] ?? "",
      backgroundBlendMode: css["background-blend-mode"] ?? "",
    });
    expect(back).not.toBeNull();
    const img = back!.find((p) => p.type === "image") as Extract<Paint, { type: "image" }>;
    expect(img.image.mode).toBe("stretch");
  });

  it("blend modes survive the roundtrip", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#000000" },
      { id: "p2", type: "gradient", gradient, blendMode: "multiply" },
      { id: "p3", type: "image", image: { url: "http://x/y.png", mode: "fill" }, blendMode: "screen" },
    ];
    const css = generateVisualStyles(rect({ fills }));
    const back = parseBackgroundToPaints({
      backgroundColor: css["background-color"] ?? "",
      backgroundImage: css["background-image"] ?? "none",
      backgroundSize: css["background-size"] ?? "",
      backgroundBlendMode: css["background-blend-mode"] ?? "",
    });
    expect(back).not.toBeNull();
    expect(back!.map((p) => p.blendMode)).toEqual([undefined, "multiply", "screen"]);
  });
});
