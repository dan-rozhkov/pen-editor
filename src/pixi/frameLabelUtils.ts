import { CanvasTextMetrics, TextStyle } from "pixi.js";

const ELLIPSIS = "...";
const widthCache = new Map<string, number>();

function getStyleCacheKey(style: TextStyle): string {
  const family = Array.isArray(style.fontFamily) ? style.fontFamily.join(",") : String(style.fontFamily ?? "");
  return `${family}|${String(style.fontSize ?? "")}|${String(style.fontWeight ?? "")}|${String(style.fontStyle ?? "")}|${String(style.letterSpacing ?? "")}`;
}

export function measureLabelTextWidth(text: string, style: TextStyle): number {
  const cacheKey = `${getStyleCacheKey(style)}|${text}`;
  const cached = widthCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const width = CanvasTextMetrics.measureText(text, style).width;
  widthCache.set(cacheKey, width);
  return width;
}

export function truncateLabelToWidth(
  text: string,
  maxWidthPx: number,
  style: TextStyle,
): string {
  if (!text || maxWidthPx <= 0) return "";
  if (measureLabelTextWidth(text, style) <= maxWidthPx) return text;

  const ellipsisWidth = measureLabelTextWidth(ELLIPSIS, style);
  if (ellipsisWidth > maxWidthPx) return "";

  let low = 0;
  let high = text.length;
  let best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ELLIPSIS}`;
    if (measureLabelTextWidth(candidate, style) <= maxWidthPx) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
