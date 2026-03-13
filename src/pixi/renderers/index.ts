import { Container, Graphics } from "pixi.js";
import type {
  FlatSceneNode,
  FlatFrameNode,
  FlatGroupNode,
  SceneNode,
  TextNode,
  RectNode,
  EllipseNode,
  LineNode,
  PolygonNode,
  PathNode,
  EmbedNode,
  RefNode,
  PerCornerRadius,
} from "@/types/scene";
import { toFlatNode } from "@/types/scene";
import { applyShadow } from "./shadowHelpers";
import { createRectContainer, updateRectContainer, drawRect } from "./rectRenderer";
import { createEllipseContainer, updateEllipseContainer, drawEllipse } from "./ellipseRenderer";
import { createTextContainer, updateTextContainer } from "./textRenderer";
import { createLineContainer, updateLineContainer } from "./lineRenderer";
import { createPolygonContainer, updatePolygonContainer } from "./polygonRenderer";
import { createPathContainer, updatePathContainer } from "./pathRenderer";
import { createFrameContainer, updateFrameContainer, drawFrameBackground } from "./frameRenderer";
import { drawRoundedShape } from "./fillStrokeHelpers";
import { createGroupContainer } from "./groupRenderer";
import { createEmbedContainer, updateEmbedContainer } from "./embedRenderer";
import type { ShadowShape } from "./shadowHelpers";
import { getResolvedSnapshotForRef } from "@/utils/instanceRuntime";
import type { ResolvedInstanceSnapshot } from "@/utils/instanceSnapshotCache";
import { pushRenderTheme, popRenderTheme } from "./colorHelpers";

type InstanceRenderContainer = Container & {
  _instancePath?: string;
  _instanceSnapshot?: ResolvedInstanceSnapshot;
};

function getNodeCornerRadius(node: FlatSceneNode): number | undefined {
  if (node.type === "frame" || node.type === "rect") {
    return node.cornerRadius;
  }
  return undefined;
}

function getNodeCornerRadiusPerCorner(node: FlatSceneNode): PerCornerRadius | undefined {
  if (node.type === "frame" || node.type === "rect") {
    return node.cornerRadiusPerCorner;
  }
  return undefined;
}

function getNodeShadowShape(node: FlatSceneNode): ShadowShape {
  if (node.type === "ellipse") return "ellipse";
  return "rect";
}

function getNodeShadowSize(node: FlatSceneNode, container: Container): { width: number; height: number } {
  if (node.type === "frame") {
    const effectiveWidth = (container as unknown as { _effectiveWidth?: number })._effectiveWidth;
    const effectiveHeight = (container as unknown as { _effectiveHeight?: number })._effectiveHeight;
    return {
      width: effectiveWidth ?? node.width,
      height: effectiveHeight ?? node.height,
    };
  }
  return { width: node.width, height: node.height };
}

function getSnappedNodePosition(node: FlatSceneNode): { x: number; y: number } {
  if (node.type !== "embed") return { x: node.x, y: node.y };
  return { x: Math.round(node.x), y: Math.round(node.y) };
}

function getChildrenHost(container: Container): Container | null {
  return (
    (container.getChildByLabel("frame-children") as Container | null) ??
    (container.getChildByLabel("group-children") as Container | null)
  );
}

