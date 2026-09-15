import type { SceneNode, FlatSceneNode } from "../../types/scene";
import { isContainerNode } from "../../types/scene";
import { getNodeDisplayName } from "@/utils/nodeDisplay";
import { getEmbedLayerTree } from "@/lib/embedLayerTree";
import type { EmbedElementLayer } from "@/lib/embedLayerTree";

export type DropPosition = "before" | "after" | "inside" | null;

/** Identifies one embed-element row for drag purposes — the owning embed's
 * id and the element's shadow path (the form `embedLayerActions.ts`'s
 * mutations take; the panel's expand/selection key is `sourcePath`-keyed
 * instead, via `getEmbedElementLayerKey`). */
export interface DragEmbedElement {
  embedId: string;
  shadowPath: string;
}

export interface DragState {
  draggedId: string | null;
  dropTargetId: string | null;
  dropPosition: DropPosition;
  dropParentId: string | null;
  /** Set alongside `draggedId` (which gets the owning embed's node id) when
   * the dragged row is an embed-element row — a move within an embed needs
   * the element's shadow path too, which no scene node id can express. */
  draggedEmbedElement?: DragEmbedElement | null;
  /** Set when the current drop target is an embed-element row. Reordering
   * only proceeds when this and `draggedEmbedElement` name the SAME embed —
   * see `LayersPanel.handleDrop`'s embed-element branch — so a native/ref
   * row dragged over an embed row (or vice versa, or across two different
   * embeds) is rejected rather than falling into the native move path. */
  dropEmbedElement?: DragEmbedElement | null;
}

export interface FlattenedLayer {
  node: SceneNode;
  depth: number;
  parentId: string | null;
  /** Set on embed-element layers — a row for one DOM element inside an
   * `embed` node's `htmlContent`. `node` above stays the OWNING embed's
   * `SceneNode` for these rows (never the DOM element, which isn't a
   * `SceneNode` at all) so nothing that reads `layer.node` — display name
   * fallbacks, icon lookups elsewhere, etc — has to special-case this kind
   * of row to avoid crashing; `LayerItem` reads `embedElement` first for
   * anything that actually needs the DOM element's own identity. */
  embedElement?: { embedId: string; element: EmbedElementLayer };
}

export const ROW_HEIGHT = 28;
export const OVERSCAN = 8;

export const getDisplayName = getNodeDisplayName;

/** Shared ref so LayerItem can signal that selection originated from layers panel */
export const selectionFromLayersRef = { current: false };

/** Key format shared by `getLayerKey` and `LayerItem`/`LayersPanel` (which
 * need to compute the same key for a row they don't have a `FlattenedLayer`
 * object for — e.g. the selected embed element, or an ancestor to expand). */
export function getEmbedElementLayerKey(embedId: string, sourcePath: string): string {
  return `embed:${embedId}:${sourcePath}`;
}

/** Unique key for a flattened layer (used for expand tracking and React keys) */
export function getLayerKey(layer: FlattenedLayer): string {
  if (layer.embedElement) {
    return getEmbedElementLayerKey(layer.embedElement.embedId, layer.embedElement.element.sourcePath);
  }
  return layer.node.id;
}

/**
 * Flatten an embed's parsed element tree into panel rows, in DOCUMENT order
 * — deliberately NOT reversed the way native/ref children are in
 * `flattenLayersRec`/`flattenRefChildren` below. Those are z-stacks (the
 * scene's paint order), so the panel lists them bottom-to-top to match "top
 * row = what's on top". An embed's DOM is a document flow, not a z-stack:
 * reading order is what a designer expects here, and HTML paint order is
 * governed by stacking context, not document order, so reversing wouldn't
 * even correspond to "what's on top" the way it does for the native scene.
 *
 * `parentId` is always the owning embed's id, at every depth — these rows
 * have no scene-graph parent of their own to point at (see
 * `FlattenedLayer.embedElement`'s doc comment), and nothing currently reads
 * a nested embed-element row's `parentId` for anything besides "which embed
 * does this belong to".
 */
function flattenEmbedElements(
  elements: EmbedElementLayer[],
  embedId: string,
  embedNode: SceneNode,
  expandedFrameIds: Set<string>,
  depth: number,
  out: FlattenedLayer[],
): void {
  for (const element of elements) {
    out.push({
      node: embedNode,
      depth,
      parentId: embedId,
      embedElement: { embedId, element },
    });

    const key = getEmbedElementLayerKey(embedId, element.sourcePath);
    if (element.children.length > 0 && expandedFrameIds.has(key)) {
      flattenEmbedElements(element.children, embedId, embedNode, expandedFrameIds, depth + 1, out);
    }
  }
}

function flattenLayersRec(
  nodes: SceneNode[],
  expandedFrameIds: Set<string>,
  nodesById: Record<string, FlatSceneNode> | undefined,
  childrenById: Record<string, string[]> | undefined,
  depth: number,
  parentId: string | null,
  out: FlattenedLayer[],
): void {
  for (const node of nodes) {
    out.push({ node, depth, parentId });

    if (isContainerNode(node) && expandedFrameIds.has(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        flattenLayersRec([node.children[i]], expandedFrameIds, nodesById, childrenById, depth + 1, node.id, out);
      }
    } else if (node.type === "embed" && expandedFrameIds.has(node.id)) {
      const tree = getEmbedLayerTree(node.htmlContent ?? "");
      if (tree.length > 0) {
        flattenEmbedElements(tree, node.id, node, expandedFrameIds, depth + 1, out);
      }
    }
  }
}

export function flattenLayers(
  nodes: SceneNode[],
  expandedFrameIds: Set<string>,
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
): FlattenedLayer[] {
  const out: FlattenedLayer[] = [];
  flattenLayersRec(nodes, expandedFrameIds, nodesById, childrenById, 0, null, out);
  return out;
}
