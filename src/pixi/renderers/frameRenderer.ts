import { Container, Graphics } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  FrameNode,
  SceneNode,
} from "@/types/scene";
import { materializeLayoutRefs } from "@/utils/layoutRefUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { applyFill, applyStroke, hasVisualPropsChanged, drawRoundedShape } from "./fillStrokeHelpers";
import { applyImageFill } from "./imageFillHelpers";
import { pushRenderTheme, popRenderTheme } from "./colorHelpers";
import { createNodeContainer, isInsideRef } from "./index";
import { drawLayoutGrids } from "./layoutGridRenderer";

/**
 * Convert flat frame to tree frame for layout calculations
 */
export function flatToTreeFrame(
  node: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): FrameNode {
  const childIds = childrenById[node.id] ?? [];
  const children: SceneNode[] = [];

  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (!childNode) continue;

    if (childNode.type === "frame") {
      children.push(flatToTreeFrame(childNode as FlatFrameNode, nodesById, childrenById));
    } else {
      children.push(childNode as SceneNode);
    }
  }

  return { ...node, children } as FrameNode;
}

/**
 * Calculate effective width/height for frames with fit_content sizing
 */
export function getFrameEffectiveSize(
  node: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): { width: number; height: number } {
  const fitWidth = node.sizing?.widthMode === "fit_content" && node.layout?.autoLayout;
  const fitHeight = node.sizing?.heightMode === "fit_content" && node.layout?.autoLayout;

  if (!fitWidth && !fitHeight) {
    return { width: node.width, height: node.height };
  }

  const treeFrame = flatToTreeFrame(node, nodesById, childrenById);
  const layoutFrame = materializeLayoutRefs(treeFrame, nodesById, childrenById);
  const intrinsicSize = calculateFrameIntrinsicSize(layoutFrame, { fitWidth, fitHeight });

  // When clip is enabled, keep the frame's explicit bounds authoritative for
  // clipping instead of expanding to fit overflowing content.
  const width = fitWidth
    ? (node.clip ? Math.min(intrinsicSize.width, node.width) : intrinsicSize.width)
    : node.width;
  const height = fitHeight
    ? (node.clip ? Math.min(intrinsicSize.height, node.height) : intrinsicSize.height)
    : node.height;

  return {
    width,
    height,
  };
}

export function createFrameContainer(
  node: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const container = new Container();

  // Calculate effective size for fit_content frames
  const { width: effectiveWidth, height: effectiveHeight } = getFrameEffectiveSize(node, nodesById, childrenById);

  // Store effective size for later use
  (container as any)._effectiveWidth = effectiveWidth;
  (container as any)._effectiveHeight = effectiveHeight;

  // Background
  const bg = new Graphics();
  bg.label = "frame-bg";
  drawFrameBackground(bg, node, effectiveWidth, effectiveHeight);
  container.addChild(bg);

  // Slot indicator (pink overlay — only in component definition, not in instances)
  if (node.isSlot && !isInsideRef()) {
    const slotGfx = new Graphics();
    slotGfx.label = "frame-slot-indicator";
    drawSlotIndicator(slotGfx, effectiveWidth, effectiveHeight);
    container.addChild(slotGfx);
  }

  // Image fill
  if (node.imageFill) {
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius, node.cornerRadiusPerCorner);
  }

  // Clipping mask
  if (node.clip) {
    const mask = new Graphics();
    mask.label = "frame-mask";
    drawRoundedShape(mask, effectiveWidth, effectiveHeight, node.cornerRadius, node.cornerRadiusPerCorner);
    mask.fill(0xffffff);
    container.addChild(mask);
    container.mask = mask;
  }

  // Children container
  const childrenContainer = new Container();
  childrenContainer.label = "frame-children";
  container.addChild(childrenContainer);

  // If this frame overrides the theme, push it for children
  if (node.themeOverride) {
    pushRenderTheme(node.themeOverride);
  }
  try {
    // Render children
    const childIds = childrenById[node.id] ?? [];
    for (const childId of childIds) {
      const childNode = nodesById[childId];
      if (childNode) {
        const childContainer = createNodeContainer(
          childNode,
          nodesById,
          childrenById,
        );
        childrenContainer.addChild(childContainer);
      }
    }
  } finally {
    if (node.themeOverride) {
      popRenderTheme();
    }
  }

  // Layout grid overlay (rendered above children)
  if (node.layoutGrids?.length) {
    const gridGfx = new Graphics();
    gridGfx.label = "frame-layout-grid";
    drawLayoutGrids(gridGfx, node.layoutGrids, effectiveWidth, effectiveHeight);
    container.addChild(gridGfx);
  }

  // Disabled for now: cacheAsTexture can leave stale visual artifacts
  // after structural reparent/move operations (ghost copies on canvas).
  container.cacheAsTexture(false);

  return container;
}

