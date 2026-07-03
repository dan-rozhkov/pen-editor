/**
 * Reconciles the vertical text position between the DOM `contentEditable` inline
 * editor and the PixiJS canvas renderer.
 *
 * PixiJS positions each line's baseline at `ascent + linePositionYShift`, where
 * `linePositionYShift = (lineHeight - fontHeight) / 2` is **clamped to >= 0**
 * (see pixi.js `CanvasTextGenerator`). So when `lineHeight` is smaller than the
 * font's natural height (ascent + descent) — e.g. lineHeight = 1 — Pixi draws
 * the first baseline at `ascent` with no negative leading, keeping the text
 * top-aligned in the node box.
 *
 * The browser, rendering the same reduced `line-height`, instead **centers** the
 * glyph in the line box: it applies a negative half-leading that pulls the text
 * upward. That upward shift is the visible "jump" when entering edit mode.
 *
 * We measure both baselines for the given font + line-height and return the
 * difference (positive = shift the editor down) so the editor's glyphs land
 * exactly where Pixi draws them.
 */

// Same probe strings PixiJS uses in `CanvasTextMetrics.measureFont`, so our
// ascent/descent match its baseline math exactly.
const PIXI_METRICS_STRING = "|ÉqÅ";
const PIXI_BASELINE_SYMBOL = "M";

let measureCanvas: HTMLCanvasElement | null = null;
const offsetCache = new Map<string, number>();

// Offsets are derived from canvas/DOM font metrics, so an offset computed while
// a web font is still loading is based on the fallback font. Evict the cache
// when fonts finish loading (mirroring PixiJS's own `CanvasTextMetrics.clearMetrics`
// on the same event) so the next edit re-measures against the real glyphs.
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener("loadingdone", () => offsetCache.clear());
}

/**
 * @param fontShorthand CSS `font` shorthand at *screen* size (e.g.
 *   `"normal normal 700 28px Inter"`) — the same string used for the editor and
 *   passed to a canvas 2D context.
 * @param lineHeightPx Resolved line height in *screen* px (multiplier * screen
 *   font size).
 * @returns Vertical offset in screen px to translate the editor downward.
 */
export function measureTextEditorVerticalOffset(
  fontShorthand: string,
  lineHeightPx: number,
): number {
  if (typeof document === "undefined") return 0;

  const key = `${fontShorthand}|${lineHeightPx}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;

  // --- Pixi baseline (from the top of the line box) ---
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = fontShorthand;
  const metrics = ctx.measureText(PIXI_METRICS_STRING + PIXI_BASELINE_SYMBOL);
  const ascent = metrics.actualBoundingBoxAscent ?? 0;
  const descent = metrics.actualBoundingBoxDescent ?? 0;
  const fontHeight = ascent + descent;
  // Stubbed canvas (unit tests / SSR) yields zero metrics — no offset to apply.
  if (fontHeight <= 0) return 0;
  const shift = lineHeightPx - fontHeight < 0 ? 0 : (lineHeightPx - fontHeight) / 2;
  const pixiBaseline = ascent + shift;

  // --- DOM baseline (from the top of the line box) ---
  // A zero-size inline-block aligned to the baseline marks where the browser
  // places the baseline after applying its own (possibly negative) leading.
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;font:${fontShorthand};line-height:${lineHeightPx}px;white-space:pre;`;
  const line = document.createElement("div");
  line.textContent = PIXI_BASELINE_SYMBOL;
  const marker = document.createElement("span");
  marker.style.cssText =
    "display:inline-block;width:0;height:0;vertical-align:baseline;";
  line.appendChild(marker);
  box.appendChild(line);
  document.body.appendChild(box);
  const domBaseline =
    marker.getBoundingClientRect().top - box.getBoundingClientRect().top;
  document.body.removeChild(box);

  const offset = pixiBaseline - domBaseline;
  offsetCache.set(key, offset);
  return offset;
}
