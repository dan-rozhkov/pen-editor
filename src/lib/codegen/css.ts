import type { FlatSceneNode } from "@/types/scene";
import { buildCssForNodes } from "@/lib/designToCss/buildCss";

/**
 * Shared options for the codegen family (CSS/Tailwind/React generators in
 * this directory). `units` picks the unit for emitted lengths; `remBase` is
 * the px-per-rem conversion base used when `units === "rem"`.
 */
export interface CodegenOptions {
  units: "px" | "rem";
  remBase: number;
}

export interface BuildCssCodeResult {
  code: string;
  warnings: string[];
}

/** Matches a numeric CSS length token immediately followed by "px", e.g. "12px", "-4.5px", "0px". */
const PX_LENGTH_RE = /(-?\d*\.?\d+)px\b/g;

/**
 * Strip trailing zeros and a dangling decimal point, e.g. "0.7500" -> "0.75",
 * "1.0000" -> "1".
 */
function stripTrailingZeros(num: string): string {
  return num.replace(/\.?0+$/, "");
}

/** Convert one `<n>px` match to its rem equivalent, e.g. "12px" -> "0.75rem", "0px" -> "0". */
function pxTokenToRem(px: number, remBase: number): string {
  if (px === 0) return "0";
  const rem = px / remBase;
  return stripTrailingZeros(rem.toFixed(4)) + "rem";
}

/**
 * Rewrite every `<n>px` length token in `css` to its rem equivalent. Applied
 * to the whole output (rule bodies and the `:root` tokens block alike,
 * including inside `var(--token, <fallback>)`) since all of them are CSS
 * lengths in practice — there is no non-length `px` token emitted today.
 *
 * Exported for reuse by sibling codegen generators (e.g. `tailwind.ts`) that
 * need the same px->rem conversion for arbitrary-value bracket contents.
 */
export function convertPxToRem(css: string, remBase: number): string {
  return css.replace(PX_LENGTH_RE, (_match, value: string) => pxTokenToRem(Number(value), remBase));
}

/**
 * Generate standalone CSS for the given node(s), reusing the same style
 * generators as `buildCssForNodes` (no duplicated style logic) and
 * optionally rewriting px lengths to rem.
 */
export function buildCssCode(
  nodeIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  options: CodegenOptions,
): BuildCssCodeResult {
  const { css, warnings } = buildCssForNodes(nodeIds, nodesById);
  const code = options.units === "rem" ? convertPxToRem(css, options.remBase) : css;
  return { code, warnings };
}
