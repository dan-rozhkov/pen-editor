import { describe, expect, it } from "vitest";
import type { GradientPaint, ImagePaint, Paint, SolidPaint } from "@/types/scene";
import {
  createDefaultVideoPlayback,
  createGradientPaint,
  createImagePaint,
  createPatternPaint,
  createShadowEffect,
  createSolidPaint,
  createVideoPaint,
} from "@/utils/fillUtils";
import {
  addEffect,
  addSolidFill,
  convertFillKind,
  getFillKind,
  moveItem,
  removeEffectAt,
  removeFillAt,
  toggleEffectVisibleAt,
  toggleFillVisibleAt,
  updateEffectAt,
  updateFillAt,
} from "@/components/properties/fillSectionUtils";
import { getDefaultGradient } from "@/utils/gradientUtils";

const solid = (color: string) => createSolidPaint(color);

describe("getFillKind", () => {
  it("maps each paint type to a fill kind", () => {
    expect(getFillKind(createSolidPaint("#fff"))).toBe("solid");
    expect(getFillKind(createImagePaint({ url: "x", mode: "fill" }))).toBe("image");
    expect(getFillKind(createGradientPaint(getDefaultGradient("linear")))).toBe("linear");
    expect(getFillKind(createGradientPaint(getDefaultGradient("radial")))).toBe("radial");
    expect(getFillKind(createPatternPaint({ url: "x" }))).toBe("pattern");
    expect(
      getFillKind(
        createVideoPaint({ src: "x", mode: "fill", playback: createDefaultVideoPlayback() }),
      ),
    ).toBe("video");
  });
});

describe("convertFillKind → video", () => {
  it("converts a solid paint to a video paint with muted-autoplay defaults", () => {
    const fills: Paint[] = [solid("#123456")];
    const next = convertFillKind(fills, 0, "video");
    expect(next[0]).toMatchObject({
      type: "video",
      video: { src: "", mode: "fill", playback: { autoplay: true, loop: true, muted: true } },
    });
  });

  it("converts image → video carrying over the url as the video src", () => {
    const fills: Paint[] = [createImagePaint({ url: "https://x/a.png", mode: "fit" })];
    const next = convertFillKind(fills, 0, "video");
    expect(next[0]).toMatchObject({ type: "video", video: { src: "https://x/a.png" } });
  });

  it("converts video → image carrying over the src as the image url", () => {
    const fills: Paint[] = [
      createVideoPaint({ src: "https://x/clip.mp4", mode: "fill", playback: createDefaultVideoPlayback() }),
    ];
    const next = convertFillKind(fills, 0, "image") as ImagePaint[];
    expect(next[0]).toMatchObject({ type: "image", image: { url: "https://x/clip.mp4" } });
  });
});

describe("addSolidFill", () => {
  it("appends a new solid paint to the top (end) of the stack", () => {
    const fills = [solid("#111")];
    const next = addSolidFill(fills, "#222");
    expect(next).toHaveLength(2);
    expect(next[1].type).toBe("solid");
    expect((next[1] as SolidPaint).color).toBe("#222");
    // original untouched (immutability)
    expect(fills).toHaveLength(1);
  });

  it("defaults to #cccccc", () => {
    expect((addSolidFill([])[0] as SolidPaint).color).toBe("#cccccc");
  });
});

describe("removeFillAt", () => {
  it("removes the paint at the given index", () => {
    const a = solid("#a");
    const b = solid("#b");
    expect(removeFillAt([a, b], 0)).toEqual([b]);
    expect(removeFillAt([a, b], 1)).toEqual([a]);
  });
});

describe("updateFillAt", () => {
  it("replaces only the targeted paint", () => {
    const a = solid("#a");
    const b = solid("#b");
    const replaced: Paint = { ...b, color: "#z" };
    const next = updateFillAt([a, b], 1, replaced);
    expect(next[0]).toBe(a);
    expect((next[1] as SolidPaint).color).toBe("#z");
  });
});

describe("toggleFillVisibleAt", () => {
  it("toggles visibility (undefined -> false -> true)", () => {
    const fills = [solid("#a")];
    const hidden = toggleFillVisibleAt(fills, 0);
    expect(hidden[0].visible).toBe(false);
    const shown = toggleFillVisibleAt(hidden, 0);
    expect(shown[0].visible).toBe(true);
  });
});

