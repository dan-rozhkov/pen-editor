import { Container, Graphics } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  FrameNode,
  SceneNode,
} from "@/types/scene";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { applyFill, applyStroke, hasVisualPropsChanged } from "./fillStrokeHelpers";
import { applyImageFill } from "./imageFillHelpers";
import { pushRenderTheme, popRenderTheme } from "./colorHelpers";
import { createNodeContainer } from "./index";

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
  const intrinsicSize = calculateFrameIntrinsicSize(treeFrame, { fitWidth, fitHeight });

  return {
    width: fitWidth ? intrinsicSize.width : node.width,
    height: fitHeight ? intrinsicSize.height : node.height,
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

  // Image fill
  if (node.imageFill) {
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius);
  }

  // Clipping mask
  if (node.clip) {
    const mask = new Graphics();
    mask.label = "frame-mask";
    if (node.cornerRadius) {
      mask.roundRect(0, 0, effectiveWidth, effectiveHeight, node.cornerRadius);
    } else {
      mask.rect(0, 0, effectiveWidth, effectiveHeight);
    }
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
    node.layout !== prev.layout
  ) {
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius);
  }

  // Update clip mask
  if (
    node.clip !== prev.clip ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    node.cornerRadius !== prev.cornerRadius ||
    node.sizing !== prev.sizing ||
    node.layout !== prev.layout
  ) {
    const existingMask = container.getChildByLabel("frame-mask") as Graphics;
    if (node.clip) {
      const mask = existingMask ?? new Graphics();
      mask.label = "frame-mask";
      mask.clear();
      if (node.cornerRadius) {
        mask.roundRect(0, 0, effectiveWidth, effectiveHeight, node.cornerRadius);
      } else {
        mask.rect(0, 0, effectiveWidth, effectiveHeight);
      }
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

export function drawFrameBackground(
  gfx: Graphics,
  node: FlatFrameNode,
  effectiveWidth?: number,
  effectiveHeight?: number,
): void {
  const width = effectiveWidth ?? node.width;
  const height = effectiveHeight ?? node.height;

  if (node.cornerRadius) {
    gfx.roundRect(0, 0, width, height, node.cornerRadius);
  } else {
    gfx.rect(0, 0, width, height);
  }

  applyFill(gfx, node, width, height);
  applyStroke(gfx, node, width, height);
}