function deriveParentById(
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Record<string, string | null> {
  const parentById: Record<string, string | null> = {};
  for (const id of Object.keys(nodesById)) {
    parentById[id] = null;
  }
  for (const [parentId, childIds] of Object.entries(childrenById)) {
    for (const childId of childIds) {
      parentById[childId] = parentId;
    }
  }
  return parentById;
}

function withSnapshotAncestorThemes(
  snapshot: ResolvedInstanceSnapshot,
  path: string,
  fn: () => void,
): void {
  const themes: Array<"light" | "dark"> = [];
  const pushTheme = (node: SceneNode | undefined): void => {
    if (node?.type === "frame" && node.themeOverride) {
      themes.push(node.themeOverride);
      pushRenderTheme(node.themeOverride);
    }
  };

  const segments = path.split("/").filter(Boolean);
  pushTheme(snapshot.tree);
  if (segments.length === 0) {
    try {
      fn();
    } finally {
      while (themes.length > 0) {
        themes.pop();
        popRenderTheme();
      }
    }
    return;
  }

  let currentPath = "";
  for (let i = 0; i < segments.length - 1; i++) {
    currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];
    pushTheme(snapshot.nodesByPath[currentPath]);
  }

  try {
    fn();
  } finally {
    while (themes.length > 0) {
      themes.pop();
      popRenderTheme();
    }
  }
}

function annotateSnapshotPaths(
  container: Container,
  snapshot: ResolvedInstanceSnapshot,
  path = "",
): void {
  const instanceContainer = container as InstanceRenderContainer;
  instanceContainer._instancePath = path;
  if (path === "") {
    instanceContainer._instanceSnapshot = snapshot;
  }

  const host = getChildrenHost(container);
  if (!host) return;
  const childPaths = snapshot.childrenByPath[path] ?? [];
  for (let i = 0; i < childPaths.length; i++) {
    const childContainer = host.children[i] as Container | undefined;
    if (!childContainer) continue;
    annotateSnapshotPaths(childContainer, snapshot, childPaths[i]);
  }
}

function createSnapshotSubtreeContainer(
  snapshot: ResolvedInstanceSnapshot,
  path: string,
): Container {
  const node = path === "" ? snapshot.tree : snapshot.nodesByPath[path];
  if (!node) return new Container();

  let container: Container | null = null;
  const create = (): void => {
    container = createNodeContainer(
      toFlatNode(node),
      snapshot.flatNodesById,
      snapshot.flatChildrenById,
    );
  };

  if (path === "") {
    create();
  } else {
    withSnapshotAncestorThemes(snapshot, path, create);
  }

  annotateSnapshotPaths(container!, snapshot, path);
  return container!;
}

function copyRootContainerMetadata(target: Container, source: Container): void {
  (target as unknown as { _effectiveWidth?: number })._effectiveWidth =
    (source as unknown as { _effectiveWidth?: number })._effectiveWidth;
  (target as unknown as { _effectiveHeight?: number })._effectiveHeight =
    (source as unknown as { _effectiveHeight?: number })._effectiveHeight;
}

function replaceRefContainerContents(
  container: Container,
  snapshot: ResolvedInstanceSnapshot,
): void {
  container.removeChildren().forEach((child) => child.destroy());
  const next = createSnapshotSubtreeContainer(snapshot, "");
  while (next.children.length > 0) {
    container.addChild(next.children[0]);
  }
  copyRootContainerMetadata(container, next);
  (container as InstanceRenderContainer)._instanceSnapshot = snapshot;
  (container as InstanceRenderContainer)._instancePath = "";
  next.destroy();
}

