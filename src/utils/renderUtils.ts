import type {
  DescendantOverride,
  PerSideStroke,
  SceneNode,
  TextNode,
} from "@/types/scene";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "@/utils/textMeasure";

// Apply descendant overrides to a node
export function applyDescendantOverride(
  node: SceneNode,
  override?: DescendantOverride,
): SceneNode {
  if (!override) return node;
  // Apply override properties (excluding nested descendants)
  const { descendants: _, ...overrideProps } = override;
  const mergedNode = { ...node, ...overrideProps } as SceneNode;

  if (mergedNode.type !== "text") {
    return mergedNode;
  }

  const affectsTextMeasure = [
    "text",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textWidthMode",
    "width",
  ].some((key) => key in overrideProps);

  if (!affectsTextMeasure) {
    return mergedNode;
  }

  const textNode = mergedNode as TextNode;
  const mode = textNode.textWidthMode;
  if (!mode || mode === "auto") {
    const measured = measureTextAutoSize(textNode);
    return { ...textNode, width: measured.width, height: measured.height };
  }
  if (mode === "fixed") {
    const measuredHeight = measureTextFixedWidthHeight(textNode);
    return { ...textNode, height: measuredHeight };
  }
  return textNode;
}

// Check if a node should be rendered (considering enabled property)
export function isNodeEnabled(override?: DescendantOverride): boolean {
  return override?.enabled !== false;
}

// Helper to check if node has per-side stroke
export function hasPerSideStroke(strokeWidthPerSide?: PerSideStroke): boolean {
  if (!strokeWidthPerSide) return false;
  const { top, right, bottom, left } = strokeWidthPerSide;
  return !!(top || right || bottom || left);
}
