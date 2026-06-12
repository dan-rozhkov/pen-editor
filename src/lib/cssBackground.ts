import type { ImageFillMode } from "@/types/scene";

/**
 * Shared `ImageFill.mode` ↔ CSS `background-size` mapping.
 *
 * Both directions of the HTML conversion depend on this pair staying in sync:
 * designToHtml (`styleGeneration.ts`) emits the size keyword, htmlToDesign
 * (`backgroundParsing.ts`, `styleApplication.ts`) parses it back. Keeping the
 * two functions side by side makes the roundtrip contract explicit.
 *
 * fill → cover, fit → contain, stretch → 100% 100%.
 */
export function imageModeToCssSize(mode: ImageFillMode): string {
  switch (mode) {
    case "fit":
      return "contain";
    case "stretch":
      return "100% 100%";
    case "fill":
    default:
      return "cover";
  }
}

/** Inverse of {@link imageModeToCssSize}; unknown/absent sizes map to "fill". */
export function imageModeFromCssSize(size: string | undefined): ImageFillMode {
  const v = (size ?? "").trim().toLowerCase();
  if (v === "contain") return "fit";
  if (v === "100% 100%" || v === "100%" || v === "stretch") return "stretch";
  return "fill";
}
