import type { FlatFrameNode, FlatSceneNode, LayoutProperties, TextNode } from "@/types/scene";
import { FLEX_FILL } from "@/lib/designToHtml/layoutStyleGeneration";
import { getRenderableFills } from "@/utils/fillUtils";
import { type CodegenOptions, convertPxToRem } from "./css";
import { nodeDeclarations } from "./declarations";
import { collectBoundVariableIds, buildTokensBlock } from "@/lib/designToCss/buildCss";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";

export function hasVideoFill(node: FlatSceneNode): boolean {
  return getRenderableFills(node).some((paint) => paint.type === "video");
}

/**
 * Union of `collectBoundVariableIds` over `nodeId` and its whole emitted
 * subtree (mirrors `buildElement`'s traversal). Used so Tailwind/React output
 * — which emits `var(--token)` references with no `:root` definitions of its
 * own (unlike `buildCssForNodes`) — can surface the tokens the pasted markup
 * needs.
 */
export function collectSubtreeVariableIds(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Set<string> {
  const ids = new Set<string>();
  const node = nodesById[nodeId];
  if (!node) return ids;
  for (const id of collectBoundVariableIds(node)) ids.add(id);
  for (const childId of childrenById[nodeId] ?? []) {
    for (const id of collectSubtreeVariableIds(childId, nodesById, childrenById)) ids.add(id);
  }
  return ids;
}

/** `:root {...}` CSS text for `variableIds` using the current variable store + active theme (empty string if none resolve). */
export function tokensBlockForIds(variableIds: Set<string>): string {
  if (variableIds.size === 0) return "";
  const { variables } = useVariableStore.getState();
  const { activeTheme } = useThemeStore.getState();
  return buildTokensBlock(variableIds, variables, activeTheme);
}

/** Variable *names* (e.g. `--primary`) for `variableIds`, in the current variable store — used for the leaf-output warning listing needed tokens. */
function tokenNamesForIds(variableIds: Set<string>): string[] {
  if (variableIds.size === 0) return [];
  const { variables } = useVariableStore.getState();
  return variables.filter((v) => variableIds.has(v.id)).map((v) => v.name);
}

/** Node types with no dedicated Tailwind/React renderer today (instances, vectors, embeds — `childrenById` only tracks `frame`/`group` subtrees). Rendered as an empty placeholder div, flagged via `warnings`. */
export const UNSUPPORTED_NODE_TYPES = new Set(["ref", "embed", "path", "line", "polygon", "connector"]);

/** Human label per unsupported node type, used in the placeholder warning message. */
const TYPE_LABELS: Record<string, string> = {
  ref: "Component instance",
  embed: "Embed",
  path: "Vector",
  line: "Line",
  polygon: "Polygon",
  connector: "Connector",
};

/** Warning pushed once per unsupported/video-fill node rendered as an empty placeholder div. */
export function unsupportedNodeWarning(node: FlatSceneNode): string {
  const label = TYPE_LABELS[node.type] ?? node.type;
  const name = node.name ? ` '${node.name}'` : "";
  return `${label}${name} rendered as empty placeholder — instances/vectors/embeds are not yet supported in Tailwind/React output.`;
}

/** Warning pushed once per video-fill node, which also renders as an empty placeholder div (no dedicated `<video>` output yet). */
export function videoFillWarning(node: FlatSceneNode): string {
  const name = node.name ? ` '${node.name}'` : "";
  return `Node${name} has a video fill rendered as an empty placeholder — video fills are not yet supported in Tailwind/React output.`;
}

export interface BuildTailwindCodeResult {
  code: string;
  warnings: string[];
}

/** Matches a `var(--token, <fallback>)` value so its fallback can be dropped inside a Tailwind bracket. */
const VAR_WITH_FALLBACK_RE = /^var\((--[a-zA-Z0-9_-]+)\s*,/;

/** Matches a bare `<n>px` length value, e.g. "12px", "-4.5px". Does not match composite/shorthand values. */
const SINGLE_PX_RE = /^(-?\d*\.?\d+)px$/;

/**
 * Property -> { value -> class } table for declarations whose value maps
 * directly to a fixed Tailwind utility class regardless of scale.
 */
const KEYWORD_CLASSES: Record<string, Record<string, string>> = {
  display: { flex: "flex" },
  "flex-direction": {
    row: "flex-row",
    column: "flex-col",
    "row-reverse": "flex-row-reverse",
    "column-reverse": "flex-col-reverse",
  },
  "flex-wrap": { wrap: "flex-wrap", nowrap: "flex-nowrap", "wrap-reverse": "flex-wrap-reverse" },
  "align-items": {
    "flex-start": "items-start",
    "flex-end": "items-end",
    center: "items-center",
    stretch: "items-stretch",
    baseline: "items-baseline",
  },
  "justify-content": {
    "flex-start": "justify-start",
    "flex-end": "justify-end",
    center: "justify-center",
    "space-between": "justify-between",
    "space-around": "justify-around",
    "space-evenly": "justify-evenly",
  },
  "align-self": {
    "flex-start": "self-start",
    "flex-end": "self-end",
    center: "self-center",
    stretch: "self-stretch",
    baseline: "self-baseline",
    auto: "self-auto",
  },
  "align-content": { center: "content-center", "flex-end": "content-end", "flex-start": "content-start" },
  position: { relative: "relative", absolute: "absolute", fixed: "fixed", sticky: "sticky", static: "static" },
  overflow: { hidden: "overflow-hidden", visible: "overflow-visible", scroll: "overflow-scroll", auto: "overflow-auto" },
  "box-sizing": { "border-box": "box-border", "content-box": "box-content" },
  "text-align": { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify" },
  "white-space": { nowrap: "whitespace-nowrap", normal: "whitespace-normal", pre: "whitespace-pre" },
  "text-transform": { uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize" },
  "font-style": { italic: "italic", normal: "not-italic" },
  "text-decoration": { underline: "underline", "line-through": "line-through" },
};

/** Property -> Tailwind spacing-utility prefix, for the 0.25rem-step spacing scale. */
const SPACING_PREFIX: Record<string, string> = {
  width: "w",
  height: "h",
  "min-width": "min-w",
  "max-width": "max-w",
  "min-height": "min-h",
  "max-height": "max-h",
  padding: "p",
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  gap: "gap",
  "row-gap": "gap-y",
  "column-gap": "gap-x",
  top: "top",
  left: "left",
  right: "right",
  bottom: "bottom",
};

/** Property -> Tailwind prefix for declarations that always emit an arbitrary value (no standard scale). */
const DIRECT_ARBITRARY_PREFIX: Record<string, string> = {
  "background-color": "bg",
  "background-image": "bg",
  color: "text",
  "box-shadow": "shadow",
  "z-index": "z",
  "letter-spacing": "tracking",
  "line-height": "leading",
  "font-family": "font",
};

const RADIUS_SCALE: Record<number, string> = { 4: "sm", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl" };

const FONT_SIZE_SCALE: Record<number, string> = {
  12: "xs",
  14: "sm",
  16: "base",
  18: "lg",
  20: "xl",
  24: "2xl",
  30: "3xl",
  36: "4xl",
  48: "5xl",
  60: "6xl",
  72: "7xl",
  96: "8xl",
  128: "9xl",
};

const FONT_WEIGHT_SCALE: Record<string, string> = {
  "100": "thin",
  "200": "extralight",
  "300": "light",
  "400": "normal",
  "500": "medium",
  "600": "semibold",
  "700": "bold",
  "800": "extrabold",
  "900": "black",
  bold: "bold",
};

/** Parse a bare `<n>px` or literal `"0"` value to a px number; returns null for anything else (shorthand, var(), keywords). */
function parsePx(value: string): number | null {
  if (value === "0") return 0;
  const m = value.match(SINGLE_PX_RE);
  return m ? Number(m[1]) : null;
}

/**
 * Build the contents of a Tailwind arbitrary-value bracket: `var(--token,
 * fallback)` collapses to `var(--token)` (dropping the fallback, per the
 * codegen conventions doc); otherwise px lengths convert to rem when
 * requested (mirrors `convertPxToRem` from `css.ts`, applied to every `<n>px`
 * token so composite values like a box-shadow list convert in one pass), and
 * whitespace becomes `_` (Tailwind's space escape inside brackets).
 */
function bracketValue(value: string, options: CodegenOptions): string {
  const varMatch = value.match(VAR_WITH_FALLBACK_RE);
  if (varMatch) return `var(${varMatch[1]})`;
  const converted = options.units === "rem" ? convertPxToRem(value, options.remBase) : value;
  return converted.replace(/\s+/g, "_");
}

/** `<prefix>-<n>` when `value` is a non-negative exact multiple of 4px (Tailwind's 0.25rem spacing step); arbitrary otherwise. */
function spacingClass(prefix: string, value: string, options: CodegenOptions): string {
  const px = parsePx(value);
  if (px !== null && px >= 0 && px % 4 === 0) {
    return `${prefix}-${px / 4}`;
  }
  return `${prefix}-[${bracketValue(value, options)}]`;
}

function radiusClass(value: string, options: CodegenOptions): string {
  const px = parsePx(value);
  if (px === 9999) return "rounded-full";
  if (px !== null && RADIUS_SCALE[px]) return `rounded-${RADIUS_SCALE[px]}`;
  return `rounded-[${bracketValue(value, options)}]`;
}

function fontSizeClass(value: string, options: CodegenOptions): string {
  const px = parsePx(value);
  if (px !== null && FONT_SIZE_SCALE[px]) return `text-${FONT_SIZE_SCALE[px]}`;
  return `text-[${bracketValue(value, options)}]`;
}

function fontWeightClass(value: string, options: CodegenOptions): string {
  const named = FONT_WEIGHT_SCALE[value];
  if (named) return `font-${named}`;
  return `font-[${bracketValue(value, options)}]`;
}

function opacityClass(value: string, options: CodegenOptions): string {
  const num = Number(value);
  if (!Number.isNaN(num)) {
    const percent = Math.round(num * 100);
    if (percent >= 0 && percent <= 100 && percent % 5 === 0) return `opacity-${percent}`;
  }
  return `opacity-[${bracketValue(value, options)}]`;
}

function flexShrinkClass(value: string, options: CodegenOptions): string {
  if (value === "0") return "shrink-0";
  if (value === "1") return "shrink";
  return `shrink-[${bracketValue(value, options)}]`;
}

/** Arbitrary-property fallback for declarations with no dedicated Tailwind utility, e.g. `[transform:rotate(45deg)]`. */
function arbitraryProperty(prop: string, value: string, options: CodegenOptions): string {
  return `[${prop}:${bracketValue(value, options)}]`;
}

/**
 * Map one CSS-declarations record (as produced by `generateLayoutStyles` /
 * `generateVisualStyles` / `generateTextStyles`) to a list of Tailwind
 * utility classes, in declaration order. A value that matches the standard
 * Tailwind v4 scale for its property (spacing, radius, font-size,
 * font-weight, opacity, or a fixed keyword utility) emits the named class;
 * anything else emits an arbitrary value/property. Does not deduplicate or
 * reorder — callers get exactly one class per input declaration.
 */
export function declarationsToTailwind(decls: Record<string, string>, options: CodegenOptions): string[] {
  const classes: string[] = [];

  for (const [prop, value] of Object.entries(decls)) {
    const keywordMap = KEYWORD_CLASSES[prop];
    const keywordClass = keywordMap?.[value];
    if (keywordClass) {
      classes.push(keywordClass);
      continue;
    }

    switch (prop) {
      case "opacity":
        classes.push(opacityClass(value, options));
        continue;
      case "border-radius":
        classes.push(radiusClass(value, options));
        continue;
      case "font-size":
        classes.push(fontSizeClass(value, options));
        continue;
      case "font-weight":
        classes.push(fontWeightClass(value, options));
        continue;
      case "flex-shrink":
        classes.push(flexShrinkClass(value, options));
        continue;
      case "flex":
        classes.push(value === FLEX_FILL ? "flex-1" : arbitraryProperty(prop, value, options));
        continue;
      default:
        break;
    }

    const spacingPrefix = SPACING_PREFIX[prop];
    if (spacingPrefix) {
      classes.push(spacingClass(spacingPrefix, value, options));
      continue;
    }

    const directPrefix = DIRECT_ARBITRARY_PREFIX[prop];
    if (directPrefix) {
      classes.push(`${directPrefix}-[${bracketValue(value, options)}]`);
      continue;
    }

    classes.push(arbitraryProperty(prop, value, options));
  }

  return classes;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/**
 * Recursively render a node and its subtree as indented `<div class="...">`
 * markup (2 spaces per depth level). Every node type renders as a `div`; a
 * text node's escaped `text` becomes its content, everything else nests its
 * children via `childrenById`. Missing child ids are recorded in `warnings`
 * and skipped (matching `buildCssForNodes`'s convention).
 */
function buildElement(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
  depth: number,
  options: CodegenOptions,
  warnings: string[],
): string | null {
  const node = nodesById[nodeId];
  if (!node) {
    warnings.push(`Node not found: ${nodeId}`);
    return null;
  }

  const classes = declarationsToTailwind(nodeDeclarations(node, parentLayout, isRoot), options);
  const indent = "  ".repeat(depth);
  const classAttr = classes.length > 0 ? ` class="${escapeHtmlAttr(classes.join(" "))}"` : "";

  if (node.type === "text") {
    const content = escapeHtml((node as TextNode).text ?? "");
    return `${indent}<div${classAttr}>${content}</div>`;
  }

  if (UNSUPPORTED_NODE_TYPES.has(node.type)) {
    warnings.push(unsupportedNodeWarning(node));
  } else if (hasVideoFill(node)) {
    warnings.push(videoFillWarning(node));
  }

  const childIds = childrenById[nodeId] ?? [];
  if (childIds.length === 0) {
    return `${indent}<div${classAttr}></div>`;
  }

  const childLayout = node.type === "frame" ? (node as FlatFrameNode).layout : undefined;
  const childLines = childIds
    .map((childId) => buildElement(childId, nodesById, childrenById, childLayout, false, depth + 1, options, warnings))
    .filter((line): line is string => line !== null)
    .join("\n");
  return `${indent}<div${classAttr}>\n${childLines}\n${indent}</div>`;
}

/**
 * Generate Tailwind utility classes for `nodeId`, reusing the same style
 * generators as `buildCssCode` (no duplicated style logic) — only the
 * declaration-record -> class mapping is new here.
 *
 * A leaf node (no children) emits just the class string on one line, meant
 * to be pasted onto an existing element's `class` attribute. A node with
 * children emits indented `<div class="...">` markup for the whole subtree.
 */
export function buildTailwindCode(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  options: CodegenOptions,
): BuildTailwindCodeResult {
  const warnings: string[] = [];
  const node = nodesById[nodeId];
  if (!node) {
    warnings.push(`Node not found: ${nodeId}`);
    return { code: "", warnings };
  }

  const childIds = childrenById[nodeId] ?? [];
  if (childIds.length === 0) {
    const classes = declarationsToTailwind(nodeDeclarations(node, undefined, true), options);
    const tokenNames = tokenNamesForIds(collectBoundVariableIds(node));
    if (tokenNames.length > 0) {
      warnings.push(`Requires CSS variable definitions: ${tokenNames.join(", ")}.`);
    }
    return { code: classes.join(" "), warnings };
  }

  const code = buildElement(nodeId, nodesById, childrenById, undefined, true, 0, options, warnings) ?? "";
  const tokensBlock = tokensBlockForIds(collectSubtreeVariableIds(nodeId, nodesById, childrenById));
  const finalCode = tokensBlock ? `<!--\n${tokensBlock}\n-->\n${code}` : code;
  return { code: finalCode, warnings };
}
