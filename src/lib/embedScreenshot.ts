import type { EmbedNode } from "@/types/scene";
import { renderHtmlToCanvas } from "@/pixi/renderers/htmlTexture/renderHtmlToTexture";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";

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
/**
 * Render an embed node's live HTML content to a canvas (not yet encoded to a
 * data URL) — the shared core of `captureEmbedScreenshot` below, also used
 * directly by the raster export path (`renderNodeToCanvas` in
 * `exportUtils.ts`) so it can composite an embed's pixels into a bigger
 * exported bitmap (a whole exported frame, PDF page, etc.) without a
 * throwaway PNG-encode/decode round trip.
 *
 * `nodeId`, when passed, resolves the node's effective theme
 * (`getEffectiveThemeForNode`) and appends the same `buildVariableStyleBlock`
 * `<style>:root{...}</style>` block that `EmbedLayer.tsx` injects before
 * mounting the live Shadow-DOM overlay — without it, `var(--color-...)`
 * references in the embed's HTML have nothing to resolve against off-canvas
 * (a foreignObject SVG document doesn't inherit page-level custom
 * properties), so exported/screenshotted colors would silently fall back to
 * their CSS default instead of the resolved value visible on screen.
 */
export async function captureEmbedCanvas(
  node: Pick<EmbedNode, "htmlContent" | "width" | "height">,
  resolution: number = window.devicePixelRatio || 1,
  nodeId?: string,
): Promise<HTMLCanvasElement | null> {
  if (!node.htmlContent || !node.width || !node.height) return null;
  const themeBlock = nodeId ? buildVariableStyleBlock(undefined, getEffectiveThemeForNode(nodeId)) : "";
  const html = themeBlock ? node.htmlContent + themeBlock : node.htmlContent;
  return renderHtmlToCanvas(html, node.width, node.height, resolution);
}

export async function captureEmbedScreenshot(
  node: Pick<EmbedNode, "htmlContent" | "width" | "height">,
  resolution: number = window.devicePixelRatio || 1,
  nodeId?: string,
): Promise<string | null> {
  const canvas = await captureEmbedCanvas(node, resolution, nodeId);
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
