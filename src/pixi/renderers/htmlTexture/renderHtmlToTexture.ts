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
const HTML_TEXTURE_RENDER_VERSION = 12;
const EDGE_BLEED_RADIUS = 2;

function makeCacheKey(html: string, width: number, height: number, resolution: number): string {
  return `v${HTML_TEXTURE_RENDER_VERSION}:${width}x${height}@${resolution}:${html}`;
}

function getPixelIndex(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function hasOpaqueAndTransparentNeighbors(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  alpha: number,
): boolean {
  let nearOpaque = false;
  let nearTransparent = alpha === 0;

  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
      if (nx === x && ny === y) continue;

      const neighborAlpha = src[getPixelIndex(width, nx, ny) + 3] ?? 0;
      if (neighborAlpha === 0) nearTransparent = true;
      if (neighborAlpha >= 250) nearOpaque = true;

      if (nearOpaque && nearTransparent) return true;
    }
  }

  return false;
}

function findBestBleedSourceIndex(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let bestIdx = -1;
  let bestAlpha = -1;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (let dy = -EDGE_BLEED_RADIUS; dy <= EDGE_BLEED_RADIUS; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;

    for (let dx = -EDGE_BLEED_RADIUS; dx <= EDGE_BLEED_RADIUS; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;

      const neighborIdx = getPixelIndex(width, nx, ny);
      const neighborAlpha = src[neighborIdx + 3];
      if (neighborAlpha <= 0) continue;

      const distanceSq = dx * dx + dy * dy;
      if (
        neighborAlpha > bestAlpha ||
        (neighborAlpha === bestAlpha && distanceSq < bestDistanceSq)
      ) {
        bestIdx = neighborIdx;
        bestAlpha = neighborAlpha;
        bestDistanceSq = distanceSq;
      }
    }
  }

  return bestIdx;
}

function bleedTransparentEdgeColors(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  if (width <= 0 || height <= 0) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getPixelIndex(width, x, y);
      const alpha = src[idx + 3];
      if (alpha >= 255) continue;

      if (!hasOpaqueAndTransparentNeighbors(src, width, height, x, y, alpha)) continue;

      const bestIdx = findBestBleedSourceIndex(src, width, height, x, y);
      if (bestIdx < 0) continue;

      out[idx] = src[bestIdx];
      out[idx + 1] = src[bestIdx + 1];
      out[idx + 2] = src[bestIdx + 2];
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
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
  const pixelWidth = Math.max(1, Math.round(width * resolution));
  const pixelHeight = Math.max(1, Math.round(height * resolution));
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
      bleedTransparentEdgeColors(foreignObjectCanvas);
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
  container.className = "ck-preflight-root";
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

    bleedTransparentEdgeColors(canvas);

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
