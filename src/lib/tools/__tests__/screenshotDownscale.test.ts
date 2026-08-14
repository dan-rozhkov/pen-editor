import { describe, it, expect, afterEach, vi } from "vitest";
import {
  computeDownscaledSize,
  downscaleImageDataUrl,
} from "@/lib/tools/screenshotDownscale";

describe("computeDownscaledSize", () => {
  it("leaves an image whose longest side is within the cap unchanged", () => {
    expect(computeDownscaledSize(800, 600, 1400)).toEqual({ width: 800, height: 600 });
    expect(computeDownscaledSize(1400, 700, 1400)).toEqual({ width: 1400, height: 700 });
  });

  it("scales down a landscape image so the width hits the cap, preserving aspect ratio", () => {
    expect(computeDownscaledSize(2800, 1400, 1400)).toEqual({ width: 1400, height: 700 });
  });

  it("scales down a portrait image so the height hits the cap, preserving aspect ratio", () => {
    expect(computeDownscaledSize(1000, 4000, 1400)).toEqual({ width: 350, height: 1400 });
  });

  it("never upscales a smaller image", () => {
    expect(computeDownscaledSize(100, 50, 1400)).toEqual({ width: 100, height: 50 });
  });

  it("never returns a zero dimension for a tiny non-zero scaled side", () => {
    // A 1x9999 image scaled to cap 1400 would compute a width < 1 without
    // the Math.max(1, ...) floor.
    const result = computeDownscaledSize(1, 9999, 1400);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBe(1400);
  });

  it("handles degenerate (zero) input without throwing", () => {
    expect(computeDownscaledSize(0, 0, 1400)).toEqual({ width: 0, height: 0 });
  });
});

describe("downscaleImageDataUrl", () => {
  const originalImage = globalThis.Image;

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  function stubImage(naturalWidth: number, naturalHeight: number) {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = naturalWidth;
      naturalHeight = naturalHeight;
      width = naturalWidth;
      height = naturalHeight;
      set src(_value: string) {
        // Simulate the async decode succeeding on the next microtask.
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error test stub, not a full HTMLImageElement
    globalThis.Image = FakeImage;
  }

  it("downscales and re-encodes when the image exceeds the cap", async () => {
    stubImage(2800, 1400);
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/png;base64,DOWNSCALED");
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL,
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1400);

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1400, 700);
    expect(toDataURL).toHaveBeenCalledWith("image/png");
    expect(result).toBe("data:image/png;base64,DOWNSCALED");
  });

  it("sets high-quality smoothing on the 2D context before drawing", async () => {
    stubImage(2800, 1400);
    const drawImage = vi.fn();
    const ctx: { drawImage: typeof drawImage; imageSmoothingEnabled?: boolean; imageSmoothingQuality?: string } = {
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    };
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ctx,
          toDataURL: () => "data:image/png;base64,DOWNSCALED",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1400);

    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");
    // Smoothing must be set before drawImage runs, or it has no effect.
    expect(drawImage).toHaveBeenCalled();
  });

  it("doesn't throw against a stubbed 2D context lacking smoothing properties", async () => {
    stubImage(2800, 1400);
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:image/png;base64,DOWNSCALED",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1400);
    expect(result).toBe("data:image/png;base64,DOWNSCALED");
  });

  it("returns the original data URL unchanged when already within the cap", async () => {
    stubImage(800, 600);
    const createElementSpy = vi.spyOn(document, "createElement");

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1400);

    expect(result).toBe("data:image/png;base64,ORIGINAL");
    expect(createElementSpy).not.toHaveBeenCalledWith("canvas");
  });

  it("falls back to the original data URL when the image fails to load", async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    // @ts-expect-error test stub
    globalThis.Image = FailingImage;

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1400);
    expect(result).toBe("data:image/png;base64,ORIGINAL");
  });

  it("falls back to the original data URL when the loaded image has no readable dimensions", async () => {
    stubImage(0, 0);
    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1400);
    expect(result).toBe("data:image/png;base64,ORIGINAL");
  });
});