export function updateFrameContainer(
  container: Container,
  node: FlatFrameNode,
  prev: FlatFrameNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): void {
  // Calculate effective size for fit_content frames
  const { width: effectiveWidth, height: effectiveHeight } = getFrameEffectiveSize(node, nodesById, childrenById);

  // Store effective size for later use
  (container as any)._effectiveWidth = effectiveWidth;
  (container as any)._effectiveHeight = effectiveHeight;

  // Update background
  if (
    hasVisualPropsChanged(node, prev) ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    const bg = container.getChildByLabel("frame-bg") as Graphics;
    if (bg) {
      bg.clear();
      drawFrameBackground(bg, node, effectiveWidth, effectiveHeight);
    }
  }

  // Image fill
  if (
    node.imageFill !== prev.imageFill ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout ||
    node.cornerRadius !== prev.cornerRadius ||
    node.cornerRadiusPerCorner !== prev.cornerRadiusPerCorner
  ) {
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius, node.cornerRadiusPerCorner);
  }

  // Update layout grid overlay
  if (
    node.layoutGrids !== prev.layoutGrids ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    const existingGrid = container.getChildByLabel("frame-layout-grid") as Graphics;
    if (node.layoutGrids?.length) {
      const gridGfx = existingGrid ?? new Graphics();
      gridGfx.label = "frame-layout-grid";
      gridGfx.clear();
      drawLayoutGrids(gridGfx, node.layoutGrids, effectiveWidth, effectiveHeight);
      if (!existingGrid) {
        container.addChild(gridGfx);
      }
    } else if (existingGrid) {
      container.removeChild(existingGrid);
      existingGrid.destroy();
    }
  }

  // Update slot indicator
  if (node.isSlot !== prev.isSlot || node.width !== prev.width || node.height !== prev.height) {
    const existingSlot = container.getChildByLabel("frame-slot-indicator") as Graphics;
    if (node.isSlot && !isInsideRef()) {
      const slotGfx = existingSlot ?? new Graphics();
      slotGfx.label = "frame-slot-indicator";
      slotGfx.clear();
      drawSlotIndicator(slotGfx, effectiveWidth, effectiveHeight);
      if (!existingSlot) {
        // Insert after background
        const bgIndex = container.children.indexOf(container.getChildByLabel("frame-bg")!);
        container.addChildAt(slotGfx, bgIndex + 1);
      }
    } else if (existingSlot) {
      container.removeChild(existingSlot);
      existingSlot.destroy();
    }
  }

  // Update clip mask
  if (
    node.clip !== prev.clip ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.cornerRadius !== prev.cornerRadius ||
    node.cornerRadiusPerCorner !== prev.cornerRadiusPerCorner ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    const existingMask = container.getChildByLabel("frame-mask") as Graphics;
    if (node.clip) {
      const mask = existingMask ?? new Graphics();
      mask.label = "frame-mask";
      mask.clear();
      drawRoundedShape(mask, effectiveWidth, effectiveHeight, node.cornerRadius, node.cornerRadiusPerCorner);
      mask.fill(0xffffff);
      if (!existingMask) {
        container.addChild(mask);
      }
      container.mask = mask;
    } else if (existingMask) {
      container.mask = null;
      container.removeChild(existingMask);
      existingMask.destroy();
    }
  }
}

function drawSlotIndicator(gfx: Graphics, width: number, height: number): void {
  const pink = 0xEC4899;
  // Semi-transparent pink fill
  gfx.rect(0, 0, width, height);
  gfx.fill({ color: pink, alpha: 0.15 });

  // Pink dashed border — build entire path, stroke once
  const dashLen = 6;
  const gapLen = 4;
  addDashedLineSegments(gfx, 0, 0, width, 0, dashLen, gapLen);
  addDashedLineSegments(gfx, width, 0, width, height, dashLen, gapLen);
  addDashedLineSegments(gfx, width, height, 0, height, dashLen, gapLen);
  addDashedLineSegments(gfx, 0, height, 0, 0, dashLen, gapLen);
  gfx.stroke({ width: 1, color: pink, alpha: 0.6 });

  // Rounded pink square with "+" icon centered
  const boxSize = Math.min(24, width * 0.5, height * 0.5);
  if (boxSize >= 8) {
    const cx = width / 2;
    const cy = height / 2;
    const halfBox = boxSize / 2;
    const radius = Math.min(4, boxSize * 0.2);
    gfx.roundRect(cx - halfBox, cy - halfBox, boxSize, boxSize, radius);
    gfx.fill({ color: 0xff44b4 });

    const plusHalf = boxSize * 0.3;
    gfx.moveTo(cx - plusHalf, cy);
    gfx.lineTo(cx + plusHalf, cy);
    gfx.moveTo(cx, cy - plusHalf);
    gfx.lineTo(cx, cy + plusHalf);
    gfx.stroke({ width: 1.5, color: 0xffffff });
  }
}

function addDashedLineSegments(
  gfx: Graphics,
  x1: number, y1: number,
  x2: number, y2: number,
  dashLen: number, gapLen: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return;
  const nx = dx / length;
  const ny = dy / length;
  let dist = 0;
  let drawing = true;
  while (dist < length) {
    const segLen = drawing ? dashLen : gapLen;
    const end = Math.min(dist + segLen, length);
    if (drawing) {
      gfx.moveTo(x1 + nx * dist, y1 + ny * dist);
      gfx.lineTo(x1 + nx * end, y1 + ny * end);
    }
    dist = end;
    drawing = !drawing;
  }
}

export function drawFrameBackground(
  gfx: Graphics,
  node: FlatFrameNode,
  effectiveWidth?: number,
  effectiveHeight?: number,
): void {
  const width = effectiveWidth ?? node.width;
  const height = effectiveHeight ?? node.height;

  drawRoundedShape(gfx, width, height, node.cornerRadius, node.cornerRadiusPerCorner);

  applyFill(gfx, node, width, height);
  applyStroke(gfx, node, width, height);
}
