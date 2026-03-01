import { Texture } from "pixi.js";
import { extractCssUrl, isTransparentColor } from "@/lib/htmlToDesignNodes";

/** Cache for rendered HTML textures by content+size key */
const textureCache = new Map<string, Texture>();
/** Dedup parallel renders for the same key */
const pendingRenders = new Map<string, Promise<Texture | null>>();
const HTML_TEXTURE_RENDER_VERSION = 6;

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
  const pixelWidth = Math.ceil(width * resolution);
  const pixelHeight = Math.ceil(height * resolution);

  // Prefer browser-native HTML layout via SVG foreignObject.
  // This yields accurate flex/text positioning when supported.
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

  // 1. Create a hidden container in the DOM for layout computation
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: -99999px;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    pointer-events: none;
    visibility: hidden;
  `;
  container.innerHTML = normalizedHtml;
  document.body.appendChild(container);

  // Wait one frame for the browser to compute layout
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(resolution, resolution);

    const containerRect = container.getBoundingClientRect();

    // Pre-load all background images before drawing
    const bgImageMap = await preloadBackgroundImages(container);

    // Recursively walk the DOM and draw each element
    walkAndDraw(ctx, container, containerRect, bgImageMap);

    const texture = Texture.from({ resource: canvas, resolution });
    textureCache.set(cacheKey, texture);
    return texture;
  } catch {
    return null;
  } finally {
    document.body.removeChild(container);
  }
}

function normalizeHtmlForEmbedRender(html: string): string {
  // Fast path: skip DOM round-trip when no fixed positioning is present
  if (!html.includes("fixed")) return html;
  try {
    const container = document.createElement("div");
    container.innerHTML = html;

    const allElements = container.querySelectorAll<HTMLElement>("*");
    for (const el of allElements) {
      if (el.style.position === "fixed") {
        el.style.position = "absolute";
      }
    }

    return container.innerHTML;
  } catch {
    return html;
  }
}

async function renderViaForeignObject(
  html: string,
  width: number,
  height: number,
  pixelWidth: number,
  pixelHeight: number,
  resolution: number,
): Promise<HTMLCanvasElement | null> {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
      ${html}
    </div>
  </foreignObject>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.scale(resolution, resolution);
    ctx.drawImage(img, 0, 0, width, height);

    // Ensure canvas is not tainted before passing to Pixi/WebGL.
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      return null;
    }

    return canvas;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string, useCors = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

/** Build a rounded-rect path on the context (does NOT call beginPath) */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radii: [number, number, number, number], // TL, TR, BR, BL
): void {
  const [tl, tr, br, bl] = radii;
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

function parseCssRadiusValue(raw: string, width: number, height: number): number {
  if (!raw) return 0;

  // Computed values can be like "12px", "50%", or "12px 8px".
  const token = raw.split("/")[0]?.trim().split(/\s+/)[0] ?? "";
  if (!token) return 0;

  let radius = 0;
  if (token.endsWith("%")) {
    const pct = parseFloat(token);
    if (!Number.isNaN(pct)) {
      radius = (Math.min(width, height) * pct) / 100;
    }
  } else {
    radius = parseFloat(token) || 0;
  }

  // Match CSS clamping behavior for large corner radii.
  return Math.max(0, Math.min(radius, Math.min(width, height) / 2));
}

/** Parse border-radius values from computed style into [TL, TR, BR, BL] */
function parseBorderRadii(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
): [number, number, number, number] {
  const tl = parseCssRadiusValue(style.borderTopLeftRadius, width, height);
  const tr = parseCssRadiusValue(style.borderTopRightRadius, width, height);
  const br = parseCssRadiusValue(style.borderBottomRightRadius, width, height);
  const bl = parseCssRadiusValue(style.borderBottomLeftRadius, width, height);
  return [tl, tr, br, bl];
}

/** Check if any border-radius value is > 0 */
function hasRadius(radii: [number, number, number, number]): boolean {
  return radii[0] > 0 || radii[1] > 0 || radii[2] > 0 || radii[3] > 0;
}

/**
 * Parse a CSS linear-gradient() and create a CanvasGradient.
 * Supports: linear-gradient(angle, color1, color2, ...)
 * Supports: linear-gradient(to direction, color1, color2, ...)
 */
function parseLinearGradient(
  ctx: CanvasRenderingContext2D,
  bgImage: string,
  x: number, y: number, w: number, h: number,
): CanvasGradient | null {
  // Match linear-gradient(...)
  const match = bgImage.match(/linear-gradient\((.+)\)/);
  if (!match) return null;

  const content = match[1].trim();

  // Split by top-level commas (not inside parentheses)
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of content) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());

  if (parts.length < 2) return null;

  // Parse angle/direction from first part
  let angleDeg = 180; // default: to bottom
  let colorStartIdx = 0;
  const first = parts[0];

  if (first.endsWith("deg")) {
    angleDeg = parseFloat(first);
    colorStartIdx = 1;
  } else if (first.startsWith("to ")) {
    const dir = first.slice(3).trim();
    const dirMap: Record<string, number> = {
      "top": 0, "right": 90, "bottom": 180, "left": 270,
      "top right": 45, "right top": 45,
      "bottom right": 135, "right bottom": 135,
      "bottom left": 225, "left bottom": 225,
      "top left": 315, "left top": 315,
    };
    angleDeg = dirMap[dir] ?? 180;
    colorStartIdx = 1;
  } else {
    // First part is a color, not a direction
    colorStartIdx = 0;
  }

  const colorParts = parts.slice(colorStartIdx);
  if (colorParts.length < 2) return null;

  // Convert angle to gradient line endpoints
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Length of gradient line
  const len = Math.abs(w * Math.cos(angleRad)) + Math.abs(h * Math.sin(angleRad));
  const halfLen = len / 2;

  const x0 = cx - Math.cos(angleRad) * halfLen;
  const y0 = cy - Math.sin(angleRad) * halfLen;
  const x1 = cx + Math.cos(angleRad) * halfLen;
  const y1 = cy + Math.sin(angleRad) * halfLen;

  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);

  for (let i = 0; i < colorParts.length; i++) {
    const cp = colorParts[i].trim();
    // Parse "color position%" or just "color"
    const stopMatch = cp.match(/^(.+?)\s+([\d.]+%?)$/);
    if (stopMatch) {
      const color = stopMatch[1].trim();
      let pos = parseFloat(stopMatch[2]) / 100;
      if (stopMatch[2].endsWith("%")) pos = parseFloat(stopMatch[2]) / 100;
      gradient.addColorStop(Math.max(0, Math.min(1, pos)), color);
    } else {
      // Evenly distribute
      const pos = colorParts.length > 1 ? i / (colorParts.length - 1) : 0;
      gradient.addColorStop(pos, cp);
    }
  }

  return gradient;
}

/**
 * Draw a preloaded background image onto the canvas, respecting
 * background-size (cover/contain/explicit) and background-position.
 */
function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  style: CSSStyleDeclaration,
  x: number, y: number, w: number, h: number,
): void {
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  if (imgW === 0 || imgH === 0) return;

  const bgSize = style.backgroundSize;
  let drawW: number;
  let drawH: number;

  if (bgSize === "cover") {
    const scale = Math.max(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
  } else if (bgSize === "contain") {
    const scale = Math.min(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
  } else if (bgSize && bgSize !== "auto") {
    const parts = bgSize.split(/\s+/);
    drawW = parseBgDimension(parts[0], w, imgW, imgH, true);
    drawH = parseBgDimension(parts[1] ?? "auto", h, imgW, imgH, false, drawW);
  } else {
    // auto — use natural size
    drawW = imgW;
    drawH = imgH;
  }

  // Parse background-position (defaults to "50% 50%" per spec but computed
  // style usually gives explicit px values like "0px 0px" or percentages).
  const bgPos = style.backgroundPosition;
  const posParts = bgPos ? bgPos.split(/\s+/) : ["50%", "50%"];
  const posX = parseBgPosition(posParts[0] ?? "50%", w, drawW);
  const posY = parseBgPosition(posParts[1] ?? "50%", h, drawH);

  ctx.drawImage(img, x + posX, y + posY, drawW, drawH);
}

/**
 * Draw an <img> element onto the canvas, respecting object-fit (cover/contain/fill).
 */
function drawImgElement(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  objectFit: string,
  x: number, y: number, w: number, h: number,
): void {
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  if (imgW === 0 || imgH === 0) return;

  let drawX = x;
  let drawY = y;
  let drawW = w;
  let drawH = h;

  if (objectFit === "contain") {
    const scale = Math.min(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
    drawX = x + (w - drawW) / 2;
    drawY = y + (h - drawH) / 2;
  } else if (objectFit === "cover") {
    const scale = Math.max(w / imgW, h / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
    drawX = x + (w - drawW) / 2;
    drawY = y + (h - drawH) / 2;
  }
  // "fill" (default) — stretch to fit, drawX/Y/W/H already correct

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

function parseBgDimension(
  value: string,
  containerDim: number,
  imgW: number,
  imgH: number,
  isWidth: boolean,
  otherDim?: number,
): number {
  if (value === "auto") {
    // Maintain aspect ratio relative to the other dimension
    if (otherDim !== undefined && otherDim > 0) {
      return isWidth
        ? otherDim * (imgW / imgH)
        : otherDim * (imgH / imgW);
    }
    return isWidth ? imgW : imgH;
  }
  if (value.endsWith("%")) {
    return (parseFloat(value) / 100) * containerDim;
  }
  return parseFloat(value) || (isWidth ? imgW : imgH);
}

function parseBgPosition(value: string, containerDim: number, imageDim: number): number {
  if (value === "center") return (containerDim - imageDim) / 2;
  if (value === "left" || value === "top") return 0;
  if (value === "right" || value === "bottom") return containerDim - imageDim;
  if (value.endsWith("%")) {
    const pct = parseFloat(value) / 100;
    return (containerDim - imageDim) * pct;
  }
  return parseFloat(value) || 0;
}

interface CanvasBoxShadow {
  inset: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

function splitShadowList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseBoxShadows(boxShadow: string): CanvasBoxShadow[] {
  if (!boxShadow || boxShadow === "none") return [];

  const result: CanvasBoxShadow[] = [];
  for (const part of splitShadowList(boxShadow)) {
    const inset = /\binset\b/.test(part);
    const colorMatch = part.match(/(rgba?\([^)]+\)|hsla?\([^)]+\)|#[\da-fA-F]{3,8}|transparent)/);
    const color = colorMatch?.[1] ?? "rgba(0, 0, 0, 0.35)";

    const withoutInset = part.replace(/\binset\b/g, "");
    const withoutColor = colorMatch ? withoutInset.replace(colorMatch[1], "") : withoutInset;
    const lengths = withoutColor.match(/-?\d*\.?\d+px/g) ?? [];
    if (lengths.length < 2) continue;

    const offsetX = parseFloat(lengths[0] ?? "0") || 0;
    const offsetY = parseFloat(lengths[1] ?? "0") || 0;
    const blur = parseFloat(lengths[2] ?? "0") || 0;
    const spread = parseFloat(lengths[3] ?? "0") || 0;
    result.push({ inset, offsetX, offsetY, blur, spread, color });
  }

  return result;
}

function drawBoxShadows(
  ctx: CanvasRenderingContext2D,
  shadows: CanvasBoxShadow[],
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
  fillStyle: string | CanvasGradient,
): void {
  for (const shadow of shadows) {
    if (shadow.inset) continue;
    const spreadX = x - shadow.spread;
    const spreadY = y - shadow.spread;
    const spreadW = w + shadow.spread * 2;
    const spreadH = h + shadow.spread * 2;
    if (spreadW <= 0 || spreadH <= 0) continue;

    const spreadRadii: [number, number, number, number] = [
      Math.max(0, radii[0] + shadow.spread),
      Math.max(0, radii[1] + shadow.spread),
      Math.max(0, radii[2] + shadow.spread),
      Math.max(0, radii[3] + shadow.spread),
    ];

    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = Math.max(0, shadow.blur);
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.fillStyle = fillStyle;
    if (hasRadius(spreadRadii)) {
      ctx.beginPath();
      traceRoundedRect(ctx, spreadX, spreadY, spreadW, spreadH, spreadRadii);
      ctx.fill();
    } else {
      ctx.fillRect(spreadX, spreadY, spreadW, spreadH);
    }
    ctx.restore();
  }
}

/** Scan the container for all elements with background-image: url(...) or <img src> and preload them */
async function preloadBackgroundImages(
  container: HTMLElement,
): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  const urls = new Set<string>();

  const allElements = container.querySelectorAll<HTMLElement>("*");
  for (const el of allElements) {
    const bgImage = window.getComputedStyle(el).backgroundImage;
    if (bgImage && bgImage !== "none") {
      const url = extractCssUrl(bgImage);
      if (url) urls.add(url);
    }
    // Also preload <img> element sources
    if (el.tagName === "IMG") {
      const src = (el as HTMLImageElement).src;
      if (src) urls.add(src);
    }
  }
  // Also check the container itself
  const containerBg = window.getComputedStyle(container).backgroundImage;
  if (containerBg && containerBg !== "none") {
    const url = extractCssUrl(containerBg);
    if (url) urls.add(url);
  }

  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const img = await loadImage(url);
        map.set(url, img);
      } catch {
        // Try without CORS as fallback
        try {
          const img = await loadImage(url, false);
          map.set(url, img);
        } catch {
          // Skip images that fail to load
        }
      }
    }),
  );

  return map;
}

/** Walk DOM tree and draw elements onto a 2D canvas */
function walkAndDraw(
  ctx: CanvasRenderingContext2D,
  element: Element,
  containerRect: DOMRect,
  bgImageMap: Map<string, HTMLImageElement>,
): void {
  const style = window.getComputedStyle(element);
  const { x, y, w, h } = getElementRectInContainer(element, style, containerRect);

  // Opacity
  const opacity = parseFloat(style.opacity);
  const hasOpacity = opacity < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha *= opacity;
  }

  const radii = parseBorderRadii(style, w, h);
  const rounded = hasRadius(radii);
  const shouldClipChildren = shouldClipByOverflow(style) && w > 0 && h > 0;

  // Draw background (solid color or gradient)
  const bg = style.backgroundColor;
  const bgImage = style.backgroundImage;
  const hasSolidBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
  const hasGradient = bgImage && bgImage !== "none" && bgImage.includes("linear-gradient");
  const gradient = hasGradient ? parseLinearGradient(ctx, bgImage, x, y, w, h) : null;
  const hasPaintCarrier = hasSolidBg || !!gradient;

  const boxShadows = parseBoxShadows(style.boxShadow);
  if (boxShadows.length > 0 && hasPaintCarrier && w > 0 && h > 0) {
    drawBoxShadows(ctx, boxShadows, x, y, w, h, radii, gradient ?? bg);
  }

  if (hasSolidBg || hasGradient) {
    if (hasGradient) {
      if (gradient) ctx.fillStyle = gradient;
      else if (hasSolidBg) ctx.fillStyle = bg;
    } else {
      ctx.fillStyle = bg;
    }

    if (rounded) {
      ctx.beginPath();
      traceRoundedRect(ctx, x, y, w, h, radii);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  // Draw background-image: url(...)
  if (bgImage && bgImage !== "none") {
    const bgUrl = extractCssUrl(bgImage);
    const img = bgUrl ? bgImageMap.get(bgUrl) : undefined;
    if (img && w > 0 && h > 0) {
      ctx.save();
      if (rounded) {
        ctx.beginPath();
        traceRoundedRect(ctx, x, y, w, h, radii);
        ctx.clip();
      }
      drawBackgroundImage(ctx, img, style, x, y, w, h);
      ctx.restore();
    }
  }

  // Draw <img> element
  if (element.tagName === "IMG" && w > 0 && h > 0) {
    const imgSrc = (element as HTMLImageElement).src;
    const img = imgSrc ? bgImageMap.get(imgSrc) : undefined;
    if (img) {
      ctx.save();
      if (rounded) {
        ctx.beginPath();
        traceRoundedRect(ctx, x, y, w, h, radii);
        ctx.clip();
      }
      // Draw image with object-fit behavior
      const objFit = style.objectFit;
      drawImgElement(ctx, img, objFit, x, y, w, h);
      ctx.restore();
    }
  }

  // Draw border (supports per-side widths/colors like CSS border-top only).
  const borderTopWidth = parseFloat(style.borderTopWidth) || 0;
  const borderRightWidth = parseFloat(style.borderRightWidth) || 0;
  const borderBottomWidth = parseFloat(style.borderBottomWidth) || 0;
  const borderLeftWidth = parseFloat(style.borderLeftWidth) || 0;
  const borderTopColor = style.borderTopColor;
  const borderRightColor = style.borderRightColor;
  const borderBottomColor = style.borderBottomColor;
  const borderLeftColor = style.borderLeftColor;
  const borderTopStyle = style.borderTopStyle;
  const borderRightStyle = style.borderRightStyle;
  const borderBottomStyle = style.borderBottomStyle;
  const borderLeftStyle = style.borderLeftStyle;

  const hasTop = borderTopWidth > 0 && borderTopStyle !== "none" && borderTopStyle !== "hidden" && !isTransparentColor(borderTopColor);
  const hasRight = borderRightWidth > 0 && borderRightStyle !== "none" && borderRightStyle !== "hidden" && !isTransparentColor(borderRightColor);
  const hasBottom = borderBottomWidth > 0 && borderBottomStyle !== "none" && borderBottomStyle !== "hidden" && !isTransparentColor(borderBottomColor);
  const hasLeft = borderLeftWidth > 0 && borderLeftStyle !== "none" && borderLeftStyle !== "hidden" && !isTransparentColor(borderLeftColor);

  const canUseUniformStroke =
    hasTop &&
    hasRight &&
    hasBottom &&
    hasLeft &&
    borderTopStyle === "solid" &&
    borderRightStyle === "solid" &&
    borderBottomStyle === "solid" &&
    borderLeftStyle === "solid" &&
    borderTopWidth === borderRightWidth &&
    borderTopWidth === borderBottomWidth &&
    borderTopWidth === borderLeftWidth &&
    borderTopColor === borderRightColor &&
    borderTopColor === borderBottomColor &&
    borderTopColor === borderLeftColor;

  if (canUseUniformStroke) {
    ctx.strokeStyle = borderTopColor;
    ctx.lineWidth = borderTopWidth;
    const bw2 = borderTopWidth / 2;
    if (rounded) {
      ctx.beginPath();
      traceRoundedRect(ctx, x + bw2, y + bw2, w - borderTopWidth, h - borderTopWidth, radii);
      ctx.stroke();
    } else {
      ctx.strokeRect(x + bw2, y + bw2, w - borderTopWidth, h - borderTopWidth);
    }
  } else if (hasTop || hasRight || hasBottom || hasLeft) {
    ctx.save();
    if (rounded) {
      ctx.beginPath();
      traceRoundedRect(ctx, x, y, w, h, radii);
      ctx.clip();
    }

    if (hasTop) {
      ctx.fillStyle = borderTopColor;
      ctx.fillRect(x, y, w, borderTopWidth);
    }
    if (hasRight) {
      ctx.fillStyle = borderRightColor;
      ctx.fillRect(x + w - borderRightWidth, y, borderRightWidth, h);
    }
    if (hasBottom) {
      ctx.fillStyle = borderBottomColor;
      ctx.fillRect(x, y + h - borderBottomWidth, w, borderBottomWidth);
    }
    if (hasLeft) {
      ctx.fillStyle = borderLeftColor;
      ctx.fillRect(x, y, borderLeftWidth, h);
    }
    ctx.restore();
  }

  // Clip descendants when overflow is not visible.
  if (shouldClipChildren) {
    ctx.save();
    ctx.beginPath();
    if (rounded) {
      traceRoundedRect(ctx, x, y, w, h, radii);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.clip();
  }

  // Process child nodes
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      walkAndDraw(ctx, child as Element, containerRect, bgImageMap);
    } else if (child.nodeType === Node.TEXT_NODE) {
      drawTextNode(ctx, child as Text, style, containerRect);
    }
  }

  if (shouldClipChildren) {
    ctx.restore();
  }
  if (hasOpacity) {
    ctx.restore();
  }
}

function shouldClipByOverflow(style: CSSStyleDeclaration): boolean {
  const overflow = style.overflow;
  const overflowX = style.overflowX;
  const overflowY = style.overflowY;

  const clips = (value: string): boolean =>
    value === "hidden" || value === "clip";

  return clips(overflow) || clips(overflowX) || clips(overflowY);
}

function parseCssLength(value: string | null | undefined, containerSize: number): number | null {
  if (!value || value === "auto") return null;
  if (value.endsWith("%")) {
    const pct = parseFloat(value);
    return Number.isFinite(pct) ? (containerSize * pct) / 100 : null;
  }
  const px = parseFloat(value);
  return Number.isFinite(px) ? px : null;
}

function getElementRectInContainer(
  element: Element,
  style: CSSStyleDeclaration,
  containerRect: DOMRect,
): { x: number; y: number; w: number; h: number } {
  const rect = element.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  if (style.position !== "fixed") {
    return {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top,
      w,
      h,
    };
  }

  // Safety net: normalizeHtmlForEmbedRender converts fixed→absolute before
  // rendering, so the code below is normally unreachable.

  // The offscreen wrapper used for measurement is itself fixed and attached
  // to body with large negative coordinates. Keep it in local (0,0)-relative
  // space; otherwise clipping can move outside the canvas and hide everything.
  if (element.parentElement === document.body || element.parentElement === document.documentElement) {
    return {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top,
      w,
      h,
    };
  }

  // In fallback mode we emulate app-like embeds where fixed bars (e.g. bottom nav)
  // should stick to the local HTML viewport (usually the root app shell), not the
  // full embed texture size.
  const parentRect = element.parentElement?.getBoundingClientRect();
  const useParentAnchor =
    !!parentRect &&
    parentRect.width > 0 &&
    parentRect.height > 0 &&
    element.parentElement !== document.body &&
    element.parentElement !== document.documentElement;

  const anchorLeft = useParentAnchor ? parentRect.left : containerRect.left;
  const anchorTop = useParentAnchor ? parentRect.top : containerRect.top;
  const anchorWidth = useParentAnchor ? parentRect.width : containerRect.width;
  const anchorHeight = useParentAnchor ? parentRect.height : containerRect.height;

  const left = parseCssLength(style.left, anchorWidth);
  const right = parseCssLength(style.right, anchorWidth);
  const top = parseCssLength(style.top, anchorHeight);
  const bottom = parseCssLength(style.bottom, anchorHeight);

  let x = rect.left - containerRect.left;
  let y = rect.top - containerRect.top;
  const anchorX = anchorLeft - containerRect.left;
  const anchorY = anchorTop - containerRect.top;

  if (left !== null) x = anchorX + left;
  else if (right !== null) x = anchorX + anchorWidth - right - w;

  if (top !== null) y = anchorY + top;
  else if (bottom !== null) y = anchorY + anchorHeight - bottom - h;

  return { x, y, w, h };
}

/** Draw a text node onto the canvas using Range.getClientRects for line-accurate positioning */
function drawTextNode(
  ctx: CanvasRenderingContext2D,
  textNode: Text,
  parentStyle: CSSStyleDeclaration,
  containerRect: DOMRect,
): void {
  const text = textNode.textContent;
  if (!text || !text.trim()) return;

  ctx.fillStyle = parentStyle.color;
  ctx.font = `${parentStyle.fontStyle} ${parentStyle.fontWeight} ${parentStyle.fontSize} ${parentStyle.fontFamily}`;

  // Use Range API to get per-line rects for wrapped text
  const range = document.createRange();
  range.selectNodeContents(textNode);
  const allRects = range.getClientRects();

  if (allRects.length === 0) return;
  const fontSizePx = parseFloat(parentStyle.fontSize) || 16;
  const preserveWhitespace = parentStyle.whiteSpace.startsWith("pre");

  // For multi-line (wrapped) text, find which characters belong to which line
  // by binary searching through character offsets
  const lines = extractLinesFromRects(textNode, allRects, containerRect, preserveWhitespace);
  for (const line of lines) {
    drawTextInLineBox(ctx, line.text, line.x, line.y, line.height, fontSizePx);
  }
}

interface TextLine {
  text: string;
  x: number;
  y: number;
  height: number;
}

function drawTextInLineBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  lineTop: number,
  lineHeight: number,
  fontSizePx: number,
): void {
  // Use font/em box metrics (not glyph box) to match CSS line box positioning.
  const refMetrics = ctx.measureText("Mg");
  const ascent =
    refMetrics.fontBoundingBoxAscent ||
    refMetrics.emHeightAscent ||
    fontSizePx * 0.8;
  const descent =
    refMetrics.fontBoundingBoxDescent ||
    refMetrics.emHeightDescent ||
    fontSizePx * 0.2;
  const fontBoxHeight = Math.max(1, ascent + descent);
  const extraLeading = Math.max(0, lineHeight - fontBoxHeight);
  const baselineY = lineTop + extraLeading / 2 + ascent;

  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, baselineY);
}

/** Extract per-line text and positions from a text node with multiple client rects */
function extractLinesFromRects(
  textNode: Text,
  rects: DOMRectList,
  containerRect: DOMRect,
  preserveWhitespace: boolean,
): TextLine[] {
  const lines: TextLine[] = [];
  const text = textNode.textContent ?? "";
  const range = document.createRange();

  // Group rects by unique Y position (each line has a distinct top)
  const lineYs: number[] = [];
  const lineHeights: number[] = [];
  for (let i = 0; i < rects.length; i++) {
    const top = Math.round(rects[i].top);
    const h = rects[i].height;
    const existingIdx = lineYs.findIndex((lineTop) => Math.abs(lineTop - top) <= 2);
    if (existingIdx === -1) {
      lineYs.push(top);
      lineHeights.push(h);
    } else {
      lineHeights[existingIdx] = Math.max(lineHeights[existingIdx], h);
    }
  }

  // For each line, find the character range using binary search
  let charStart = 0;
  for (let lineIdx = 0; lineIdx < lineYs.length; lineIdx++) {
    const lineY = lineYs[lineIdx];
    const isLast = lineIdx === lineYs.length - 1;
    let charEnd = text.length;

    if (!isLast) {
      // Binary search for where the next line starts
      let lo = charStart;
      let hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(textNode, mid);
        range.setEnd(textNode, mid + 1);
        const midRect = range.getBoundingClientRect();
        if (Math.round(midRect.top) > lineY + 2) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      charEnd = lo;
    }

    let drawStart = charStart;
    let drawEnd = charEnd;

    if (!preserveWhitespace) {
      while (drawStart < drawEnd && /\s/.test(text[drawStart])) drawStart++;
      while (drawEnd > drawStart && /\s/.test(text[drawEnd - 1])) drawEnd--;
    }

    if (drawStart < drawEnd) {
      let lineText = text.slice(drawStart, drawEnd);
      if (!preserveWhitespace) {
        lineText = lineText.replace(/\s+/g, " ");
      }

      if (!lineText) {
        charStart = charEnd;
        continue;
      }

      // Get position of first char in this line
      range.setStart(textNode, drawStart);
      range.setEnd(textNode, Math.min(drawStart + 1, text.length));
      const firstCharRect = range.getBoundingClientRect();

      lines.push({
        text: lineText,
        x: firstCharRect.left - containerRect.left,
        y: firstCharRect.top - containerRect.top,
        height: lineHeights[lineIdx] ?? firstCharRect.height,
      });
    }

    charStart = charEnd;
  }

  return lines;
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
