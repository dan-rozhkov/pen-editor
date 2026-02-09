import { Container, Graphics } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  FlatGroupNode,
  TextNode,
  RectNode,
  EllipseNode,
  LineNode,
  PolygonNode,
  PathNode,
  RefNode,
} from "@/types/scene";
import { applyShadow } from "./shadowHelpers";
import { createRectContainer, updateRectContainer, drawRect } from "./rectRenderer";
import { createEllipseContainer, updateEllipseContainer, drawEllipse } from "./ellipseRenderer";
import { createTextContainer, updateTextContainer } from "./textRenderer";
import { createLineContainer, updateLineContainer } from "./lineRenderer";
import { createPolygonContainer, updatePolygonContainer } from "./polygonRenderer";
import { createPathContainer, updatePathContainer } from "./pathRenderer";
import { createFrameContainer, updateFrameContainer, drawFrameBackground } from "./frameRenderer";
import { createGroupContainer } from "./groupRenderer";
import { createRefContainer, updateRefContainer } from "./refRenderer";

/**
 * Create a PixiJS Container for a given flat scene node.
 * This is the main dispatch function.
 */
export function createNodeContainer(
  node: FlatSceneNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  let container: Container;

  switch (node.type) {
    case "frame":
      container = createFrameContainer(
        node as FlatFrameNode,
        nodesById,
        childrenById,
      );
      break;
    case "group":
      container = createGroupContainer(
        node as FlatGroupNode,
        nodesById,
        childrenById,
      );
      break;
    case "rect":
      container = createRectContainer(node as RectNode);
      break;
    case "ellipse":
      container = createEllipseContainer(node as EllipseNode);
      break;
    case "text":
      container = createTextContainer(node as TextNode);
      break;
    case "line":
      container = createLineContainer(node as LineNode);
      break;
    case "polygon":
      container = createPolygonContainer(node as PolygonNode);
      break;
    case "path":
      container = createPathContainer(node as PathNode);
      break;
    case "ref":
      container = createRefContainer(
        node as RefNode,
        nodesById,
        childrenById,
      );
      break;
    default:
      container = new Container();
  }

  // Common properties
  container.label = node.id;
  // Position will be set by applyAutoLayoutPositions for auto-layout children
  // For now, set it from node (will be overwritten if in auto-layout)
  container.position.set(node.x, node.y);
  container.alpha = node.opacity ?? 1;
  container.visible = node.visible !== false;

  // Rotation (convert degrees to radians)
  if (node.rotation) {
    container.rotation = (node.rotation * Math.PI) / 180;
  }

  // Flip via scale
  if (node.flipX || node.flipY) {
    container.scale.set(node.flipX ? -1 : 1, node.flipY ? -1 : 1);
    if (node.flipX) container.pivot.x = node.width;
    if (node.flipY) container.pivot.y = node.height;
  }

  // Shadow
  applyShadow(container, node.effect, node.width, node.height);

  return container;
}

/**
 * Update an existing container when the node changes.
 */
export function updateNodeContainer(
  container: Container,
  node: FlatSceneNode,
  prev: FlatSceneNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  skipPosition?: boolean,
): void {
  // Position - skip for auto-layout children (handled by applyAutoLayoutPositions)
  if (!skipPosition && (node.x !== prev.x || node.y !== prev.y)) {
    container.position.set(node.x, node.y);
  }

  // Opacity
  if (node.opacity !== prev.opacity) {
    container.alpha = node.opacity ?? 1;
  }

  // Visibility
  if (node.visible !== prev.visible) {
    container.visible = node.visible !== false;
  }

  // Rotation
  if (node.rotation !== prev.rotation) {
    container.rotation = ((node.rotation ?? 0) * Math.PI) / 180;
  }

  // Flip
  if (node.flipX !== prev.flipX || node.flipY !== prev.flipY) {
    container.scale.set(node.flipX ? -1 : 1, node.flipY ? -1 : 1);
    container.pivot.x = node.flipX ? node.width : 0;
    container.pivot.y = node.flipY ? node.height : 0;
  }

  // Shadow
  if (node.effect !== prev.effect || node.width !== prev.width || node.height !== prev.height) {
    applyShadow(container, node.effect, node.width, node.height);
  }

  // Type-specific updates
  switch (node.type) {
    case "frame":
      updateFrameContainer(
        container,
        node as FlatFrameNode,
        prev as FlatFrameNode,
        nodesById,
        childrenById,
      );
      break;
    case "group":
      // Group just needs position/visibility which is handled above
      break;
    case "rect":
      updateRectContainer(container, node as RectNode, prev as RectNode);
      break;
    case "ellipse":
      updateEllipseContainer(
        container,
        node as EllipseNode,
        prev as EllipseNode,
      );
      break;
    case "text":
      updateTextContainer(container, node as TextNode, prev as TextNode);
      break;
    case "line":
      updateLineContainer(container, node as LineNode, prev as LineNode);
      break;
    case "polygon":
      updatePolygonContainer(
        container,
        node as PolygonNode,
        prev as PolygonNode,
      );
      break;
    case "path":
      updatePathContainer(container, node as PathNode, prev as PathNode);
      break;
    case "ref":
      updateRefContainer(
        container,
        node as RefNode,
        prev as RefNode,
        nodesById,
        childrenById,
      );
      break;
  }
}

/**
 * Apply layout-computed size to a container's graphics.
 * Used for fill_container children in auto-layout frames.
 */
export function applyLayoutSize(
  container: Container,
  node: FlatSceneNode,
  layoutWidth: number,
  layoutHeight: number,
): void {
  // Skip if size hasn't changed
  if (node.width === layoutWidth && node.height === layoutHeight) return;

  switch (node.type) {
    case "rect": {
      const gfx = container.getChildByLabel("rect-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawRect(gfx, { ...node, width: layoutWidth, height: layoutHeight } as RectNode);
      }
      break;
    }
    case "ellipse": {
      const gfx = container.getChildByLabel("ellipse-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawEllipse(gfx, { ...node, width: layoutWidth, height: layoutHeight } as EllipseNode);
      }
      break;
    }
    case "frame": {
      const bg = container.getChildByLabel("frame-bg") as Graphics;
      if (bg) {
        bg.clear();
        drawFrameBackground(bg, node as FlatFrameNode, layoutWidth, layoutHeight);
      }
      // Update mask if present
      const mask = container.getChildByLabel("frame-mask") as Graphics;
      if (mask && (node as FlatFrameNode).clip) {
        mask.clear();
        const frameNode = node as FlatFrameNode;
        if (frameNode.cornerRadius) {
          mask.roundRect(0, 0, layoutWidth, layoutHeight, frameNode.cornerRadius);
        } else {
          mask.rect(0, 0, layoutWidth, layoutHeight);
        }
        mask.fill(0xffffff);
      }
      break;
    }
    // Text and other types don't need size updates for layout
  }
}
