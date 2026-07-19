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
  MEASURE_COLOR,
  PADDING_OVERLAY_ALPHA,
  SELECTION_COLOR,
  TEXT_BASELINE_COLOR,
} from "./constants";

// Pooled PixiJS objects for spacing overlays (avoid create/destroy per frame)
const INDICATOR_LINE_LENGTH = 7;
let spacingGfx: Graphics | null = null;
interface SpacingLabel {
  group: Container;
  bg: Graphics;
  text: Text;
}
const spacingLabels: SpacingLabel[] = [];

function ensureSpacingPool(): Graphics {
  if (!spacingGfx) spacingGfx = new Graphics();
  return spacingGfx;
}

function ensureSpacingLabel(index: number): SpacingLabel {
  const existing = spacingLabels[index];
  if (existing) return existing;

  const group = new Container();
  const bg = new Graphics();
  const text = new Text({ text: "", style: FLOATING_LABEL_STYLE });
  group.addChild(bg, text);
  const label = { group, bg, text };
  spacingLabels.push(label);
  return label;
}

/** Destroy pooled spacing-overlay objects. Called from selectionOverlay cleanup.
 *  Without this, the parent containers' destroy({ children: true }) can destroy
 *  pooled objects while module-level refs still point at them — a later remount
 *  would then reuse destroyed objects. */
export function cleanupSpacingPool(): void {
  spacingGfx?.removeFromParent();
  if (spacingGfx && !spacingGfx.destroyed) spacingGfx.destroy();
  for (const { group } of spacingLabels) {
    group.removeFromParent();
    if (!group.destroyed) group.destroy({ children: true });
  }
  spacingGfx = null;
  spacingLabels.length = 0;
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
  spacingGfx?.clear();
  for (const { group, bg } of spacingLabels) {
    if (group.parent) group.removeFromParent();
    bg.clear();
    group.visible = false;
  }

  const { hoveredNodeId, hoveredInstanceId, hoveredDescendantPath } =
    useHoverStore.getState();
  const { selectedIds, instanceContext } = useSelectionStore.getState();
  const devModeActive = useDevModeStore.getState().active;
  const hasDevModeComparison = devModeActive && selectedIds.length === 1;

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
    const outlineColor = hasDevModeComparison
      ? MEASURE_COLOR
      : COMPONENT_SELECTION_COLOR;
    hovOutline.stroke({ color: outlineColor, width: strokeWidth });

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
  const hoveredFrameId =
    devModeActive && hoveredNodeId && state.nodesById[hoveredNodeId]?.type === "frame"
      ? hoveredNodeId
      : null;
  const selectedFrameId =
    devModeActive && selectedId && state.nodesById[selectedId]?.type === "frame"
      ? selectedId
      : null;
  const selectedTargetId =
    hoveredFrameId ??
    (hoveredNodeId && selectedIds.includes(hoveredNodeId) ? hoveredNodeId : selectedFrameId);

  // In Dev Mode, a hovered auto-layout frame takes priority so its spacing is
  // inspectable without selecting it. With no hovered frame, keep the selected
  // frame's spacing persistent. Outside Dev Mode, preserve the existing
  // selected-node hover behaviour.
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
    // A hovered node different from the current selection still needs its own
    // guide-colored outline. Fall through after drawing spacing; only a hover
    // on the selected node (or no hover) should be absorbed by this branch.
    if (!hoveredNodeId || selectedIds.includes(hoveredNodeId)) return;
  }

  if (!hoveredNodeId) return;

  // Regular hover outline
  const node = useSceneStore.getState().nodesById[hoveredNodeId];
  if (!node) return;

  const drawRect = helpers.getNodeDrawRect(hoveredNodeId);
  if (!drawRect) return;

  const scale = useViewportStore.getState().scale;
  const hoverColor = hasDevModeComparison
    ? MEASURE_COLOR
    : helpers.isInComponentContext(hoveredNodeId)
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

  const gfx = ensureSpacingPool();
  container.addChild(gfx);

  const invScale = 1 / scale;
  const showPersistentLabels = useDevModeStore.getState().active;

  for (const area of areas) {
    drawHatchedRect(gfx, area.rect, area.color, scale, area.alpha);
  }

  if (showPersistentLabels) {
    for (const [index, area] of areas.entries()) {
      // Keep every spacing value visible in Dev Mode, instead of showing an
      // indicator line that only reveals its value after hover.
      const cx = area.rect.x + area.rect.width / 2;
      const cy = area.rect.y + area.rect.height / 2;
      const label = ensureSpacingLabel(index);
      label.group.visible = true;
      label.group.position.set(cx, cy);
      label.group.scale.set(invScale);

      label.text.text = String(Math.round(area.value));
      const bgWidth = label.text.width + FLOATING_LABEL_PADDING_X * 2;
      const bgHeight = FLOATING_LABEL_FONT_SIZE + FLOATING_LABEL_PADDING_Y * 2;

      label.bg.roundRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, FLOATING_LABEL_RADIUS);
      label.bg.fill(area.color);
      label.text.position.set(-label.text.width / 2, -FLOATING_LABEL_FONT_SIZE / 2);
      labelContainer.addChild(label.group);
    }
    return;
  }

  const lineLen = INDICATOR_LINE_LENGTH / scale;
  const lineWidth = 1 / scale;
  for (const area of areas) {
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

  const mx = worldMouse.x;
  const my = worldMouse.y;
  const hitRadius = 4 / scale;
  const hoveredArea = areas.find((area) => {
    const cx = area.rect.x + area.rect.width / 2;
    const cy = area.rect.y + area.rect.height / 2;
    const halfLen = lineLen / 2;
    return area.orientation === "horizontal"
      ? Math.abs(my - cy) <= hitRadius && mx >= cx - halfLen - hitRadius && mx <= cx + halfLen + hitRadius
      : Math.abs(mx - cx) <= hitRadius && my >= cy - halfLen - hitRadius && my <= cy + halfLen + hitRadius;
  });
  if (!hoveredArea) return;

  const label = ensureSpacingLabel(0);
  label.group.visible = true;
  label.group.position.set(mx, my);
  label.group.scale.set(invScale);
  label.text.text = String(Math.round(hoveredArea.value));
  const bgWidth = label.text.width + FLOATING_LABEL_PADDING_X * 2;
  const bgHeight = FLOATING_LABEL_FONT_SIZE + FLOATING_LABEL_PADDING_Y * 2;

  label.bg.roundRect(4, -4 - bgHeight, bgWidth, bgHeight, FLOATING_LABEL_RADIUS);
  label.bg.fill(hoveredArea.color);
  label.text.position.set(4 + FLOATING_LABEL_PADDING_X, -4 - bgHeight + FLOATING_LABEL_PADDING_Y);
  labelContainer.addChild(label.group);
}
