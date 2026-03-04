import { Texture } from "pixi.js";
import { hasBodyTargetedStyles, mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import { materializePseudoElements } from "@/utils/pseudoElementMaterializer";
import { normalizeTinySvgDotPaths } from "@/utils/svgDotNormalization";
import { ensureExternalFontStylesLoaded, waitForFontsUsedInTree } from "./fontLoading";
import { normalizeHtmlForEmbedRender, renderViaForeignObject } from "./foreignObject";
import { preloadRenderAssets } from "./svgAssets";
import { walkAndDraw } from "./canvasDrawing";

/** Cache for rendered HTML textures by content+size key */
const textureCache = new Map<string, Texture>();
/** Dedup parallel renders for the same key */
const pendingRenders = new Map<string, Promise<Texture | null>>();
const HTML_TEXTURE_RENDER_VERSION = 9;

function makeCacheKey(html: string, width: number, height: number, resolution: number): string {
  return `v${HTML_TEXTURE_RENDER_VERSION}:${width}x${height}@${resolution}:${html}`;
}

/**
 * Render HTML/CSS content to a PixiJS Texture.
 * First tries SVG foreignObject for browser-native layout fidelity,
 * then falls back to manual DOM walk + Canvas rendering.
 */
export async function renderHtmlToTexture(
  html: string,
  width: number,
  height: number,
  resolution: number = window.devicePixelRatio,
): Promise<Texture | null> {
  const key = makeCacheKey(html, width, height, resolution);

  const cached = textureCache.get(key);
  if (cached) return cached;

  const pending = pendingRenders.get(key);
  if (pending) return pending;

  const promise = doRender(html, width, height, resolution, key);
  pendingRenders.set(key, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    pendingRenders.delete(key);
  }
}

async function doRender(
  html: string,
  width: number,
  height: number,
  resolution: number,
  cacheKey: string,
): Promise<Texture | null> {
  const normalizedHtml = normalizeHtmlForEmbedRender(html);
  await ensureExternalFontStylesLoaded(normalizedHtml);
  const pixelWidth = Math.ceil(width * resolution);
  const pixelHeight = Math.ceil(height * resolution);
  const hasInlineSvg = /<svg[\s>]/i.test(normalizedHtml);
  const hasBodyStyles = hasBodyTargetedStyles(normalizedHtml);

  // Prefer browser-native HTML layout via SVG foreignObject.
  // This yields accurate flex/text positioning when supported.
  // For inline SVG content we skip this path because foreignObject support is
  // inconsistent across browsers for nested SVG.
  if (!hasInlineSvg && !hasBodyStyles) {
    const foreignObjectCanvas = await renderViaForeignObject(
      normalizedHtml,
      width,
      height,
      pixelWidth,
      pixelHeight,
      resolution,
    );
    if (foreignObjectCanvas) {
      const texture = Texture.from({ resource: foreignObjectCanvas, resolution });
      textureCache.set(cacheKey, texture);
      return texture;
    }
  }

  // 1. Create an isolated hidden container for layout computation.
  // Shadow DOM prevents embed <style> rules from affecting editor UI during render.
  const host = document.createElement("div");
  host.style.cssText = `
    position: fixed;
    left: -99999px;
    top: -99999px;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    pointer-events: none;
    visibility: hidden;
  `;

  const shadow = host.attachShadow({ mode: "open" });

  const container = document.createElement("div");
  container.style.cssText = `
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    margin: 0;
    padding: 0;
  `;
  const { root: renderRoot } = mountHtmlWithBodyStyles(container, normalizedHtml, width, height);
  shadow.appendChild(container);
  document.body.appendChild(host);

  // Wait one frame for the browser to compute layout
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    materializePseudoElements(renderRoot);
    normalizeTinySvgDotPaths(renderRoot);

    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(resolution, resolution);

    const containerRect = renderRoot.getBoundingClientRect();

    // Pre-load background images and web fonts in parallel before drawing.
    const [renderAssets] = await Promise.all([
      preloadRenderAssets(renderRoot),
      waitForFontsUsedInTree(renderRoot),
    ]);

    // Recursively walk the DOM and draw each element
    walkAndDraw(ctx, renderRoot, containerRect, renderAssets);

    // Guard against tainted canvas (cross-origin images without CORS),
    // otherwise Pixi/WebGL can throw SecurityError on texture upload.
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      return null;
    }

    const texture = Texture.from({ resource: canvas, resolution });
    textureCache.set(cacheKey, texture);
    return texture;
  } catch {
    return null;
  } finally {
    document.body.removeChild(host);
  }
}

/** Invalidate cached texture when content changes.
 *  Only removes from cache — does NOT destroy the texture,
 *  since sprites may still reference it until they are replaced. */
export function invalidateHtmlTexture(
  html: string,
  width: number,
  height: number,
  resolution: number = window.devicePixelRatio,
): void {
  const key = makeCacheKey(html, width, height, resolution);
  textureCache.delete(key);
}
