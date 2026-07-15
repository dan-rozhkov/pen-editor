import { Container, Graphics, Text } from "pixi.js";
import { useHoverStore, worldMouse } from "@/store/hoverStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDevModeStore } from "@/store/devModeStore";
import type { FlatFrameNode, TextNode } from "@/types/scene";
import type { OverlayHelpers, Rect } from "./helpers";
import { drawTextBaselines, drawDashedRect, drawHatchedRect } from "./helpers";
import {
  COMPONENT_SELECTION_COLOR,
  FLOATING_LABEL_FONT_SIZE,
  FLOATING_LABEL_PADDING_X,
  FLOATING_LABEL_PADDING_Y,
  FLOATING_LABEL_RADIUS,
  FLOATING_LABEL_STYLE,
  GAP_COLOR,
  GAP_OVERLAY_ALPHA,
  HOVER_COLOR,
  PADDING_OVERLAY_ALPHA,
  SELECTION_COLOR,
  TEXT_BASELINE_COLOR,
} from "./constants";

const INDICATOR_LINE_LENGTH = 7;

// Pooled PixiJS objects for spacing overlays (avoid create/destroy per frame)
let spacingGfx: Graphics | null = null;
let labelGroup: Container | null = null;
let labelBg: Graphics | null = null;
let labelText: Text | null = null;

function ensureSpacingPool(): { gfx: Graphics; group: Container; bg: Graphics; text: Text } {
  if (!spacingGfx) spacingGfx = new Graphics();
  if (!labelGroup) labelGroup = new Container();
  if (!labelBg) labelBg = new Graphics();
  if (!labelText) labelText = new Text({ text: "", style: FLOATING_LABEL_STYLE });
  if (!labelGroup.children.length) {
    labelGroup.addChild(labelBg);
    labelGroup.addChild(labelText);
  }
  return { gfx: spacingGfx, group: labelGroup, bg: labelBg, text: labelText };
}

/** Destroy pooled spacing-overlay objects. Called from selectionOverlay cleanup.
 *  Without this, the parent containers' destroy({ children: true }) can destroy
 *  pooled objects while module-level refs still point at them — a later remount
 *  would then reuse destroyed objects. */
export function cleanupSpacingPool(): void {
  spacingGfx?.removeFromParent();
  labelGroup?.removeFromParent();
  if (spacingGfx && !spacingGfx.destroyed) spacingGfx.destroy();
  if (labelGroup && !labelGroup.destroyed) labelGroup.destroy({ children: true });
  spacingGfx = null;
  labelGroup = null;
  labelBg = null;
  labelText = null;
}

