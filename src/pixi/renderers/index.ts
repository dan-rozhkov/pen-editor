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
  EmbedNode,
  RefNode,
  PerCornerRadius,
} from "@/types/scene";
import { flattenTree } from "@/types/scene";
import { getRenderableEffects } from "@/utils/fillUtils";
import { applyShadows } from "./shadowHelpers";
import { createRectContainer, updateRectContainer, drawRect } from "./rectRenderer";
import { createEllipseContainer, updateEllipseContainer, drawEllipse } from "./ellipseRenderer";
import { createTextContainer, updateTextContainer } from "./textRenderer";
import { createLineContainer, updateLineContainer } from "./lineRenderer";
import { createPolygonContainer, updatePolygonContainer } from "./polygonRenderer";
import { createPathContainer, updatePathContainer } from "./pathRenderer";
import { createFrameContainer, updateFrameContainer, drawFrameBackground } from "./frameRenderer";
import { drawRoundedShape } from "./fillStrokeHelpers";
import { drawLayoutGrids } from "./layoutGridRenderer";
import { createGroupContainer } from "./groupRenderer";
import { createEmbedContainer, updateEmbedContainer } from "./embedRenderer";
import { createConnectorContainer, updateConnectorContainer } from "./connectorRenderer";
import { applyShaderFill, shouldRebakeShader, resizeShaderFill } from "./shaderFillHelpers";
import type { ConnectorNode } from "@/types/scene";
import type { ShadowShape } from "./shadowHelpers";
import { resolveRefToTree } from "@/utils/instanceRuntime";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { applyAutoLayoutRecursively } from "@/utils/autoLayoutUtils";

// --- Ref context tracking for slot indicator rendering ---
let refContextDepth = 0;

export function pushRefContext(): void { refContextDepth++; }
export function popRefContext(): void { refContextDepth = Math.max(0, refContextDepth - 1); }
export function isInsideRef(): boolean { return refContextDepth > 0; }

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

/**
 * Snapshot of the flat tree that a resolved ref subtree was last built/updated
 * from. Cached per ref container so in-place updates can diff against the
 * previous resolved state without re-resolving twice.
 */
interface FlatTreeSnapshot {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  rootId: string;
}

const refFlatTreeByContainer = new WeakMap<Container, FlatTreeSnapshot>();

/**
 * Resolve a ref node to its laid-out flat tree (resolve → auto-layout → flatten).
 * Shared by createRefContainer and the in-place update path so they stay in sync.
 */
function resolveRefToFlatTree(
  node: RefNode,
): { flat: FlatTreeSnapshot; root: FlatFrameNode } | null {
  const globalState = useSceneStore.getState();
  const resolved = resolveRefToTree(node, globalState.nodesById, globalState.childrenById);
  if (!resolved) return null;
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const laidOutResolved = applyAutoLayoutRecursively(
    resolved,
    calculateLayoutForFrame,
  );
  const flat = flattenTree([laidOutResolved]);
  const root = flat.nodesById[laidOutResolved.id] as FlatFrameNode | undefined;
  if (!root) return null;
  return {
    flat: {
      nodesById: flat.nodesById,
      childrenById: flat.childrenById,
      rootId: laidOutResolved.id,
    },
    root,
  };
}

function createRefContainer(
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): Container {
  // Use global store for resolution — the passed-in maps may be a private
  // flat store (from flattenTree) that doesn't contain component definitions.
  void nodesById; void childrenById;
  const resolved = resolveRefToFlatTree(node);
  if (!resolved) return new Container();

  pushRefContext();
  try {
    const container = createFrameContainer(
      resolved.root,
      resolved.flat.nodesById,
      resolved.flat.childrenById,
    );
    refFlatTreeByContainer.set(container, resolved.flat);
    return container;
  } finally {
    popRefContext();
  }
}

