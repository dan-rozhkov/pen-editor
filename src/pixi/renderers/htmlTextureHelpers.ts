import { Texture } from "pixi.js";

/** Cache for rendered HTML textures by content+size key */
const textureCache = new Map<string, Texture>();
/** Dedup parallel renders for the same key */
const pendingRenders = new Map<string, Promise<Texture | null>>();
const HTML_TEXTURE_RENDER_VERSION = 4;

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
  const pixelWidth = Math.ceil(width * resolution);
  const pixelHeight = Math.ceil(height * resolution);

  // Prefer browser-native HTML layout via SVG foreignObject.
  // This yields accurate flex/text positioning when supported.
  const foreignObjectCanvas = await renderViaForeignObject(
    html,
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
  container.innerHTML = html;
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

    // Recursively walk the DOM and draw each element
    walkAndDraw(ctx, container, containerRect);

    const texture = Texture.from({ resource: canvas, resolution });
    textureCache.set(cacheKey, texture);
    return texture;
  } catch {
    return null;
  } finally {
    document.body.removeChild(container);
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
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

/** Walk DOM tree and draw elements onto a 2D canvas */
function walkAndDraw(
  ctx: CanvasRenderingContext2D,
  element: Element,
  containerRect: DOMRect,
): void {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const x = rect.left - containerRect.left;
  const y = rect.top - containerRect.top;
  const w = rect.width;
  const h = rect.height;

  // Opacity
  const opacity = parseFloat(style.opacity);
  const hasOpacity = opacity < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha *= opacity;
  }

  const radii = parseBorderRadii(style, w, h);
  const rounded = hasRadius(radii);

  // Draw background (solid color or gradient)
  const bg = style.backgroundColor;
  const bgImage = style.backgroundImage;
  const hasSolidBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
  const hasGradient = bgImage && bgImage !== "none" && bgImage.includes("linear-gradient");

  if (hasSolidBg || hasGradient) {
    if (hasGradient) {
      const gradient = parseLinearGradient(ctx, bgImage, x, y, w, h);
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

  // Draw border
  const borderWidth = parseFloat(style.borderTopWidth) || 0;
  if (borderWidth > 0) {
    const borderColor = style.borderTopColor;
    if (borderColor && borderColor !== "rgba(0, 0, 0, 0)") {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = borderWidth;
      const bw2 = borderWidth / 2;
      if (rounded) {
        ctx.beginPath();
        traceRoundedRect(ctx, x + bw2, y + bw2, w - borderWidth, h - borderWidth, radii);
        ctx.stroke();
      } else {
        ctx.strokeRect(x + bw2, y + bw2, w - borderWidth, h - borderWidth);
      }
    }
  }

  // Process child nodes
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      walkAndDraw(ctx, child as Element, containerRect);
    } else if (child.nodeType === Node.TEXT_NODE) {
      drawTextNode(ctx, child as Text, style, containerRect);
    }
  }

  if (hasOpacity) {
    ctx.restore();
  }
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
