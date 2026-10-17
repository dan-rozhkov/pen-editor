import type { FlatSceneNode, TextNode } from "@/types/scene";
import { generateVisualStyles, generateTextStyles } from "@/lib/designToHtml/styleGeneration";
import { generateLayoutStyles } from "@/lib/designToHtml/layoutStyleGeneration";
import { getRenderableFills } from "@/utils/fillUtils";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue, type Variable } from "@/types/variable";

export interface BuildCssResult {
  /** Full CSS text: an optional `:root` tokens block followed by one rule block per node. */
  css: string;
  warnings: string[];
}

/**
 * Turn a node/layer name into a CSS-safe class name, e.g. "Primary Button" ->
 * "primary-button". Falls back to the node type when the name is empty or
 * fully non-alphanumeric (e.g. an emoji-only layer name).
 */
function slugify(name: string | undefined, fallback: string): string {
  const base = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || fallback;
}

/**
 * Neutralize a string for safe embedding inside a `/* ... *\/` CSS comment.
 * Untrusted node names (AI output, Figma/Pixso import, crafted .pen files)
 * could otherwise contain a literal `*\/` that closes the comment early,
 * letting the rest of the name be injected as live CSS. Also strips
 * newlines/carriage returns so the comment can't be broken across lines.
 */
function escapeCssComment(name: string): string {
  return name.replace(/\*\//g, "*\\/").replace(/[\r\n]+/g, " ");
}

/** Make `className` unique against `used`, suffixing with -2, -3, ... on collision. */
function uniqueClassName(className: string, used: Set<string>): string {
  if (!used.has(className)) {
    used.add(className);
    return className;
  }
  let i = 2;
  while (used.has(`${className}-${i}`)) i++;
  const unique = `${className}-${i}`;
  used.add(unique);
  return unique;
}

/**
 * Variable ids referenced by a node's *emitted* CSS. Deliberately narrower
 * than "every binding field on the node": only fill/stroke bindings are
 * resolved to `var(--token)` by `generateVisualStyles` today (shadow-color
 * bindings exist on `ShadowEffect.colorBinding` but `generateShadowCss`
 * doesn't resolve them yet), so collecting anything else here would emit a
 * `:root` token that never appears in the CSS body.
 */
export function collectBoundVariableIds(node: FlatSceneNode): Set<string> {
  const ids = new Set<string>();
  for (const paint of getRenderableFills(node)) {
    if (paint.type === "solid" && paint.colorBinding) {
      ids.add(paint.colorBinding.variableId);
    }
  }
  if (node.strokeBinding) {
    ids.add(node.strokeBinding.variableId);
  }
  return ids;
}

function formatDeclarations(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([prop, value]) => `  ${prop}: ${value};`)
    .join("\n");
}

/** Build a raw `:root { --token: value; ... }` CSS text for the given variable ids (empty string if none resolve). Exported for reuse by codegen generators (`tailwind.ts`, `react.ts`) that emit `var(--token)` references without a definitions block of their own. */
export function buildTokensBlock(variableIds: Set<string>, variables: Variable[], theme: "light" | "dark"): string {
  if (variableIds.size === 0) return "";
  const lines = variables
    .filter((v) => variableIds.has(v.id))
    .map((v) => `  ${v.name}: ${getVariableValue(v, theme)};`);
  if (lines.length === 0) return "";
  return `:root {\n${lines.join("\n")}\n}`;
}

/**
 * Build a CSS block per node: dimensions, fills/strokes, effects, corner
 * radius, and (for auto-layout frames) flexbox — by reusing the same
 * declaration generators `designToHtml` uses for full-document export, just
 * without turning the result into HTML. Bound variables surface as
 * `var(--token, fallback)` (already resolved by `generateVisualStyles`) plus
 * a `:root { --token: value; }` block collecting every token referenced.
 */
export function buildCssForNodes(nodeIds: string[], nodesById: Record<string, FlatSceneNode>): BuildCssResult {
  const warnings: string[] = [];
  const blocks: string[] = [];
  const usedClassNames = new Set<string>();
  const boundVariableIds = new Set<string>();

  for (const nodeId of nodeIds) {
    const node = nodesById[nodeId];
    if (!node) {
      warnings.push(`Node not found: ${nodeId}`);
      continue;
    }

    for (const id of collectBoundVariableIds(node)) boundVariableIds.add(id);

    const styles = {
      // isRoot=true: intentionally suppresses width/height for
      // fill_container/fit_content sizing modes. Those modes have no
      // intrinsic pixel size once the node is copied out of its parent's
      // layout context, so emitting nothing (rather than a wrong/arbitrary
      // value) is correct here — not a bug to "fix".
      ...generateLayoutStyles(node, undefined, true),
      ...generateVisualStyles(node),
      ...(node.type === "text" ? generateTextStyles(node as TextNode) : {}),
    };

    const className = uniqueClassName(slugify(node.name, node.type), usedClassNames);
    const label = escapeCssComment(node.name ?? node.type);
    blocks.push(`/* ${label} */\n.${className} {\n${formatDeclarations(styles)}\n}`);
  }

  const { variables } = useVariableStore.getState();
  const { activeTheme } = useThemeStore.getState();
  const tokensBlock = buildTokensBlock(boundVariableIds, variables, activeTheme);

  const css = [tokensBlock, ...blocks].filter(Boolean).join("\n\n");
  return { css, warnings };
}
