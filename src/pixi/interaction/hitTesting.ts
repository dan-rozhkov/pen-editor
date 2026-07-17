import { TextStyle } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getCullingIndex } from "@/pixi/pixiSync";
import type { SceneNode, FrameNode, FlatSceneNode, RefNode, ConnectorNode, LineNode } from "@/types/scene";
import {
  getPreparedNodeEffectiveSize,
  prepareFrameNode,
} from "@/utils/instanceUtils";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { buildCapPrimitive, capPrimitiveBounds } from "@/utils/lineCapUtils";
import { distanceToSegment } from "@/utils/geometryUtils";
import type { TransformHandle } from "./types";
import { measureLabelTextWidth, truncateLabelToWidth } from "@/pixi/frameLabelUtils";
import { resolveRefToTree, findResolvedDescendantByPath } from "@/utils/instanceRuntime";
import { resolveMasking } from "@/lib/masks/maskResolution";
import {
  LABEL_FONT_SIZE,
  LABEL_OFFSET_Y,
} from "@/pixi/selectionOverlay/constants";

export type CanvasHitTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "instance-descendant"; instanceId: string; descendantPath: string };

const LABEL_HIT_PADDING = 2;

/**
 * Screen-space padding (px) applied to the culling-index point query used to
 * prune root subtrees in `findCanvasHitTargetAtPoint`. The index stores each
 * node's raw (unrotated, store-coordinate) AABB, but `line`/`connector` hit
 * tests accept clicks beyond that raw bbox — up to `max(5, capReach)/scale`
 * for a line's rendered cap tip, and `5/scale` for a connector's stroke.
 * Padding by a screen-space margin (converted to world units via /scale, the
 * same convention those thresholds use) covers the fixed "5px stroke/handle
 * tolerance" cases; it does NOT bound an arbitrarily large cap reach (which
 * scales with strokeWidth, not with zoom) — `line`/`connector` roots are
 * therefore excluded from pruning entirely below rather than relying on this
 * padding alone.
 */
const ROOT_PRUNE_PADDING_PX = 8;

/**
 * True for an auto-layout frame with `fit_content` sizing on either axis —
 * its rendered (hit-tested) size is the *live* Yoga-computed intrinsic size
 * (`prepareFrameNode`/`getPreparedNodeEffectiveSize`), which the culling
 * index cannot see: `syncAutoLayout` applies intrinsic size only to the
 * Pixi container, never back to the store's `width`/`height`. See the
 * root-pruning comment in `findCanvasHitTargetAtPoint` for why this must be
 * excluded from pruning rather than merely padded around.
 */
function isFitContentFrame(node: SceneNode): boolean {
  if (node.type !== "frame") return false;
  return (
    node.layout?.autoLayout === true &&
    (node.sizing?.widthMode === "fit_content" || node.sizing?.heightMode === "fit_content")
  );
}
const LABEL_FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const LABEL_TEXT_STYLE = new TextStyle({
  fontFamily: LABEL_FONT_FAMILY,
  fontSize: LABEL_FONT_SIZE,
});

/**
 * How far a line's rendered cap shape reaches beyond its raw segment
 * endpoint: `along` the line's direction (e.g. an arrow/triangle's length)
 * and `perp`endicular to it (e.g. an arrowhead/bar's spread). Derived from
 * the same primitive geometry the SVG/Pixi renderers use
 * (`@/utils/lineCapUtils`) so the hit-test tolerance can't drift from what's
 * actually drawn.
 */
function lineCapReach(shape: LineNode["startCap"], strokeWidth: number): { along: number; perp: number } {
  const primitive = shape ? buildCapPrimitive(shape, strokeWidth) : null;
  if (!primitive) return { along: 0, perp: 0 };
  // Match the floor `buildCapPrimitive` applies internally so the tolerance
  // lines up with the geometry actually drawn.
  const bounds = capPrimitiveBounds(primitive, Math.max(strokeWidth, 1));
  return {
    along: -bounds.minX,
    perp: Math.max(Math.abs(bounds.minY), Math.abs(bounds.minY + bounds.height)),
  };
}

