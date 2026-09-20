import { describe, it, expect, afterEach, vi } from "vitest";
import {
  computeDownscaledSize,
  downscaleImageDataUrl,
} from "@/lib/tools/screenshotDownscale";

describe("computeDownscaledSize", () => {
  it("leaves an image whose longest side is within the cap unchanged", () => {
    expect(computeDownscaledSize(800, 600, 1024)).toEqual({ width: 800, height: 600 });
    expect(computeDownscaledSize(1024, 512, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("scales down a landscape image so the width hits the cap, preserving aspect ratio", () => {
    expect(computeDownscaledSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("scales down a portrait image so the height hits the cap, preserving aspect ratio", () => {
    expect(computeDownscaledSize(1000, 4000, 1024)).toEqual({ width: 256, height: 1024 });
  });

  it("never upscales a smaller image", () => {
    expect(computeDownscaledSize(100, 50, 1024)).toEqual({ width: 100, height: 50 });
  });

  it("never returns a zero dimension for a tiny non-zero scaled side", () => {
    // A 1x9999 image scaled to cap 1024 would compute a width < 1 without
    // the Math.max(1, ...) floor.
    const result = computeDownscaledSize(1, 9999, 1024);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBe(1024);
  });

  it("handles degenerate (zero) input without throwing", () => {
    expect(computeDownscaledSize(0, 0, 1024)).toEqual({ width: 0, height: 0 });
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

  it("downscales and re-encodes to WebP when the image exceeds the cap", async () => {
    stubImage(2048, 1024);
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/webp;base64,DOWNSCALED");
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

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
    expect(toDataURL).toHaveBeenCalledWith("image/webp", expect.any(Number));
    expect(result).toBe("data:image/webp;base64,DOWNSCALED");
  });

  it("re-encodes to WebP even when the image already fits within the cap", async () => {
    // Regression: an early return here would ship an already-small
    // screenshot as untouched PNG, defeating the point of this module for
    // the common case (most screenshots don't need resizing at all).
    stubImage(800, 600);
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/webp;base64,REENCODED");
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

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
    expect(result).toBe("data:image/webp;base64,REENCODED");
  });

  it("sets high-quality smoothing on the 2D context before drawing", async () => {
    stubImage(2048, 1024);
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
          toDataURL: () => "data:image/webp;base64,DOWNSCALED",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);

    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");
    // Smoothing must be set before drawImage runs, or it has no effect.
    expect(drawImage).toHaveBeenCalled();
  });

  it("doesn't throw against a stubbed 2D context lacking smoothing properties", async () => {
    stubImage(2048, 1024);
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:image/webp;base64,DOWNSCALED",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);
    expect(result).toBe("data:image/webp;base64,DOWNSCALED");
  });

  it("falls back to a PNG re-encode when the browser can't produce WebP", async () => {
    // Per spec, toDataURL("image/webp") on a browser without a WebP encoder
    // does NOT throw or reject — it silently returns a PNG data URL instead.
    // The module must detect this from the string prefix, not assume success
    // just because the call didn't throw.
    stubImage(2048, 1024);
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:image/png;base64,SILENT_PNG_FALLBACK",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);
    expect(result).toBe("data:image/png;base64,SILENT_PNG_FALLBACK");
  });

  it("keeps the original when the WebP fallback would re-encode an in-cap image as PNG", async () => {
    // Both failures at once: the browser has no WebP encoder AND the image
    // already fit the cap, so the "fallback" is a same-resolution PNG. PNG is
    // lossless, so an in-cap JPEG would come back several times LARGER than
    // what we were handed — the opposite of this module's job. Before in-cap
    // images were re-encoded at all, this case passed through untouched, and
    // it must keep doing so.
    stubImage(800, 600);
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:image/png;base64,SAME_SIZE_PNG_BLOWUP",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const result = await downscaleImageDataUrl("data:image/jpeg;base64,ORIGINAL", 1024);
    expect(result).toBe("data:image/jpeg;base64,ORIGINAL");
  });

  it("falls back to the original data URL when toDataURL returns something unusable", async () => {
    stubImage(2048, 1024);
    const drawImage = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => "data:,",
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);
    expect(result).toBe("data:image/png;base64,ORIGINAL");
  });

  it("still runs the encode path (no early return) when already within the cap", async () => {
    stubImage(800, 600);
    const createElementSpy = vi.spyOn(document, "createElement");

    await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);

    expect(createElementSpy).toHaveBeenCalledWith("canvas");
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

    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);
    expect(result).toBe("data:image/png;base64,ORIGINAL");
  });

  it("falls back to the original data URL when the loaded image has no readable dimensions", async () => {
    stubImage(0, 0);
    const result = await downscaleImageDataUrl("data:image/png;base64,ORIGINAL", 1024);
    expect(result).toBe("data:image/png;base64,ORIGINAL");
  });
});
