import { PAINT_BLEND_MODES, type Paint, type PaintBlendMode } from "@/types/scene";
import { createSolidPaint, createGradientPaint, createImagePaint } from "@/utils/fillUtils";
import { imageModeFromCssSize } from "@/lib/cssBackground";
import { parseColorWithOpacity, extractCssUrl } from "./colorParsing";
import { splitSelectorList } from "./cssScoping";
import { parseCssGradient, detectSolidGradient } from "./gradientParsing";

function normalizeBlendMode(value: string | undefined): PaintBlendMode | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "normal") return undefined;
  return (PAINT_BLEND_MODES as readonly string[]).includes(trimmed)
    ? (trimmed as PaintBlendMode)
    : undefined;
}

/** Index into a per-layer list, repeating the last value when the list is shorter. */
function pick(list: string[], index: number): string | undefined {
  if (list.length === 0) return undefined;
  return list[index] ?? list[list.length - 1];
}

/**
 * Build a Figma-style paint stack (bottom-to-top) from CSS background
 * properties. Returns null when there is nothing multi-layered to represent —
 * i.e. zero layers, or a single layer that the legacy single-fill path already
 * handles (one solid color, one gradient, or one image). Callers fall back to
 * the legacy `fill`/`gradientFill`/`imageFill` representation in those cases.
 *
 * CSS lists the topmost layer first; our stack is bottom-to-top, so the
 * resulting array reverses the CSS order. `background-color` (if any) is the
 * bottommost solid layer.
 */
export function parseBackgroundToPaints(args: {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundBlendMode: string;
}): Paint[] | null {
  const bgColor = parseColorWithOpacity(args.backgroundColor);
  const imageList =
    args.backgroundImage && args.backgroundImage !== "none"
      ? splitSelectorList(args.backgroundImage)
      : [];
  const sizeList = args.backgroundSize ? splitSelectorList(args.backgroundSize) : [];
  const blendList = args.backgroundBlendMode
    ? splitSelectorList(args.backgroundBlendMode)
    : [];

  // Total layer count = image layers + (1 if a background color exists).
  const colorLayerCount = bgColor ? 1 : 0;
  const totalLayers = imageList.length + colorLayerCount;
  if (totalLayers <= 1) return null; // single/empty → let legacy path handle it.

  // Parse each CSS background-image layer (CSS order = top-to-bottom).
  const cssLayerPaints: Paint[] = [];
  for (let i = 0; i < imageList.length; i++) {
    const layer = imageList[i];
    const blendMode = normalizeBlendMode(pick(blendList, i));
    const init = blendMode ? { blendMode } : undefined;

    const solidFromGradient = detectSolidGradient(layer);
    if (solidFromGradient) {
      cssLayerPaints.push(
        createSolidPaint(solidFromGradient.color, {
          ...(solidFromGradient.opacity !== undefined ? { opacity: solidFromGradient.opacity } : {}),
          ...init,
        }),
      );
      continue;
    }

    const gradient = parseCssGradient(layer);
    if (gradient) {
      cssLayerPaints.push(createGradientPaint(gradient, init));
      continue;
    }

    const url = extractCssUrl(layer);
    if (url) {
      const mode = imageModeFromCssSize(pick(sizeList, i));
      cssLayerPaints.push(createImagePaint({ url, mode }, init));
      continue;
    }
    // Unrecognized layer (e.g. "none") — skip it.
  }

  // Reverse CSS (top-to-bottom) into bottom-to-top stack order.
  cssLayerPaints.reverse();

  const paints: Paint[] = [];
  if (bgColor) {
    paints.push(
      createSolidPaint(bgColor.color, bgColor.opacity !== undefined ? { opacity: bgColor.opacity } : undefined),
    );
  }
  paints.push(...cssLayerPaints);

  // If after parsing we collapsed back to <=1 paint, defer to legacy handling.
  if (paints.length <= 1) return null;
  return paints;
}