function getHitNodeEffectiveSize(
  node: SceneNode,
  sceneNodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): { width: number; height: number } {
  if (node.type === "ref") {
    const resolved = resolveRefToTree(
      node as RefNode,
      nodesById,
      childrenById,
    );
    if (resolved) {
      return getPreparedNodeEffectiveSize(
        resolved,
        sceneNodes,
        calculateLayoutForFrame,
      );
    }
  }

  return getPreparedNodeEffectiveSize(node, sceneNodes, calculateLayoutForFrame);
}

/**
 * Convert screen coordinates to world coordinates
 */
export function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  const vs = useViewportStore.getState();
  return {
    x: (screenX - vs.x) / vs.scale,
    y: (screenY - vs.y) / vs.scale,
  };
}

/**
 * Find a frame/group/embed label at the given world coordinates.
 * Returns the node ID if a label is hit, null otherwise.
 */
export function findFrameLabelAtPoint(worldX: number, worldY: number): string | null {
  const scene = useSceneStore.getState();
  const { editingNodeId, editingMode } = useSelectionStore.getState();
  const scale = useViewportStore.getState().scale || 1;

  const frameIds: string[] = [];

  // Match overlay visibility: top-level frames/groups only (same as Konva).
  for (const rootId of scene.rootIds) {
    const node = scene.nodesById[rootId];
    if (!node || node.visible === false || node.enabled === false) continue;
    if (node.type !== "frame" && node.type !== "group" && node.type !== "embed") continue;
    frameIds.push(rootId);
  }

  // Hit-test from top-most drawn label to bottom-most.
  for (let i = frameIds.length - 1; i >= 0; i--) {
    const frameId = frameIds[i];

    // Hidden while editing this exact name.
    if (editingNodeId === frameId && editingMode === "name") continue;

    const node = scene.nodesById[frameId] as FlatSceneNode | undefined;
    if (!node) continue;

    // We only draw labels for top-level frames/groups.
    // Their absolute position is the local x/y in root space.
    const labelX = node.x;
    const labelY = node.y;

    const defaultName =
      node.type === "group" ? "Group" : node.type === "embed" ? "Embed" : "Frame";
    const fullName = node.name || defaultName;
    const maxLabelWidthPx = Math.max(0, node.width * scale);
    const displayName = truncateLabelToWidth(fullName, maxLabelWidthPx, LABEL_TEXT_STYLE);
    if (!displayName) continue;

    const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;
    const labelWorldY = labelY - worldOffsetY;
    const labelW = measureLabelTextWidth(displayName, LABEL_TEXT_STYLE) / scale;
    const labelH = LABEL_FONT_SIZE / scale;
    const padding = LABEL_HIT_PADDING / scale;

    if (
      worldX >= labelX - padding &&
      worldX <= labelX + labelW + padding &&
      worldY >= labelWorldY - padding &&
      worldY <= labelWorldY + labelH + padding
    ) {
      return frameId;
    }
  }

  return null;
}

/**
 * Find the top-most node at the given world coordinates.
 * If deepSelect is true, returns the deepest node instead.
 */
export function findNodeAtPoint(
  worldX: number,
  worldY: number,
  options?: { deepSelect?: boolean },
): string | null {
  const target = findCanvasHitTargetAtPoint(worldX, worldY, options);
  return target?.kind === "node" ? target.nodeId : null;
}

