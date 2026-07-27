import type { EmbedNode } from "@/types/scene";
import { renderHtmlToCanvas } from "@/pixi/renderers/htmlTexture/renderHtmlToTexture";

/**
 * Render an embed node's live HTML content to a PNG data URL, for use as a
 * `get_screenshot`/UI preview image.
 *
 * WHY this exists (FIR-56): embeds render as a Shadow-DOM overlay above the
 * PixiJS canvas (see `EmbedLayer.tsx`), not as PixiJS scene content —
 * `embedRenderer.ts` deliberately keeps an embed's PixiJS container empty
 * (see its doc comment: "The Pixi side keeps only an empty, invisible
 * container"). `get_screenshot`/`captureNodeScreenshot` extract pixels
 * straight from the PixiJS renderer (`app.renderer.extract.base64`), so
 * without this helper, screenshotting an embed node (or asking for one while
 * it's selected) always returns a blank/transparent image — regardless of
 * whether the embed's own images actually loaded in the real, visible
 * canvas. Across multiple AI design-agent sessions this blank screenshot was
 * repeatedly misread as "external images don't load inside the embed",
 * contradicting what a human looking at the live canvas actually sees.
 *
 * This reuses the HTML→canvas rendering pipeline built for `renderHtmlToTexture`
 * (previously dormant — kept for "a future screenshot/export path", per
 * `embedRenderer.ts`) instead of duplicating it.
 */
export async function captureEmbedScreenshot(
  node: Pick<EmbedNode, "htmlContent" | "width" | "height">,
  resolution: number = window.devicePixelRatio || 1,
): Promise<string | null> {
  if (!node.htmlContent || !node.width || !node.height) return null;

  const canvas = await renderHtmlToCanvas(node.htmlContent, node.width, node.height, resolution);
  if (!canvas) return null;

  try {
    return canvas.toDataURL("image/png");
  } catch {
    // The canvas was tainted by a cross-origin image served without CORS
    // headers (drawImage() still paints it — only pixel readback is
    // blocked), so there is nothing safely readable to return. This mirrors
    // the same taint guard `renderHtmlToTexture`'s DOM-walk fallback already
    // applies before uploading to a PixiJS/WebGL texture.
    return null;
  }
}