export function redrawHover(
  hovOutline: Graphics,
  childOutlines: Graphics,
  hoverTextBaselines: Graphics,
  spacingOverlay: Container,
  spacingLabel: Container,
  helpers: OverlayHelpers,
): void {
  hovOutline.clear();
  hoverTextBaselines.clear();
  childOutlines.clear();

  // Detach pooled objects (don't destroy — they're reused)
  if (spacingGfx?.parent) spacingGfx.removeFromParent();
  if (labelGroup?.parent) labelGroup.removeFromParent();
  spacingGfx?.clear();
  labelBg?.clear();
  if (labelGroup) labelGroup.visible = false;

  const { hoveredNodeId, hoveredInstanceId, hoveredDescendantPath } =
    useHoverStore.getState();
  const { selectedIds, instanceContext } = useSelectionStore.getState();

  // Instance descendant hover
  if (hoveredDescendantPath && hoveredInstanceId) {
    if (
      instanceContext &&
      instanceContext.instanceId === hoveredInstanceId &&
      instanceContext.descendantPath === hoveredDescendantPath
    ) {
      return;
    }

    const target = helpers.getInstanceDescendantTarget(
      hoveredInstanceId,
      hoveredDescendantPath,
    );
    if (!target) return;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;
    hovOutline.rect(
      target.drawRect.x,
      target.drawRect.y,
      target.drawRect.width,
      target.drawRect.height,
    );
    hovOutline.stroke({ color: COMPONENT_SELECTION_COLOR, width: strokeWidth });

    if (target.node.type === "text") {
      drawTextBaselines(
        hoverTextBaselines,
        target.node as TextNode,
        target.drawRect.x,
        target.drawRect.y,
        target.drawRect.width,
        scale,
        COMPONENT_SELECTION_COLOR,
      );
    }
    return;
  }

  const state = useSceneStore.getState();
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedFrameId =
    useDevModeStore.getState().active && selectedId && state.nodesById[selectedId]?.type === "frame"
      ? selectedId
      : null;
  const selectedTargetId =
    hoveredNodeId && selectedIds.includes(hoveredNodeId) ? hoveredNodeId : selectedFrameId;

  // A selected frame's auto-layout spacing is persistent in Dev Mode. Outside
  // Dev Mode, keep the existing hover-only behaviour.
  if (selectedTargetId) {
    const children = state.childrenById[selectedTargetId];
    const scale = useViewportStore.getState().scale;

    // Precompute child rects (used by both dashed outlines and spacing overlays)
    const childRectMap = new Map<string, Rect>();
    if (children && children.length > 0) {
      const color = helpers.getSelectionColor(selectedTargetId);
      for (const childId of children) {
        const childNode = state.nodesById[childId];
        if (!childNode || childNode.visible === false) continue;
        const childRect = helpers.getNodeDrawRect(childId);
        if (!childRect) continue;
        childRectMap.set(childId, childRect);
        drawDashedRect(childOutlines, childRect, color, scale);
      }
    }

    // Draw padding & gap overlays for auto-layout frames
    const node = state.nodesById[selectedTargetId];
    if (node?.type === "frame") {
      const frameNode = node as FlatFrameNode;
      if (frameNode.layout?.autoLayout) {
        const parentRect = helpers.getNodeDrawRect(selectedTargetId);
        if (parentRect) {
          drawSpacingOverlays(spacingOverlay, spacingLabel, frameNode, parentRect, children ?? [], state, childRectMap, scale);
        }
      }
    }
    return;
  }

  if (!hoveredNodeId) return;

  // Regular hover outline
  const node = useSceneStore.getState().nodesById[hoveredNodeId];
  if (!node) return;

  const drawRect = helpers.getNodeDrawRect(hoveredNodeId);
  if (!drawRect) return;

  const scale = useViewportStore.getState().scale;
  const hoverColor = helpers.isInComponentContext(hoveredNodeId)
    ? COMPONENT_SELECTION_COLOR
    : HOVER_COLOR;
  hovOutline.rect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  hovOutline.stroke({ color: hoverColor, width: 1 / scale });

  if (node.type === "text") {
    const hoverBaselineColor = helpers.isInComponentContext(hoveredNodeId)
      ? COMPONENT_SELECTION_COLOR
      : TEXT_BASELINE_COLOR;
    drawTextBaselines(
      hoverTextBaselines,
      node as TextNode,
      drawRect.x,
      drawRect.y,
      drawRect.width,
      scale,
      hoverBaselineColor,
    );
  }
}

interface SpacingArea {
  rect: Rect;
  value: number;
  color: number;
  alpha: number;
  /** Orientation of the indicator line: "horizontal" or "vertical" */
  orientation: "horizontal" | "vertical";
}