/**
 * Classify what kind of change happened between two RefNode states, to decide
 * how the resolved subtree should be updated.
 *
 * - "structural": componentId/overrides changed (or forceRebuild) → the resolved
 *   tree shape can differ (overrides can add/remove slot children), so the whole
 *   subtree must be destroyed and recreated. `overrides` is compared by reference,
 *   so a new object with equal contents still counts as structural (conservative).
 * - "resize": only width/height changed → re-run layout + targeted in-place updates.
 * - "cosmetic": only fill/stroke/binding/strokeWidth changed → in-place updates.
 * - "none": nothing relevant changed.
 *
 * If both resize and cosmetic apply, "resize" is returned — the in-place path
 * handles both anyway (it re-resolves the whole subtree and reconciles every node).
 * `forceRebuild` wins over everything.
 */
export function classifyRefChange(
  node: RefNode,
  prev: RefNode,
  forceRebuild = false,
): "structural" | "resize" | "cosmetic" | "none" {
  if (
    forceRebuild ||
    node.componentId !== prev.componentId ||
    node.overrides !== prev.overrides
  ) {
    return "structural";
  }

  const sizeChanged = node.width !== prev.width || node.height !== prev.height;
  if (sizeChanged) return "resize";

  const cosmeticChanged =
    node.fill !== prev.fill ||
    node.fillBinding !== prev.fillBinding ||
    node.stroke !== prev.stroke ||
    node.strokeBinding !== prev.strokeBinding ||
    node.strokeWidth !== prev.strokeWidth;
  if (cosmeticChanged) return "cosmetic";

  return "none";
}

function rebuildRefContainer(
  container: Container,
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): void {
  container.removeChildren().forEach((child) => child.destroy());
  // createRefContainer caches its flat-tree snapshot on the temporary `next`
  // container; transfer it to the long-lived `container` so later in-place
  // updates can diff against it.
  const next = createRefContainer(node, nodesById, childrenById);
  const snapshot = refFlatTreeByContainer.get(next);
  while (next.children.length > 0) {
    container.addChild(next.children[0]);
  }
  next.destroy();
  if (snapshot) {
    refFlatTreeByContainer.set(container, snapshot);
  } else {
    refFlatTreeByContainer.delete(container);
  }
}

function updateRefContainer(
  container: Container,
  node: RefNode,
  prev: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  forceRebuild = false,
): void {
  const change = classifyRefChange(node, prev, forceRebuild);
  if (change === "none") return;
  if (change === "structural") {
    rebuildRefContainer(container, node, nodesById, childrenById);
    return;
  }
  // "resize" / "cosmetic": diff against a freshly resolved tree in place.
  updateRefContainerInPlace(container, node, nodesById, childrenById);
}

/**
 * In-place update of a resolved ref subtree for size/cosmetic changes.
 *
 * Re-resolves the ref to a fresh laid-out flat tree, then walks the existing
 * Pixi subtree and the new flat tree in parallel by node-id label, calling the
 * per-type updaters (which do minimal in-place work). This avoids destroying
 * and recreating the subtree — embeds keep their sprites/textures, text is not
 * re-rasterized unless its own props changed, etc.
 *
 * Bails out to a full rebuild if:
 * - the ref can't be resolved,
 * - there is no cached prev snapshot to diff against (after computing one
 *   from `prev`-less state is not possible here — we fall back to rebuild),
 * - the id sets of the existing subtree and the new tree differ (a node exists
 *   in one but not the other). With componentId/overrides unchanged this should
 *   not happen; it is the safety net, not the common path.
 */
