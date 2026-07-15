import type { FlatSceneNode, LayoutProperties, TextNode } from "@/types/scene";
import { generateLayoutStyles } from "@/lib/designToHtml/layoutStyleGeneration";
import { generateVisualStyles, generateTextStyles } from "@/lib/designToHtml/styleGeneration";

/**
 * The declaration record for one node, shared by every codegen generator
 * (`css.ts` goes through `buildCssForNodes` directly; `tailwind.ts` and
 * `react.ts` both need the raw record to map into classes/style objects).
 * Kept in one place so the three generators can never drift on what a node's
 * CSS declarations are.
 */
export function nodeDeclarations(
  node: FlatSceneNode,
  parentLayout: LayoutProperties | undefined,
  isRoot: boolean,
): Record<string, string> {
  return {
    ...generateLayoutStyles(node, parentLayout, isRoot),
    ...generateVisualStyles(node),
    ...(node.type === "text" ? generateTextStyles(node as TextNode) : {}),
  };
}