function reconcileSnapshotChildren(
  parentContainer: Container,
  parentPath: string,
  prevSnapshot: ResolvedInstanceSnapshot,
  nextSnapshot: ResolvedInstanceSnapshot,
): void {
  const host = getChildrenHost(parentContainer);
  if (!host) return;

  const expectedPaths = nextSnapshot.childrenByPath[parentPath] ?? [];
  const expectedSet = new Set(expectedPaths);
  const currentChildren = new Map<string, Container>();
  for (const child of host.children) {
    const instanceChild = child as InstanceRenderContainer;
    if (instanceChild._instancePath) {
      currentChildren.set(instanceChild._instancePath, child as Container);
    }
  }

  for (let index = 0; index < expectedPaths.length; index++) {
    const path = expectedPaths[index];
    const nextNode = nextSnapshot.nodesByPath[path];
    if (!nextNode) continue;
    const prevNode = prevSnapshot.nodesByPath[path];
    let childContainer = currentChildren.get(path);

    if (!childContainer || !prevNode || prevNode.type !== nextNode.type) {
      if (childContainer) {
        host.removeChild(childContainer);
        childContainer.destroy({ children: true });
      }
      childContainer = createSnapshotSubtreeContainer(nextSnapshot, path);
      host.addChildAt(childContainer, Math.min(index, host.children.length));
    } else {
      const applyUpdate = (): void => {
        updateNodeContainer(
          childContainer!,
          toFlatNode(nextNode),
          toFlatNode(prevNode),
          nextSnapshot.flatNodesById,
          nextSnapshot.flatChildrenById,
          false,
          false,
        );
      };

      withSnapshotAncestorThemes(nextSnapshot, path, applyUpdate);

      if (nextNode.type === "frame" || nextNode.type === "group") {
        reconcileSnapshotChildren(childContainer, path, prevSnapshot, nextSnapshot);
      }
    }

    if (host.getChildIndex(childContainer) !== index) {
      host.setChildIndex(childContainer, index);
    }
    annotateSnapshotPaths(childContainer, nextSnapshot, path);
  }

  for (let i = host.children.length - 1; i >= 0; i--) {
    const child = host.children[i] as InstanceRenderContainer;
    if (!child._instancePath || expectedSet.has(child._instancePath)) continue;
    host.removeChild(child as Container);
    (child as Container).destroy({ children: true });
  }
}

function createRefContainer(
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  const parentById = deriveParentById(nodesById, childrenById);
  const snapshot = getResolvedSnapshotForRef(
    node,
    nodesById,
    childrenById,
    parentById,
  );
  if (!snapshot) return new Container();
  return createSnapshotSubtreeContainer(snapshot, "");
}