function drawSpacingOverlays(
  container: Container,
  labelContainer: Container,
  frameNode: FlatFrameNode,
  parentRect: Rect,
  childIds: string[],
  state: ReturnType<typeof useSceneStore.getState>,
  childRectMap: Map<string, Rect>,
  scale: number,
): void {
  const layout = frameNode.layout!;
  const pt = layout.paddingTop ?? 0;
  const pr = layout.paddingRight ?? 0;
  const pb = layout.paddingBottom ?? 0;
  const pl = layout.paddingLeft ?? 0;
  const { x, y, width: w, height: h } = parentRect;

  const areas: SpacingArea[] = [];

  // Padding areas
  if (pt > 0) {
    areas.push({ rect: { x, y, width: w, height: pt }, value: pt, color: SELECTION_COLOR, alpha: PADDING_OVERLAY_ALPHA, orientation: "horizontal" });
  }
  if (pb > 0) {
    areas.push({ rect: { x, y: y + h - pb, width: w, height: pb }, value: pb, color: SELECTION_COLOR, alpha: PADDING_OVERLAY_ALPHA, orientation: "horizontal" });
  }
  if (pl > 0) {
    areas.push({ rect: { x, y: y + pt, width: pl, height: h - pt - pb }, value: pl, color: SELECTION_COLOR, alpha: PADDING_OVERLAY_ALPHA, orientation: "vertical" });
  }
  if (pr > 0) {
    areas.push({ rect: { x: x + w - pr, y: y + pt, width: pr, height: h - pt - pb }, value: pr, color: SELECTION_COLOR, alpha: PADDING_OVERLAY_ALPHA, orientation: "vertical" });
  }

  // Gap areas
  const gap = layout.gap ?? 0;
  if (gap > 0 && childIds.length >= 2) {
    const isRow = layout.flexDirection === "row";

    // Collect visible, non-absolute child rects from precomputed map
    const flowChildRects: Rect[] = [];
    for (const childId of childIds) {
      const childNode = state.nodesById[childId];
      if (!childNode || childNode.visible === false || childNode.absolutePosition) continue;
      const rect = childRectMap.get(childId);
      if (rect) flowChildRects.push(rect);
    }

    flowChildRects.sort((a, b) => isRow ? a.x - b.x : a.y - b.y);

    const contentX = x + pl;
    const contentY = y + pt;
    const contentW = w - pl - pr;
    const contentH = h - pt - pb;

    for (let i = 0; i < flowChildRects.length - 1; i++) {
      const cur = flowChildRects[i];
      const next = flowChildRects[i + 1];

      if (isRow) {
        const gapX = cur.x + cur.width;
        const gapW = next.x - gapX;
        if (gapW <= 0) continue;
        areas.push({ rect: { x: gapX, y: contentY, width: gapW, height: contentH }, value: gap, color: GAP_COLOR, alpha: GAP_OVERLAY_ALPHA, orientation: "vertical" });
      } else {
        const gapY = cur.y + cur.height;
        const gapH = next.y - gapY;
        if (gapH <= 0) continue;
        areas.push({ rect: { x: contentX, y: gapY, width: contentW, height: gapH }, value: gap, color: GAP_COLOR, alpha: GAP_OVERLAY_ALPHA, orientation: "horizontal" });
      }
    }
  }

  if (areas.length === 0) return;

  const pool = ensureSpacingPool();
  const gfx = pool.gfx;
  container.addChild(gfx);

  const invScale = 1 / scale;
  const lineLen = INDICATOR_LINE_LENGTH / scale;
  const lineWidth = 1 / scale;

  for (const area of areas) {
    drawHatchedRect(gfx, area.rect, area.color, scale, area.alpha);

    // Center indicator line
    const cx = area.rect.x + area.rect.width / 2;
    const cy = area.rect.y + area.rect.height / 2;

    if (area.orientation === "horizontal") {
      gfx.moveTo(cx - lineLen / 2, cy);
      gfx.lineTo(cx + lineLen / 2, cy);
    } else {
      gfx.moveTo(cx, cy - lineLen / 2);
      gfx.lineTo(cx, cy + lineLen / 2);
    }
    gfx.stroke({ color: area.color, width: lineWidth });
  }

  // Show label only when hovering near the center indicator line
  const mx = worldMouse.x;
  const my = worldMouse.y;
  const hitRadius = 4 / scale;
  const hoveredArea = areas.find(a => {
    const cx = a.rect.x + a.rect.width / 2;
    const cy = a.rect.y + a.rect.height / 2;
    const halfLen = lineLen / 2;
    if (a.orientation === "horizontal") {
      return Math.abs(my - cy) <= hitRadius && mx >= cx - halfLen - hitRadius && mx <= cx + halfLen + hitRadius;
    } else {
      return Math.abs(mx - cx) <= hitRadius && my >= cy - halfLen - hitRadius && my <= cy + halfLen + hitRadius;
    }
  });
  if (!hoveredArea) return;

  const cursorOffsetX = 4;
  const cursorOffsetY = -4;

  pool.group.visible = true;
  pool.group.position.set(mx, my);
  pool.group.scale.set(invScale);

  pool.text.text = String(Math.round(hoveredArea.value));
  const bgWidth = pool.text.width + FLOATING_LABEL_PADDING_X * 2;
  const bgHeight = FLOATING_LABEL_FONT_SIZE + FLOATING_LABEL_PADDING_Y * 2;

  pool.bg.roundRect(cursorOffsetX, cursorOffsetY - bgHeight, bgWidth, bgHeight, FLOATING_LABEL_RADIUS);
  pool.bg.fill(hoveredArea.color);

  pool.text.position.set(cursorOffsetX + FLOATING_LABEL_PADDING_X, cursorOffsetY - bgHeight + FLOATING_LABEL_PADDING_Y);

  labelContainer.addChild(pool.group);
}