export function findCanvasHitTargetAtPoint(
  worldX: number,
  worldY: number,
  options?: { deepSelect?: boolean },
): CanvasHitTarget | null {
  const state = useSceneStore.getState();
  const sceneNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const deepSelect = options?.deepSelect === true;
  const selectionState = deepSelect ? null : useSelectionStore.getState();
  const selectedSet = selectionState
    ? new Set(selectionState.selectedIds)
    : null;
  const enteredContainerId = selectionState?.enteredContainerId ?? null;
  const enteredInstanceDescendantPath = selectionState?.enteredInstanceDescendantPath ?? null;

  // Figma-style drill scope: the entered container and its ancestors, plus
  // the ancestors of every selected node. A hit resolved inside this chain
  // is returned as-is instead of being clamped to the top-level node.
  const scopeSet = new Set<string>();
  if (selectionState) {
    const addAncestors = (startId: string | null | undefined): void => {
      let cur = startId ?? null;
      while (cur) {
        if (scopeSet.has(cur)) break;
        scopeSet.add(cur);
        cur = state.parentById[cur] ?? null;
      }
    };
    addAncestors(enteredContainerId);
    for (const id of selectionState.selectedIds) {
      addAncestors(state.parentById[id] ?? null);
    }
  }

  const hitNode = (
    node: SceneNode,
    parentAbsX: number,
    parentAbsY: number,
    parentPath = "",
  ): CanvasHitTarget | null => {
    if (node.visible === false || node.enabled === false) return null;

    const absX = parentAbsX + node.x;
    const absY = parentAbsY + node.y;

    // Line nodes: hit-test against the segment (+ cap extent), not the raw
    // bounding box. A stroked cap primitive (arrowhead spread, bar, etc. —
    // see `@/utils/lineCapUtils`) can extend well beyond the two endpoints,
    // so the plain bbox check below would miss clicks on a rendered cap tip;
    // it also fails outright for axis-aligned lines where the bbox collapses
    // to zero width/height on one axis.
    if (node.type === "line") {
      const ln = node as LineNode;
      if (ln.points.length >= 4) {
        const strokeWidth = ln.strokeWidth ?? 1;
        const startReach = lineCapReach(ln.startCap, strokeWidth);
        const endReach = lineCapReach(ln.endCap, strokeWidth);
        const x1 = absX + ln.points[0];
        const y1 = absY + ln.points[1];
        const x2 = absX + ln.points[2];
        const y2 = absY + ln.points[3];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // Extend each endpoint outward along the line direction to cover a
        // solid cap's tip (e.g. a triangle/arrow reaching `along` past the
        // endpoint).
        const sx1 = x1 - ux * startReach.along;
        const sy1 = y1 - uy * startReach.along;
        const sx2 = x2 + ux * endReach.along;
        const sy2 = y2 + uy * endReach.along;
        const scale = useViewportStore.getState().scale;
        const perpTolerance = Math.max(startReach.perp, endReach.perp, strokeWidth / 2);
        const threshold = Math.max(5, perpTolerance) / scale;
        const dist = distanceToSegment(worldX, worldY, sx1, sy1, sx2, sy2);
        if (dist <= threshold) {
          return { kind: "node", nodeId: node.id };
        }
        return null;
      }
    }

    const { width, height } = getHitNodeEffectiveSize(
      node,
      sceneNodes,
      calculateLayoutForFrame,
      state.nodesById,
      state.childrenById,
    );

    if (
      worldX < absX ||
      worldX > absX + width ||
      worldY < absY ||
      worldY > absY + height
    ) {
      return null;
    }

    // Connector nodes: use line-segment distance instead of bounding box
    if (node.type === "connector") {
      const conn = node as ConnectorNode;
      if (conn.points.length >= 4) {
        const scale = useViewportStore.getState().scale;
        const threshold = 5 / scale;
        const dist = distanceToSegment(
          worldX, worldY,
          absX + conn.points[0], absY + conn.points[1],
          absX + conn.points[2], absY + conn.points[3],
        );
        if (dist <= threshold) {
          return { kind: "node", nodeId: node.id };
        }
        return null;
      }
    }

    if (node.type === "ref") {
      // Default: ref is opaque unless deep-selecting or entered
      if (!deepSelect && enteredContainerId !== node.id) {
        return { kind: "node", nodeId: node.id };
      }

      const resolved = resolveRefToTree(
        node as RefNode,
        state.nodesById,
        state.childrenById,
      );
      if (!resolved) return { kind: "node", nodeId: node.id };

      // Unified recursive hit test — returns deepest matching path
      const hitResolvedPath = (
        resolvedNode: SceneNode,
        resolvedAbsX: number,
        resolvedAbsY: number,
        resolvedPath: string,
      ): string | null => {
        if (resolvedNode.visible === false || resolvedNode.enabled === false) return null;

        const { width: resolvedWidth, height: resolvedHeight } =
          getPreparedNodeEffectiveSize(resolvedNode, [], calculateLayoutForFrame);
        if (
          worldX < resolvedAbsX ||
          worldX > resolvedAbsX + resolvedWidth ||
          worldY < resolvedAbsY ||
          worldY > resolvedAbsY + resolvedHeight
        ) {
          return null;
        }

        let resolvedChildren: SceneNode[];
        if (resolvedNode.type === "ref") {
          const nestedResolved = resolveRefToTree(
            resolvedNode as RefNode, state.nodesById, state.childrenById,
          );
          if (nestedResolved) {
            resolvedChildren = nestedResolved.layout?.autoLayout
              ? prepareFrameNode(nestedResolved, calculateLayoutForFrame).layoutChildren
              : nestedResolved.children;
          } else {
            resolvedChildren = [];
          }
        } else if (resolvedNode.type === "frame" && resolvedNode.layout?.autoLayout) {
          resolvedChildren = prepareFrameNode(resolvedNode, calculateLayoutForFrame).layoutChildren;
        } else if (resolvedNode.type === "frame" || resolvedNode.type === "group") {
          resolvedChildren = resolvedNode.children;
        } else {
          resolvedChildren = [];
        }

        for (let i = resolvedChildren.length - 1; i >= 0; i--) {
          const child = resolvedChildren[i];
          const childHit = hitResolvedPath(
            child,
            resolvedAbsX + child.x,
            resolvedAbsY + child.y,
            `${resolvedPath}/${child.id}`,
          );
          if (childHit) return childHit;
        }

        return resolvedPath;
      };

      // Find deepest hit path (apply auto-layout at root level, matching renderer)
      const rootChildren = resolved.layout?.autoLayout
        ? prepareFrameNode(resolved, calculateLayoutForFrame).layoutChildren
        : resolved.children;
      let deepHitPath: string | null = null;
      for (let i = rootChildren.length - 1; i >= 0; i--) {
        const child = rootChildren[i];
        deepHitPath = hitResolvedPath(child, absX + child.x, absY + child.y, child.id);
        if (deepHitPath) break;
      }

      if (!deepHitPath) return { kind: "node", nodeId: node.id };

      // Deep select: return full deep path
      if (deepSelect) {
        return { kind: "instance-descendant", instanceId: node.id, descendantPath: deepHitPath };
      }

      // Entered ref: truncate to first child below entered level
      const prefix = enteredInstanceDescendantPath ? enteredInstanceDescendantPath + "/" : "";
      if (deepHitPath.startsWith(prefix)) {
        const remaining = deepHitPath.slice(prefix.length);
        const firstChild = remaining.split("/")[0];
        const resultPath = enteredInstanceDescendantPath
          ? `${enteredInstanceDescendantPath}/${firstChild}`
          : firstChild;
        return { kind: "instance-descendant", instanceId: node.id, descendantPath: resultPath };
      }

      return { kind: "node", nodeId: node.id };
    }

    const childNodes =
      node.type === "frame" && node.layout?.autoLayout
        ? prepareFrameNode(node, calculateLayoutForFrame).layoutChildren
        : node.type === "frame" || node.type === "group"
          ? node.children
          : [];

    // Figma-style sibling masking (see `resolveMasking`): a child clipped by
    // a masking sibling should not be hit-testable outside the masker's
    // shape. Vector and alpha maskers are both approximated by their
    // bounding box here — matches how this same function already
    // approximates non-rectangular shapes (e.g. ellipse hit-testing uses the
    // bbox, not the ellipse curve) — good enough to stop clicks landing on
    // content that's visibly clipped away, without needing per-shape
    // geometry in the hit-test path.
    const maskerIdBySiblingId = childNodes.length > 1
      ? resolveMasking(childNodes.map((c) => c.id), state.nodesById).maskerIdBySiblingId
      : new Map<string, string>();

    for (let i = childNodes.length - 1; i >= 0; i--) {
      const child = childNodes[i];

      const maskerId = maskerIdBySiblingId.get(child.id);
      if (maskerId) {
        const maskerChild = childNodes.find((c) => c.id === maskerId);
        if (maskerChild) {
          const maskerAbsX = absX + maskerChild.x;
          const maskerAbsY = absY + maskerChild.y;
          const outsideMasker =
            worldX < maskerAbsX ||
            worldX > maskerAbsX + maskerChild.width ||
            worldY < maskerAbsY ||
            worldY > maskerAbsY + maskerChild.height;
          if (outsideMasker) continue; // masked away at this point
        }
      }

      const childHit = hitNode(
        child,
        absX,
        absY,
        parentPath ? `${parentPath}/${node.id}` : node.id,
      );
      if (!childHit) continue;

      if (deepSelect) return childHit;
      if (childHit.kind === "instance-descendant") return childHit;
      if (selectedSet?.has(childHit.nodeId)) return childHit;
      if (scopeSet.has(node.id)) return childHit;
      return { kind: "node", nodeId: node.id };
    }

    return { kind: "node", nodeId: node.id };
  };

  // Task 11: prune root subtrees whose indexed AABB misses the point. `null`
  // means no index is available (pixiSync not initialized) — behave exactly
  // as before, unpruned. Padded by a screen-space margin to absorb the fixed
  // stroke/handle hit tolerances (see ROOT_PRUNE_PADDING_PX).
  //
  // IMPORTANT for future call sites: `candidates` is a snapshot of the
  // culling index's *last flush*, not the live store — it can lag a store
  // write by up to one rAF (pixiSync's `scheduleSceneUpdate` is
  // rAF-deferred). Anything hit-tested from *live* geometry that can diverge
  // from what's indexed must be excluded from pruning below, not merely
  // padded around, since the divergence isn't bounded by a fixed pixel
  // amount. Two known cases, both excluded:
  //  - `line`/`connector` roots: their hit tolerance (rendered cap reach;
  //    connector endpoints that moved since the last flush) isn't reliably
  //    bounded by ROOT_PRUNE_PADDING_PX.
  //  - fit_content auto-layout frame roots: `getPreparedNodeEffectiveSize`
  //    hit-tests against the *live* intrinsic (Yoga-computed) size, but the
  //    index bboxes the frame from its *stored* `width`/`height` — for a
  //    hug-contents frame those never converge, because `syncAutoLayout`
  //    applies the intrinsic size only to the Pixi container, never writes
  //    it back to the store. A click inside the real rendered frame but
  //    outside the stale stored bbox would otherwise be wrongly pruned.
  const scaleForPrune = useViewportStore.getState().scale || 1;
  const prunePadding = ROOT_PRUNE_PADDING_PX / scaleForPrune;
  const candidates = getCullingIndex()?.queryVisible({
    minX: worldX - prunePadding,
    minY: worldY - prunePadding,
    maxX: worldX + prunePadding,
    maxY: worldY + prunePadding,
  }) ?? null;

  // Walk root nodes in reverse (top-most first).
  for (let i = sceneNodes.length - 1; i >= 0; i--) {
    const rootNode = sceneNodes[i];
    if (
      candidates &&
      rootNode.type !== "connector" &&
      rootNode.type !== "line" &&
      !isFitContentFrame(rootNode) &&
      !candidates.has(rootNode.id)
    ) {
      continue;
    }
    const hit = hitNode(rootNode, 0, 0);
    if (hit) return hit;
  }
  return null;
}