function updateRefContainerInPlace(
  container: Container,
  node: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): void {
  const prevSnapshot = refFlatTreeByContainer.get(container);
  const resolved = resolveRefToFlatTree(node);

  // Without a fresh resolution or a prev snapshot we cannot diff safely.
  if (!resolved || !prevSnapshot) {
    rebuildRefContainer(container, node, nodesById, childrenById);
    return;
  }

  const { flat: nextFlat } = resolved;

  // The id sets must match exactly for a safe in-place reconcile.
  const nextIds = Object.keys(nextFlat.nodesById);
  const prevIds = Object.keys(prevSnapshot.nodesById);
  if (nextIds.length !== prevIds.length) {
    rebuildRefContainer(container, node, nodesById, childrenById);
    return;
  }

  pushRefContext();
  try {
    // The long-lived `container` represents the resolved root frame (its own
    // graphics — frame-bg/frame-children/... — are direct children). Reconcile
    // the root against the container itself, then each descendant by label.
    // Root id must be stable (it is the ref's id, preserved by resolveRefToTree).
    if (prevSnapshot.rootId !== nextFlat.rootId) {
      rebuildRefContainer(container, node, nodesById, childrenById);
      return;
    }

    // Update every node by id. Root → container; descendants → deep label lookup.
    for (const id of nextIds) {
      const nextNode = nextFlat.nodesById[id];
      const prevNode = prevSnapshot.nodesById[id];
      if (!prevNode) {
        // id present in new tree but not old → structural drift; bail out.
        rebuildRefContainer(container, node, nodesById, childrenById);
        return;
      }
      const isRoot = id === nextFlat.rootId;
      const target = isRoot ? container : container.getChildByLabel(id, true);
      if (!target) {
        // Existing container missing for this id → bail out.
        rebuildRefContainer(container, node, nodesById, childrenById);
        return;
      }
      // The root container's position is owned by pixiSync (applyAutoLayoutPositions);
      // skip repositioning it from the resolved tree.
      updateNodeContainer(
        target,
        nextNode,
        prevNode,
        nextFlat.nodesById,
        nextFlat.childrenById,
        isRoot,
      );
    }

    refFlatTreeByContainer.set(container, nextFlat);
  } finally {
    popRefContext();
  }
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
    case "connector":
      container = createConnectorContainer(node as ConnectorNode);
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

  // Shadow stack
  const initialShadowSize = getNodeShadowSize(node, container);
  applyShadows(
    container,
    getRenderableEffects(node),
    initialShadowSize.width,
    initialShadowSize.height,
    getNodeCornerRadius(node),
    getNodeShadowShape(node),
    getNodeCornerRadiusPerCorner(node),
  );

  // Shader fill (baked texture in-scene, so it obeys z-order)
  if (node.shader) applyShaderFill(container, node);

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
    case "connector":
      updateConnectorContainer(
        container,
        node as ConnectorNode,
        prev as ConnectorNode,
      );
      break;
  }

  // Shadow (after type-specific updates so frame effective size stays in sync)
  if (
    node.effect !== prev.effect ||
    node.effects !== prev.effects ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    (node.type === "frame" && (node.sizing !== (prev as FlatFrameNode).sizing || node.layout !== (prev as FlatFrameNode).layout)) ||
    (node.type === "frame" && (node.cornerRadius !== (prev as FlatFrameNode).cornerRadius || node.cornerRadiusPerCorner !== (prev as FlatFrameNode).cornerRadiusPerCorner)) ||
    (node.type === "rect" && (node.cornerRadius !== (prev as RectNode).cornerRadius || node.cornerRadiusPerCorner !== (prev as RectNode).cornerRadiusPerCorner))
  ) {
    const shadowSize = getNodeShadowSize(node, container);
    applyShadows(
      container,
      getRenderableEffects(node),
      shadowSize.width,
      shadowSize.height,
      getNodeCornerRadius(node),
      getNodeShadowShape(node),
      getNodeCornerRadiusPerCorner(node),
    );
  }

  // Shader fill: re-bake when the shader config or box size changed.
  if (shouldRebakeShader(node, prev)) applyShaderFill(container, node);
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
  // Skip if size hasn't changed — but compare against the size the container was
  // ACTUALLY last drawn at, not the stored node.width/height. For fit_content
  // frames the rendered size is layout-driven and diverges from the stored node
  // size: the frame container tracks its drawn size in `_effectiveWidth`/
  // `_effectiveHeight` (maintained by frameRenderer + below). Comparing against
  // the stale node.width made fit frames skip a needed redraw whenever the
  // computed size returned to a value equal to the stored width — e.g. after
  // undoing a text edit, or inserting then removing a child — leaving the frame
  // stuck at its previously-rendered size. Non-frame nodes don't maintain a
  // drawn-size field, so they keep comparing against node.width as before.
  const sizedFrame = container as Container & {
    _effectiveWidth?: number;
    _effectiveHeight?: number;
  };
  const isFrame = node.type === "frame";
  const drawnWidth = isFrame ? sizedFrame._effectiveWidth ?? node.width : node.width;
  const drawnHeight = isFrame ? sizedFrame._effectiveHeight ?? node.height : node.height;
  if (drawnWidth === layoutWidth && drawnHeight === layoutHeight) return;
  if (isFrame) {
    sizedFrame._effectiveWidth = layoutWidth;
    sizedFrame._effectiveHeight = layoutHeight;
  }

  switch (node.type) {
    case "rect": {
      const gfx = container.getChildByLabel("rect-bg") as Graphics;
      if (gfx) {
        gfx.clear();
        drawRect(gfx, { ...node, width: layoutWidth, height: layoutHeight } as RectNode);
      }
      const shadowRectNode = { ...node, width: layoutWidth, height: layoutHeight } as RectNode;
      applyShadows(
        container,
        getRenderableEffects(shadowRectNode),
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
      applyShadows(
        container,
        getRenderableEffects(shadowEllipseNode),
        layoutWidth,
        layoutHeight,
        undefined,
        "ellipse",
      );
      break;
    }
    case "frame": {
      const frameNode = node as FlatFrameNode;
      const bg = container.getChildByLabel("frame-bg") as Graphics;
      if (bg) {
        bg.clear();
        drawFrameBackground(bg, frameNode, layoutWidth, layoutHeight);
      }
      // Update mask if present
      const mask = container.getChildByLabel("frame-mask") as Graphics;
      if (mask && frameNode.clip) {
        mask.clear();
        drawRoundedShape(mask, layoutWidth, layoutHeight, frameNode.cornerRadius, frameNode.cornerRadiusPerCorner);
        mask.fill(0xffffff);
      }
      // Update layout grid overlay
      const gridGfx = container.getChildByLabel("frame-layout-grid") as Graphics;
      if (gridGfx && frameNode.layoutGrids?.length) {
        gridGfx.clear();
        drawLayoutGrids(gridGfx, frameNode.layoutGrids, layoutWidth, layoutHeight);
      }
      applyShadows(
        container,
        getRenderableEffects(frameNode),
        layoutWidth,
        layoutHeight,
        frameNode.cornerRadius,
        "rect",
        frameNode.cornerRadiusPerCorner,
      );
      break;
    }
    case "embed": {
      // Embed HTML content is intentionally not scaled during interactive resize.
      // It is re-rendered at the target size after resize settles.
      break;
    }
    case "ref": {
      if (!nodesById || !childrenById) break;
      // Route through the in-place reconcile (re-resolve + diff-by-label),
      // which keeps embed sprites/textures and avoids subtree churn during
      // auto-layout resize passes. Falls back to a rebuild internally if the
      // tree shape drifts or no prev snapshot exists.
      updateRefContainerInPlace(
        container,
        { ...node, width: layoutWidth, height: layoutHeight } as RefNode,
        nodesById,
        childrenById,
      );
      break;
    }
    // Text and other types don't need size updates for layout
  }

  // Shader fill: the layout-driven size change bypasses node.width/height (and
  // thus shouldRebakeShader), so resize the baked sprite here and debounce-rebake.
  if (node.shader) resizeShaderFill(container, node, layoutWidth, layoutHeight);
}