describe("moveItem", () => {
  it("moves an item toward the top of the stack", () => {
    const a = solid("#a");
    const b = solid("#b");
    const c = solid("#c");
    expect(moveItem([a, b, c], 0, 1)).toEqual([b, a, c]);
    expect(moveItem([a, b, c], 2, -2)).toEqual([c, a, b]);
  });

  it("is a no-op when moving out of range", () => {
    const fills = [solid("#a"), solid("#b")];
    expect(moveItem(fills, 0, -1)).toEqual(fills);
    expect(moveItem(fills, 1, 1)).toEqual(fills);
  });
});

describe("convertFillKind", () => {
  it("returns the same array when kind is unchanged", () => {
    const fills = [solid("#a")];
    expect(convertFillKind(fills, 0, "solid")).toBe(fills);
  });

  it("preserves id, visibility, opacity and blendMode across conversion", () => {
    const fills: Paint[] = [
      createSolidPaint("#abcdef", { visible: false, opacity: 0.5, blendMode: "multiply" }),
    ];
    const next = convertFillKind(fills, 0, "linear");
    const paint = next[0];
    expect(paint.type).toBe("gradient");
    expect(paint.id).toBe(fills[0].id);
    expect(paint.visible).toBe(false);
    expect(paint.opacity).toBe(0.5);
    expect(paint.blendMode).toBe("multiply");
  });

  it("solid -> gradient keeps the current color as the first stop", () => {
    const fills = [solid("#123456")];
    const next = convertFillKind(fills, 0, "radial") as GradientPaint[];
    expect(next[0].gradient.type).toBe("radial");
    expect(next[0].gradient.stops[0].color).toBe("#123456");
  });

  it("linear -> radial keeps the existing stops", () => {
    const grad = createGradientPaint({
      ...getDefaultGradient("linear"),
      stops: [
        { color: "#aaa", position: 0 },
        { color: "#bbb", position: 0.5 },
        { color: "#ccc", position: 1 },
      ],
    });
    const next = convertFillKind([grad], 0, "radial") as GradientPaint[];
    expect(next[0].gradient.type).toBe("radial");
    expect(next[0].gradient.stops).toHaveLength(3);
    expect(next[0].gradient.stops[1].color).toBe("#bbb");
  });

  it("converts to an image paint with a sensible default", () => {
    const fills = [solid("#a")];
    const next = convertFillKind(fills, 0, "image") as ImagePaint[];
    expect(next[0].type).toBe("image");
    expect(next[0].image.mode).toBe("fill");
  });

  it("converts to a pattern paint with an empty tile by default", () => {
    const fills = [solid("#a")];
    const next = convertFillKind(fills, 0, "pattern");
    expect(next[0]).toMatchObject({ type: "pattern", pattern: { url: "" } });
  });

  it("image <-> pattern conversions keep the tile/image url", () => {
    const fills: Paint[] = [createImagePaint({ url: "https://x/tile.png", mode: "fill" })];
    const asPattern = convertFillKind(fills, 0, "pattern");
    expect(asPattern[0]).toMatchObject({
      type: "pattern",
      pattern: { url: "https://x/tile.png" },
    });
    const backToImage = convertFillKind(asPattern, 0, "image");
    expect(backToImage[0]).toMatchObject({
      type: "image",
      image: { url: "https://x/tile.png", mode: "fill" },
    });
  });
});

describe("effect stack helpers", () => {
  it("appends, updates, toggles and removes effects immutably", () => {
    const e1 = createShadowEffect();
    const stack = addEffect([], e1);
    expect(stack).toHaveLength(1);

    const e2 = createShadowEffect({ blur: 12 });
    const two = addEffect(stack, e2);
    expect(two).toHaveLength(2);

    const updated = updateEffectAt(two, 0, { ...e1, blur: 99 });
    expect((updated[0] as typeof e1).blur).toBe(99);
    expect(updated[1]).toBe(e2);

    const hidden = toggleEffectVisibleAt(two, 1);
    expect(hidden[1].visible).toBe(false);

    const removed = removeEffectAt(two, 0);
    expect(removed).toEqual([e2]);
  });
});
