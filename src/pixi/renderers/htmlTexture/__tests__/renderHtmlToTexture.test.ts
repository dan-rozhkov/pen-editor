import { describe, expect, it } from "vitest";
import { canUseForeignObjectFastPath } from "@/pixi/renderers/htmlTexture/renderHtmlToTexture";

describe("canUseForeignObjectFastPath", () => {
  it("uses the native fast path for self-contained markup", () => {
    expect(canUseForeignObjectFastPath("<div>Hello</div>")).toBe(true);
  });

  it("uses the DOM renderer when external images must be preloaded", () => {
    expect(
      canUseForeignObjectFastPath('<div><img src="https://images.example/photo.jpg"></div>'),
    ).toBe(false);
  });
});
