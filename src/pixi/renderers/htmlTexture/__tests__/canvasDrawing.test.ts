import { describe, expect, it, vi } from "vitest";
import { walkAndDraw } from "@/pixi/renderers/htmlTexture/canvasDrawing";
import type { PreloadedRenderAssets } from "@/pixi/renderers/htmlTexture/svgAssets";

describe("walkAndDraw image clipping", () => {
  it("clips object-fit cover images to square element bounds", () => {
    const element = document.createElement("img");
    element.src = "https://images.example/product.jpg";
    element.style.objectFit = "cover";
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
      width: 100,
      height: 50,
      toJSON: () => ({}),
    });

    const image = document.createElement("img");
    Object.defineProperties(image, {
      naturalWidth: { value: 100 },
      naturalHeight: { value: 100 },
    });
    const assets: PreloadedRenderAssets = {
      imageMap: new Map([[element.src, image]]),
      svgMap: new WeakMap(),
    };
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    walkAndDraw(
      ctx,
      element,
      {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 200,
        width: 200,
        height: 200,
        toJSON: () => ({}),
      },
      assets,
    );

    expect(ctx.rect).toHaveBeenCalledWith(10, 20, 100, 50);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledOnce();
  });
});