/**
 * Deep-select hit test used for Cmd/Ctrl+Click.
 * Returns the deepest node under cursor using layout-aware child positions.
 */
export function findDeepestNodeAtPoint(worldX: number, worldY: number): string | null {
  return findNodeAtPoint(worldX, worldY, { deepSelect: true });
}

/**
 * Check if a world-space point is near a transform handle of the current selection.
 * Returns the active transform handle identifier or null.
 */
export function hitTestTransformHandle(worldX: number, worldY: number): {
  corner: TransformHandle;
  nodeId: string;
  absX: number;
  absY: number;
  width: number;
  height: number;
  slotContext?: { instanceId: string; descendantPath: string };
} | null {
  const { selectedIds, instanceContext } = useSelectionStore.getState();

  const state = useSceneStore.getState();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

  // Instance descendant: only allow transform for slot frames
  if (instanceContext) {
    if (selectedIds.length !== 1) return null;
    const instance = state.nodesById[instanceContext.instanceId];
    if (!instance || instance.type !== "ref") return null;
    const effectiveSize = getEffectiveSizeForHit(instanceContext.instanceId, state, calculateLayoutForFrame);
    const refWithLayout: RefNode = effectiveSize
      ? { ...(instance as RefNode), width: effectiveSize.width, height: effectiveSize.height }
      : (instance as RefNode);
    const resolved = findResolvedDescendantByPath(
      refWithLayout,
      instanceContext.descendantPath,
      state.nodesById,
      state.childrenById,
      state.parentById,
      calculateLayoutForFrame,
    );
    if (!resolved) return null;
    if (resolved.node.type !== "frame" || !(resolved.node as FrameNode).isSlot) return null;

    const absX = resolved.absX;
    const absY = resolved.absY;
    const width = resolved.width;
    const height = resolved.height;

    return hitTestHandlesAt(worldX, worldY, absX, absY, width, height, instanceContext.instanceId, {
      instanceId: instanceContext.instanceId,
      descendantPath: instanceContext.descendantPath,
    });
  }

  if (selectedIds.length !== 1) return null;

  const nodeId = selectedIds[0];
  const treeNodes = state.getNodes();
  let bounds: { x: number; y: number; width: number; height: number } | null = null;

  const findBounds = (
    nodes: SceneNode[],
    parentAbsX: number,
    parentAbsY: number,
  ): boolean => {
    for (const n of nodes) {
      const absX = parentAbsX + n.x;
      const absY = parentAbsY + n.y;
      const { width, height } = getHitNodeEffectiveSize(
        n,
        treeNodes,
        calculateLayoutForFrame,
        state.nodesById,
        state.childrenById,
      );
      if (n.id === nodeId) {
        bounds = { x: absX, y: absY, width, height };
        return true;
      }

      const children =
        n.type === "frame" && n.layout?.autoLayout
          ? prepareFrameNode(n, calculateLayoutForFrame).layoutChildren
          : n.type === "frame" || n.type === "group"
            ? n.children
            : null;
      if (children && findBounds(children, absX, absY)) return true;
    }
    return false;
  };

  if (!findBounds(treeNodes, 0, 0) || !bounds) return null;
  const { x: absX, y: absY, width, height } = bounds;

  return hitTestHandlesAt(worldX, worldY, absX, absY, width, height, nodeId);
}

