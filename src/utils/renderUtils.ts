import type {
  DescendantOverride,
  PerSideStroke,
  SceneNode,
} from "@/types/scene";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";

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

  return syncTextDimensions(mergedNode);
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