function updateRefContainer(
  container: Container,
  node: RefNode,
  prev: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  forceRebuild = false,
): void {
  const resolvedParentById = deriveParentById(nodesById, childrenById);
  const nextSnapshot = getResolvedSnapshotForRef(
    node,
    nodesById,
    childrenById,
    resolvedParentById,
  );
  if (!nextSnapshot) {
    container.removeChildren().forEach((child) => child.destroy());
    (container as InstanceRenderContainer)._instanceSnapshot = undefined;
    return;
  }

  const prevSnapshot = (container as InstanceRenderContainer)._instanceSnapshot;
  if (!prevSnapshot || forceRebuild || node.componentId !== prev.componentId) {
    replaceRefContainerContents(container, nextSnapshot);
    return;
  }

  updateFrameContainer(
    container,
    toFlatNode(nextSnapshot.tree) as FlatFrameNode,
    toFlatNode(prevSnapshot.tree) as FlatFrameNode,
    nextSnapshot.flatNodesById,
    nextSnapshot.flatChildrenById,
  );
  reconcileSnapshotChildren(container, "", prevSnapshot, nextSnapshot);
  annotateSnapshotPaths(container, nextSnapshot, "");
  (container as InstanceRenderContainer)._instanceSnapshot = nextSnapshot;
}

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
    case "embed":
      container = createEmbedContainer(node as EmbedNode);
      break;
    case "ref":
      container = createRefContainer(node as RefNode, nodesById, childrenById);
      break;
    default:
      container = new Container();
  }

  // Common properties
  container.label = node.id;
  // Position will be set by applyAutoLayoutPositions for auto-layout children
  // For now, set it from node (will be overwritten if in auto-layout)
  const initialPos = getSnappedNodePosition(node);
  container.position.set(initialPos.x, initialPos.y);
  container.alpha = node.opacity ?? 1;
  container.visible = node.visible !== false && node.enabled !== false;

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
  const initialShadowSize = getNodeShadowSize(node, container);
  applyShadow(
    container,
    node.effect,
    initialShadowSize.width,
    initialShadowSize.height,
    getNodeCornerRadius(node),
    getNodeShadowShape(node),
    getNodeCornerRadiusPerCorner(node),
  );

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
  forceRebuild?: boolean,
): void {
  // Position - skip for auto-layout children (handled by applyAutoLayoutPositions)
  if (!skipPosition && (node.x !== prev.x || node.y !== prev.y)) {
    const pos = getSnappedNodePosition(node);
    container.position.set(pos.x, pos.y);
  }

  // Opacity
  if (node.opacity !== prev.opacity) {
    container.alpha = node.opacity ?? 1;
  }

  // Visibility
  if (node.visible !== prev.visible || node.enabled !== prev.enabled) {
    container.visible = node.visible !== false && node.enabled !== false;
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
    case "embed":
      updateEmbedContainer(container, node as EmbedNode, prev as EmbedNode);
      break;
    case "ref":
      updateRefContainer(
        container,
        node as RefNode,
        prev as RefNode,
        nodesById,
        childrenById,
        forceRebuild,
      );
      break;
  }

  // Shadow (after type-specific updates so frame effective size stays in sync)
  if (
    node.effect !== prev.effect ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    (node.type === "frame" && (node.sizing !== (prev as FlatFrameNode).sizing || node.layout !== (prev as FlatFrameNode).layout)) ||
    (node.type === "frame" && (node.cornerRadius !== (prev as FlatFrameNode).cornerRadius || node.cornerRadiusPerCorner !== (prev as FlatFrameNode).cornerRadiusPerCorner)) ||
    (node.type === "rect" && (node.cornerRadius !== (prev as RectNode).cornerRadius || node.cornerRadiusPerCorner !== (prev as RectNode).cornerRadiusPerCorner))
  ) {
    const shadowSize = getNodeShadowSize(node, container);
    applyShadow(
      container,
      node.effect,
      shadowSize.width,
      shadowSize.height,
      getNodeCornerRadius(node),
      getNodeShadowShape(node),
      getNodeCornerRadiusPerCorner(node),
    );
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
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
): void {
  void nodesById;
  void childrenById;
  // Skip if size hasn't changed
  if (node.width === layoutWidth && node.height === layoutHeight) return;

  switch (node.type) {
    case "rect": {
      const gfx = container.getChildByLabel("rect-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawRect(gfx, { ...node, width: layoutWidth, height: layoutHeight } as RectNode);
      }
      const shadowRectNode = { ...node, width: layoutWidth, height: layoutHeight } as RectNode;
      applyShadow(
        container,
        shadowRectNode.effect,
        layoutWidth,
        layoutHeight,
        shadowRectNode.cornerRadius,
        "rect",
        shadowRectNode.cornerRadiusPerCorner,
      );
      break;
    }
    case "ellipse": {
      const gfx = container.getChildByLabel("ellipse-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawEllipse(gfx, { ...node, width: layoutWidth, height: layoutHeight } as EllipseNode);
      }
      const shadowEllipseNode = { ...node, width: layoutWidth, height: layoutHeight } as EllipseNode;
      applyShadow(
        container,
        shadowEllipseNode.effect,
        layoutWidth,
        layoutHeight,
        undefined,
        "ellipse",
      );
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
        drawRoundedShape(mask, layoutWidth, layoutHeight, frameNode.cornerRadius, frameNode.cornerRadiusPerCorner);
        mask.fill(0xffffff);
      }
      applyShadow(
        container,
        (node as FlatFrameNode).effect,
        layoutWidth,
        layoutHeight,
        (node as FlatFrameNode).cornerRadius,
        "rect",
        (node as FlatFrameNode).cornerRadiusPerCorner,
      );
      break;
    }
    case "embed": {
      // Embed HTML content is intentionally not scaled during interactive resize.
      // It is re-rendered at the target size after resize settles.
      break;
    }
    // Text and other types don't need size updates for layout
  }
}
