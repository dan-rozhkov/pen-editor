import type { FlatSceneNode } from "@/types/scene";
import { buildCssForNodes } from "@/lib/designToCss/buildCss";
import { stripTrailingZeros } from "@/lib/inspect/units";

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

/**
 * Matches a numeric CSS length token immediately followed by "px", e.g.
 * "12px", "-4.5px", "0px". The leading negative lookbehind requires the
 * token to start at an identifier boundary, so it does NOT match a px-shaped
 * substring embedded in a custom-property name/reference, e.g. the "16px" in
 * "--spacing-16px" (as a `:root` declaration name or inside a `var(...)`
 * reference) is left untouched.
 */
const PX_LENGTH_RE = /(?<![\w-])(-?\d*\.?\d+)px\b/g;

/** Convert one `<n>px` match to its rem equivalent, e.g. "12px" -> "0.75rem", "0px" -> "0". */
function pxTokenToRem(px: number, remBase: number): string {
  if (px === 0) return "0";
  const rem = px / remBase;
  return stripTrailingZeros(rem.toFixed(4)) + "rem";
}

/**
 * Rewrite every `<n>px` length token in `value` to its rem equivalent. Meant
 * to be called on a single CSS *value* (a declaration's right-hand side, or
 * an arbitrary-value bracket's contents) — never on a whole CSS text, since
 * a blind whole-string replace would also mangle selectors (`.button-8px`),
 * comments (`/* Button 8px *\/`), and custom-property *names*
 * (`--spacing-16px`) that happen to contain a `px`-shaped substring.
 *
 * Exported for reuse by sibling codegen generators (e.g. `tailwind.ts`'s
 * `bracketValue`, `react.ts`'s `styleObjectSource`) that need the same
 * px->rem conversion scoped to one value string.
 */
export function convertPxToRem(value: string, remBase: number): string {
  return value.replace(PX_LENGTH_RE, (_match, px: string) => pxTokenToRem(Number(px), remBase));
}

/** Matches one declaration line as emitted by `formatDeclarations`/`buildTokensBlock`: leading whitespace, a property name (incl. `--custom-props`), `:`, then the value up to a trailing `;`. Never matches selector lines (`.foo {`), comment lines (`/* ... *\/`), or brace lines — those have no leading indent in the generated CSS. */
const DECLARATION_LINE_RE = /^(\s+)([a-zA-Z-]+|--[a-zA-Z0-9_-]+)(:\s*)(.*)(;\s*)$/;

/**
 * Rewrite `<n>px` length tokens to rem across a full CSS text, but only
 * inside declaration *values* — never in selectors, comments, or property
 * names (including custom-property names like `--spacing-16px`). Scans
 * line by line since the generated CSS here is always one declaration (or
 * selector/comment/brace) per line.
 */
function convertCssPxToRem(css: string, remBase: number): string {
  return css
    .split("\n")
    .map((line) => {
      const m = line.match(DECLARATION_LINE_RE);
      if (!m) return line;
      const [, indent, prop, colon, value, semi] = m;
      return `${indent}${prop}${colon}${convertPxToRem(value, remBase)}${semi}`;
    })
    .join("\n");
}

/**
 * Generate standalone CSS for the given node(s), reusing the same style
 * generators as `buildCssForNodes` (no duplicated style logic) and
 * optionally rewriting px lengths to rem in declaration values only.
 */
export function buildCssCode(
  nodeIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  options: CodegenOptions,
): BuildCssCodeResult {
  const { css, warnings } = buildCssForNodes(nodeIds, nodesById);
  const code = options.units === "rem" ? convertCssPxToRem(css, options.remBase) : css;
  return { code, warnings };
}
