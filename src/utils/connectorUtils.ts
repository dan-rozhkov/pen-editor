import type { AnchorPosition, FrameNode, SceneNode } from "@/types/scene";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";

const ANCHOR_OFFSET = 10;

/**
 * Compute the world-space position of a node's anchor point.
 * Anchors are placed outside the node edges by ANCHOR_OFFSET pixels.
 */
export function getAnchorWorldPosition(
  nodeId: string,
  anchor: AnchorPosition,
  nodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { x: number; y: number } | null {
  const absPos = getNodeAbsolutePositionWithLayout(nodes, nodeId, calculateLayoutForFrame);
  const size = getNodeEffectiveSize(nodes, nodeId, calculateLayoutForFrame);
  if (!absPos || !size) return null;

  switch (anchor) {
    case "top":
      return { x: absPos.x + size.width / 2, y: absPos.y - ANCHOR_OFFSET };
    case "bottom":
      return { x: absPos.x + size.width / 2, y: absPos.y + size.height + ANCHOR_OFFSET };
    case "left":
      return { x: absPos.x - ANCHOR_OFFSET, y: absPos.y + size.height / 2 };
    case "right":
      return { x: absPos.x + size.width + ANCHOR_OFFSET, y: absPos.y + size.height / 2 };
  }
}

/**
 * Shorten a line segment by `amount` from the end point.
 * Returns the new end point so the line stops at the arrowhead base.
 */
export function shortenLineEnd(
  x1: number, y1: number, x2: number, y2: number, amount: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < amount) return { x: x1, y: y1 };
  const ratio = (len - amount) / len;
  return { x: x1 + dx * ratio, y: y1 + dy * ratio };
}

/**
 * Draw an arrowhead triangle at `toX, toY` pointing in the direction from→to.
 */
export function drawArrowhead(
  gfx: import("pixi.js").Graphics,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  arrowSize: number,
  fillOptions: { color: number; alpha?: number },
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);

  const ax1 = toX - arrowSize * Math.cos(angle - Math.PI / 6);
  const ay1 = toY - arrowSize * Math.sin(angle - Math.PI / 6);
  const ax2 = toX - arrowSize * Math.cos(angle + Math.PI / 6);
  const ay2 = toY - arrowSize * Math.sin(angle + Math.PI / 6);

  gfx.moveTo(toX, toY);
  gfx.lineTo(ax1, ay1);
  gfx.lineTo(ax2, ay2);
  gfx.closePath();
  gfx.fill(fillOptions);
}
