import type { TextNode } from "@/types/scene";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "@/utils/textMeasure";
import type { TransformHandle } from "./types";

/** Side (left/right) handles change width only. */
function isSideHandle(corner: TransformHandle): boolean {
  return corner === "l" || corner === "r";
}

/** Top/bottom or corner handles change height. */
function isHeightHandle(corner: TransformHandle): boolean {
  return (
    corner === "t" ||
    corner === "b" ||
    corner === "tl" ||
    corner === "tr" ||
    corner === "bl" ||
    corner === "br"
  );
}

/**
 * Decide the text-specific resize behaviour for a handle drag (Figma parity).
 *
 * Pure & unit-testable — no store access. The caller already computed the new
 * geometry (`width`/`height`) from the mouse delta; this function returns the
 * mode to apply and, for auto-height side drags, the live-remeasured height so
 * the box hugs content while dragging.
 */
export function resolveTextResize(
  node: TextNode,
  corner: TransformHandle,
  width: number,
  height: number,
): { textWidthMode: TextNode["textWidthMode"]; width: number; height: number } {
  if (isSideHandle(corner)) {
    // Side drag → auto-height: fixed width, height re-hugs content live.
    const measuredHeight = measureTextFixedWidthHeight({ ...node, width });
    return { textWidthMode: "fixed", width, height: measuredHeight };
  }
  if (isHeightHandle(corner)) {
    // Top/bottom/corner drag → fixed-size: both dims fixed, no remeasure.
    return { textWidthMode: "fixed-height", width, height };
  }
  return { textWidthMode: node.textWidthMode, width, height };
}

/**
 * Decide the target mode when a text handle is double-clicked (reset gesture):
 * side → auto-width; bottom/top → auto-height (fixed); corner → auto-width.
 * Returns null for handles with no reset behaviour.
 */
export function resolveTextHandleReset(
  corner: TransformHandle,
): TextNode["textWidthMode"] | null {
  if (isSideHandle(corner)) return "auto";
  if (corner === "b" || corner === "t") return "fixed";
  if (corner === "tl" || corner === "tr" || corner === "bl" || corner === "br") {
    return "auto";
  }
  return null;
}

/** Minimum width clamp: the widest single character at the current font. */
export function minTextWidth(node: TextNode): number {
  const text = node.text || "";
  let max = 1;
  for (const ch of text) {
    if (ch === "\n" || ch === " ") continue;
    const w = measureTextAutoSize({ ...node, text: ch }).width;
    if (w > max) max = w;
  }
  return Math.ceil(max);
}
