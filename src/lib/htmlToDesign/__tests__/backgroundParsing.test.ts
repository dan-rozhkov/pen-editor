import { describe, it, expect } from "vitest";
import { parseBackgroundToPaints } from "../backgroundParsing";
import { splitSelectorList } from "../cssScoping";

describe("splitSelectorList (shared top-level splitter)", () => {
  it("respects nested parens in gradients and rgba", () => {
    const input =
      'url("a.png"), linear-gradient(90deg, rgba(0,0,0,0.5), #fff), radial-gradient(red, blue)';
    expect(splitSelectorList(input)).toEqual([
      'url("a.png")',
      "linear-gradient(90deg, rgba(0,0,0,0.5), #fff)",
      "radial-gradient(red, blue)",
    ]);
  });
});

describe("parseBackgroundToPaints", () => {
  it("returns null for a single solid color (legacy path)", () => {
    expect(
      parseBackgroundToPaints({
        backgroundColor: "rgb(255, 0, 0)",
        backgroundImage: "none",
        backgroundSize: "",
        backgroundBlendMode: "",
      }),
    ).toBeNull();
  });

  it("returns null for a single gradient (legacy path)", () => {
    expect(
      parseBackgroundToPaints({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "linear-gradient(90deg, #ff0000, #0000ff)",
        backgroundSize: "",
        backgroundBlendMode: "",
      }),
    ).toBeNull();
  });

  it("returns null for a single image (legacy path)", () => {
    expect(
      parseBackgroundToPaints({
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: 'url("http://x/y.png")',
        backgroundSize: "cover",
        backgroundBlendMode: "",
      }),
    ).toBeNull();
  });

  it("builds a bottom-to-top stack from color + image layers", () => {
    const paints = parseBackgroundToPaints({
      // CSS list: image (top), gradient (under it)
      backgroundColor: "rgb(17, 34, 51)",
      backgroundImage:
        'url("http://x/y.png"), linear-gradient(0deg, #ff0000, #0000ff)',
      backgroundSize: "cover, auto",
      backgroundBlendMode: "",
    });
    expect(paints).not.toBeNull();
    // bottom-to-top: color (bottom), gradient, image (top)
    expect(paints!.map((p) => p.type)).toEqual(["solid", "gradient", "image"]);
    expect(paints![0]).toMatchObject({ type: "solid", color: "#112233" });
    expect(paints![2]).toMatchObject({
      type: "image",
      image: { url: "http://x/y.png", mode: "fill" },
    });
  });

  it("maps per-layer background-size to image mode", () => {
    const paints = parseBackgroundToPaints({
      backgroundColor: "rgb(0, 0, 0)",
      backgroundImage: 'url("a.png"), url("b.png")',
      backgroundSize: "contain, 100% 100%",
      backgroundBlendMode: "",
    });
    expect(paints).not.toBeNull();
    // CSS order a(top), b; reversed → [color, b, a]
    const images = paints!.filter((p) => p.type === "image");
    expect(images).toHaveLength(2);
    // b.png had size 100% 100% → stretch; a.png contain → fit
    const byUrl = Object.fromEntries(
      images.map((p) => [
        (p as { image: { url: string; mode: string } }).image.url,
        (p as { image: { mode: string } }).image.mode,
      ]),
    );
    expect(byUrl["a.png"]).toBe("fit");
    expect(byUrl["b.png"]).toBe("stretch");
  });

  it("captures per-layer blend modes", () => {
    const paints = parseBackgroundToPaints({
      backgroundColor: "rgb(0, 0, 0)",
      backgroundImage: 'url("a.png"), url("b.png")',
      backgroundSize: "cover, cover",
      backgroundBlendMode: "multiply, screen",
    });
    expect(paints).not.toBeNull();
    // CSS: a(multiply, top), b(screen); reversed → [color, b(screen), a(multiply)]
    expect(paints!.map((p) => p.blendMode)).toEqual([
      undefined,
      "screen",
      "multiply",
    ]);
  });

  it("recognizes flat color gradients as solid layers", () => {
    const paints = parseBackgroundToPaints({
      backgroundColor: "rgb(0, 0, 0)",
      backgroundImage:
        'url("a.png"), linear-gradient(#abcdef, #abcdef)',
      backgroundSize: "cover, auto",
      backgroundBlendMode: "",
    });
    expect(paints).not.toBeNull();
    // CSS: a(top), flat-color; reversed → [color, solid(#abcdef), image]
    expect(paints!.map((p) => p.type)).toEqual(["solid", "solid", "image"]);
    expect(paints![1]).toMatchObject({ type: "solid", color: "#abcdef" });
  });
});
