import type {
  PerCornerRadius,
  PerSideStroke,
} from "@/types/scene";

// Helper to check if node has per-side stroke
export function hasPerSideStroke(strokeWidthPerSide?: PerSideStroke): boolean {
  if (!strokeWidthPerSide) return false;
  const { top, right, bottom, left } = strokeWidthPerSide;
  return top != null || right != null || bottom != null || left != null;
}

// Helper to check if node has per-corner radius
export function hasPerCornerRadius(r?: PerCornerRadius): boolean {
  if (!r) return false;
  return r.topLeft != null || r.topRight != null || r.bottomRight != null || r.bottomLeft != null;
}
