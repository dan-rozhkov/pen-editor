import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import * as renderHtmlToTexture from "@/pixi/renderers/htmlTexture/renderHtmlToTexture";

describe("captureEmbedScreenshot (FIR-56)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null without attempting to render when htmlContent/width/height are missing", async () => {
    const spy = vi.spyOn(renderHtmlToTexture, "renderHtmlToCanvas");
    expect(await captureEmbedScreenshot({ htmlContent: "", width: 100, height: 100 })).toBeNull();
    expect(await captureEmbedScreenshot({ htmlContent: "<p>hi</p>", width: 0, height: 100 })).toBeNull();
    expect(await captureEmbedScreenshot({ htmlContent: "<p>hi</p>", width: 100, height: 0 })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders the embed's HTML through renderHtmlToCanvas and returns a data URL", async () => {
    const fakeCanvas = { toDataURL: vi.fn(() => "data:image/png;base64,FAKE") } as unknown as HTMLCanvasElement;
    vi.spyOn(renderHtmlToTexture, "renderHtmlToCanvas").mockResolvedValue(fakeCanvas);

    const result = await captureEmbedScreenshot(
      { htmlContent: '<img src="https://picsum.photos/200">', width: 200, height: 100 },
      2,
    );

    expect(renderHtmlToTexture.renderHtmlToCanvas).toHaveBeenCalledWith(
      '<img src="https://picsum.photos/200">',
      200,
      100,
      2,
    );
    expect(result).toBe("data:image/png;base64,FAKE");
  });

  it("returns null when the HTML fails to render to a canvas", async () => {
    vi.spyOn(renderHtmlToTexture, "renderHtmlToCanvas").mockResolvedValue(null);
    const result = await captureEmbedScreenshot({
      htmlContent: "<p>hi</p>",
      width: 100,
      height: 100,
    });
    expect(result).toBeNull();
  });

  it("returns null (rather than throwing) when the canvas is tainted by a non-CORS cross-origin image", async () => {
    const taintedCanvas = {
      toDataURL: vi.fn(() => {
        throw new DOMException("tainted canvas", "SecurityError");
      }),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(renderHtmlToTexture, "renderHtmlToCanvas").mockResolvedValue(taintedCanvas);

    const result = await captureEmbedScreenshot({
      htmlContent: '<img src="https://staticmap.openstreetmap.de/staticmap.php?center=0,0">',
      width: 100,
      height: 100,
    });

    expect(result).toBeNull();
  });
});