/** Get effective (layout-computed) size for a node during hit testing. */
function getEffectiveSizeForHit(
  nodeId: string,
  state: { nodesById: Record<string, FlatSceneNode>; getNodes: () => SceneNode[] },
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { width: number; height: number } | null {
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const treeNodes = state.getNodes();
  return getNodeEffectiveSize(treeNodes, nodeId, calculateLayoutForFrame) ?? { width: node.width, height: node.height };
}

/** Shared handle hit-testing logic against a known bounding rect. */
function hitTestHandlesAt(
  worldX: number,
  worldY: number,
  absX: number,
  absY: number,
  width: number,
  height: number,
  nodeId: string,
  slotContext?: { instanceId: string; descendantPath: string },
): {
  corner: TransformHandle;
  nodeId: string;
  absX: number;
  absY: number;
  width: number;
  height: number;
  slotContext?: { instanceId: string; descendantPath: string };
} | null {
  const scale = useViewportStore.getState().scale;
  const handleRadius = 6 / scale;

  const corners: Array<{ corner: "tl" | "tr" | "bl" | "br"; cx: number; cy: number }> = [
    { corner: "tl", cx: absX, cy: absY },
    { corner: "tr", cx: absX + width, cy: absY },
    { corner: "bl", cx: absX, cy: absY + height },
    { corner: "br", cx: absX + width, cy: absY + height },
  ];

  for (const { corner, cx, cy } of corners) {
    const dx = worldX - cx;
    const dy = worldY - cy;
    if (Math.abs(dx) <= handleRadius && Math.abs(dy) <= handleRadius) {
      return { corner, nodeId, absX, absY, width, height, slotContext };
    }
  }

  const sideTolerance = handleRadius;
  // On thin nodes (e.g. a single-line text) a fixed exclusion would leave the
  // side handles with no grabbable zone — cap it so the middle third of the
  // edge always engages the side. Corners are checked first and keep priority.
  const vCornerExclusion = Math.min(handleRadius * 2, height / 3);
  const hCornerExclusion = Math.min(handleRadius * 2, width / 3);
  const distLeft = Math.abs(worldX - absX);
  const distRight = Math.abs(worldX - (absX + width));
  const distTop = Math.abs(worldY - absY);
  const distBottom = Math.abs(worldY - (absY + height));

  if (
    distLeft <= sideTolerance &&
    worldY >= absY + vCornerExclusion &&
    worldY <= absY + height - vCornerExclusion
  ) {
    return { corner: "l", nodeId, absX, absY, width, height, slotContext };
  }
  if (
    distRight <= sideTolerance &&
    worldY >= absY + vCornerExclusion &&
    worldY <= absY + height - vCornerExclusion
  ) {
    return { corner: "r", nodeId, absX, absY, width, height, slotContext };
  }
  if (
    distTop <= sideTolerance &&
    worldX >= absX + hCornerExclusion &&
    worldX <= absX + width - hCornerExclusion
  ) {
    return { corner: "t", nodeId, absX, absY, width, height, slotContext };
  }
  if (
    distBottom <= sideTolerance &&
    worldX >= absX + hCornerExclusion &&
    worldX <= absX + width - hCornerExclusion
  ) {
    return { corner: "b", nodeId, absX, absY, width, height, slotContext };
  }

  return null;
}

/**
 * Get the appropriate CSS cursor for a transform handle.
 */
export function getResizeCursor(corner: TransformHandle): string {
  switch (corner) {
    case "tl": case "br": return "nwse-resize";
    case "tr": case "bl": return "nesw-resize";
    case "l": case "r": return "ew-resize";
    case "t": case "b": return "ns-resize";
  }
}

/**
 * Find a tree-based FrameNode by ID in the tree structure.
 */
export function findFrameInTree(nodes: SceneNode[], frameId: string): FrameNode | null {
  for (const node of nodes) {
    if (node.id === frameId && node.type === "frame") return node as FrameNode;
    if (node.type === "frame" || node.type === "group") {
      const children = (node as FrameNode).children;
      if (children) {
        const found = findFrameInTree(children, frameId);
        if (found) return found;
      }
    }
  }
  return null;
}
