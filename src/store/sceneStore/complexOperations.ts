import type {
  FlatSceneNode,
  FrameNode,
  FlatFrameNode,
  EmbedNode,
  SceneNode,
} from "../../types/scene";
import { generateId, buildTree } from "../../types/scene";
import { convertHtmlToDesignNodes } from "../../lib/htmlToDesignNodes";
import { loadGoogleFontsFromNodes } from "../../utils/fontUtils";
import { useLayoutStore } from "../layoutStore";
import { calculateFrameIntrinsicSize } from "../../utils/yogaLayout";
import { syncTextDimensions } from "./helpers/textSync";
import { saveHistory } from "./helpers/history";
import {
  insertTreeIntoFlat,
  removeNodeAndDescendants,
} from "./helpers/flatStoreHelpers";
import type { SceneState } from "./types";

type Bounds = { x: number; y: number; width: number; height: number };

function syncTextDimensionsInTree(node: SceneNode): SceneNode {
  const synced = node.type === "text" ? syncTextDimensions(node) as SceneNode : node;
  if (synced.type !== "frame" && synced.type !== "group") return synced;
  return {
    ...synced,
    children: synced.children.map((child) => syncTextDimensionsInTree(child)),
  };
}

/** Build a map of Yoga-computed positions for children of an auto-layout parent. */
function buildLayoutMap(
  parentId: string | null | undefined,
  state: SceneState,
): Map<string, Bounds> {
  const layoutMap = new Map<string, Bounds>();
  if (!parentId) return layoutMap;

  const parentNode = state.nodesById[parentId];
  if (
    parentNode &&
    parentNode.type === "frame" &&
    (parentNode as FlatFrameNode).layout?.autoLayout
  ) {
    const calculateLayoutForFrame =
      useLayoutStore.getState().calculateLayoutForFrame;
    const parentTree = buildTree([parentId], state.nodesById, state.childrenById)[0] as FrameNode;
    const layoutNodes = calculateLayoutForFrame(parentTree);
    for (const ln of layoutNodes) {
      layoutMap.set(ln.id, { x: ln.x, y: ln.y, width: ln.width, height: ln.height });
    }
  }
  return layoutMap;
}

/** Get effective bounds for a node, accounting for auto-layout and fit-content frames. */
function getEffectiveBounds(
  node: FlatSceneNode,
  layoutMap: Map<string, Bounds>,
  state: SceneState,
): Bounds {
  const layoutNode = layoutMap.get(node.id);
  const x = layoutNode?.x ?? node.x;
  const y = layoutNode?.y ?? node.y;
  let width = layoutNode?.width ?? node.width;
  let height = layoutNode?.height ?? node.height;

  if (node.type === "frame") {
    const frame = node as FlatFrameNode;
    if (frame.layout?.autoLayout) {
      const fitWidth = frame.sizing?.widthMode === "fit_content";
      const fitHeight = frame.sizing?.heightMode === "fit_content";
      if (fitWidth || fitHeight) {
        const frameTree = buildTree([node.id], state.nodesById, state.childrenById)[0] as FrameNode;
        const intrinsic = calculateFrameIntrinsicSize(frameTree, { fitWidth, fitHeight });
        if (fitWidth) width = intrinsic.width;
        if (fitHeight) height = intrinsic.height;
      }
    }
  }

  return { x, y, width, height };
}

/** Compute bounding box + boundsMap + insertIndex for a set of nodes being wrapped. */
function computeWrappingData(
  ids: string[],
  selectedNodes: FlatSceneNode[],
  parentId: string | null | undefined,
  state: SceneState,
  layoutMap: Map<string, Bounds>,
): { boundsMap: Map<string, Bounds>; minX: number; minY: number; maxX: number; maxY: number; insertIndex: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const boundsMap = new Map<string, Bounds>();
  for (const node of selectedNodes) {
    const bounds = getEffectiveBounds(node, layoutMap, state);
    boundsMap.set(node.id, bounds);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  const parentChildren = parentId !== null && parentId !== undefined
    ? (state.childrenById[parentId] ?? [])
    : state.rootIds;
  const insertIndex = Math.min(
    ...ids.map((id) => parentChildren.indexOf(id)).filter((i) => i >= 0),
  );

  return { boundsMap, minX, minY, maxX, maxY, insertIndex };
}

/** Rebuild nodesById/parentById/childrenById/rootIds after wrapping ids into a new container. */
function applyContainerWrapping(
  ids: string[],
  containerId: string,
  containerNode: FlatSceneNode,
  parentId: string | null | undefined,
  boundsMap: Map<string, Bounds>,
  minX: number,
  minY: number,
  insertIndex: number,
  state: SceneState,
): { newNodesById: Record<string, FlatSceneNode>; newParentById: Record<string, string | null>; newChildrenById: Record<string, string[]>; newRootIds: string[] } {
  const newNodesById = { ...state.nodesById, [containerId]: containerNode };
  const newParentById = { ...state.parentById, [containerId]: parentId ?? null };
  const newChildrenById = { ...state.childrenById };
  const idSet = new Set(ids);

  for (const id of ids) {
    const bounds = boundsMap.get(id)!;
    const existingNode = newNodesById[id];
    newNodesById[id] = { ...existingNode, x: bounds.x - minX, y: bounds.y - minY, width: bounds.width, height: bounds.height } as FlatSceneNode;
    newParentById[id] = containerId;
  }

  newChildrenById[containerId] = ids;

  let newRootIds = state.rootIds;
  if (parentId !== null && parentId !== undefined) {
    const filtered = (state.childrenById[parentId] ?? []).filter((cid) => !idSet.has(cid));
    filtered.splice(Math.min(insertIndex, filtered.length), 0, containerId);
    newChildrenById[parentId] = filtered;
  } else {
    const filtered = state.rootIds.filter((rid) => !idSet.has(rid));
    filtered.splice(Math.min(insertIndex, filtered.length), 0, containerId);
    newRootIds = filtered;
  }

  return { newNodesById, newParentById, newChildrenById, newRootIds };
}

export function createComplexOperations(
  get: () => SceneState,
  setState: (state: Partial<SceneState>) => void,
) {
  return {
    groupNodes: (ids: string[]): string | null => {
      const state = get();
      if (ids.length < 2) return null;

      // All nodes must share the same parent
      const parentId = state.parentById[ids[0]];
      if (!ids.every((id) => state.parentById[id] === parentId)) return null;

      // Get the actual nodes
      const selectedNodes = ids.map((id) => state.nodesById[id]).filter(Boolean);
      if (selectedNodes.length !== ids.length) return null;

      const layoutMap = buildLayoutMap(parentId, state);
      const { boundsMap, minX, minY, maxX, maxY, insertIndex } =
        computeWrappingData(ids, selectedNodes, parentId, state, layoutMap);

      saveHistory(state);

      const groupId = generateId();
      const groupNode: FlatSceneNode = {
        id: groupId,
        type: "group" as const,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };

      const { newNodesById, newParentById, newChildrenById, newRootIds } =
        applyContainerWrapping(ids, groupId, groupNode, parentId, boundsMap, minX, minY, insertIndex, state);

      setState({
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      });
      return groupId;
    },

    ungroupNodes: (ids: string[]): string[] => {
      const state = get();
      const childIds: string[] = [];

      saveHistory(state);

      const newNodesById = { ...state.nodesById };
      const newParentById = { ...state.parentById };
      const newChildrenById = { ...state.childrenById };
      let newRootIds = [...state.rootIds];

      for (const id of ids) {
        const node = state.nodesById[id];
        if (!node || node.type !== "group") continue;
        const group = node;

        const groupParentId = state.parentById[id];
        const groupChildIds = state.childrenById[id] ?? [];

        // Adjust children positions to be absolute
        for (const childId of groupChildIds) {
          const child = newNodesById[childId];
          if (child) {
            newNodesById[childId] = {
              ...child,
              x: child.x + group.x,
              y: child.y + group.y,
            } as FlatSceneNode;
            newParentById[childId] = groupParentId;
            childIds.push(childId);
          }
        }

        // Replace group with its children in parent
        if (groupParentId !== null && groupParentId !== undefined) {
          const parentChildList = newChildrenById[groupParentId] ?? [];
          const idx = parentChildList.indexOf(id);
          if (idx >= 0) {
            const updated = [...parentChildList];
            updated.splice(idx, 1, ...groupChildIds);
            newChildrenById[groupParentId] = updated;
          }
        } else {
          const idx = newRootIds.indexOf(id);
          if (idx >= 0) {
            newRootIds.splice(idx, 1, ...groupChildIds);
          }
        }

        // Remove the group node itself
        delete newNodesById[id];
        delete newParentById[id];
        delete newChildrenById[id];
      }

      setState({
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      });
      return childIds;
    },

    convertNodeType: (id: string): boolean => {
      const state = get();
      const node = state.nodesById[id];
      if (!node) return false;

      saveHistory(state);

      if (node.type === "group") {
        // Group -> Frame
        const frame: FlatSceneNode = {
          id: node.id,
          type: "frame" as const,
          name: node.name,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          visible: node.visible,
          enabled: node.enabled,
          sizing: node.sizing,
          fillBinding: node.fillBinding,
          strokeBinding: node.strokeBinding,
          rotation: node.rotation,
          opacity: node.opacity,
          fillOpacity: node.fillOpacity,
          strokeOpacity: node.strokeOpacity,
          flipX: node.flipX,
          flipY: node.flipY,
          imageFill: node.imageFill,
        };
        setState({
          nodesById: { ...state.nodesById, [id]: frame },
          _cachedTree: null,
        });
        return true;
      }

      if (node.type === "frame") {
        const frame = node as FlatFrameNode;
        if (frame.reusable) return false;

        const group: FlatSceneNode = {
          id: node.id,
          type: "group" as const,
          name: node.name,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth,
          visible: node.visible,
          enabled: node.enabled,
          sizing: node.sizing,
          fillBinding: node.fillBinding,
          strokeBinding: node.strokeBinding,
          rotation: node.rotation,
          opacity: node.opacity,
          fillOpacity: node.fillOpacity,
          strokeOpacity: node.strokeOpacity,
          flipX: node.flipX,
          flipY: node.flipY,
          imageFill: node.imageFill,
        };
        setState({
          nodesById: { ...state.nodesById, [id]: group },
          _cachedTree: null,
        });
        return true;
      }

      return false;
    },

    wrapInAutoLayoutFrame: (ids: string[]): string | null => {
      const state = get();
      if (ids.length < 1) return null;

      // All nodes must share the same parent
      const parentId = state.parentById[ids[0]];
      if (!ids.every((id) => state.parentById[id] === parentId)) return null;

      const selectedNodes = ids.map((id) => state.nodesById[id]).filter(Boolean);
      if (selectedNodes.length !== ids.length) return null;

      const layoutMap = buildLayoutMap(parentId, state);
      const { boundsMap, minX, minY, maxX, maxY, insertIndex } =
        computeWrappingData(ids, selectedNodes, parentId, state, layoutMap);

      saveHistory(state);

      const frameId = generateId();
      const frameNode: FlatSceneNode = {
        id: frameId,
        type: "frame" as const,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        fill: "#ffffff",
        stroke: "#cccccc",
        strokeWidth: 1,
        layout: {
          autoLayout: true,
          flexDirection: "column",
          gap: 0,
          paddingTop: 0,
          paddingRight: 0,
          paddingBottom: 0,
          paddingLeft: 0,
        },
      };

      const { newNodesById, newParentById, newChildrenById, newRootIds } =
        applyContainerWrapping(ids, frameId, frameNode, parentId, boundsMap, minX, minY, insertIndex, state);

      setState({
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      });
      return frameId;
    },

    convertEmbedToDesign: async (id: string): Promise<string | null> => {
      const preState = get();
      const node = preState.nodesById[id];
      if (!node || node.type !== "embed") return null;

      const embed = node as EmbedNode;

      // Convert HTML to design nodes (async — re-read state after)
      const convertedRoot = await convertHtmlToDesignNodes(
        embed.htmlContent,
        embed.width,
        embed.height,
      );
      const rootFrame = syncTextDimensionsInTree(convertedRoot) as FrameNode;

      // Position at original embed location
      rootFrame.x = embed.x;
      rootFrame.y = embed.y;
      if (embed.name) rootFrame.name = embed.name;

      // Re-read state after async gap to avoid stale snapshot
      const state = get();
      saveHistory(state);

      // Determine embed's parent and position
      const parentId = state.parentById[id];
      const parentChildren = parentId != null
        ? (state.childrenById[parentId] ?? [])
        : state.rootIds;
      const embedIndex = parentChildren.indexOf(id);

      // Build new state: remove embed, insert frame tree
      const newNodesById = { ...state.nodesById };
      const newParentById = { ...state.parentById };
      const newChildrenById = { ...state.childrenById };

      removeNodeAndDescendants(id, newNodesById, newParentById, newChildrenById);
      insertTreeIntoFlat(rootFrame, parentId ?? null, newNodesById, newParentById, newChildrenById);

      // Replace embed in parent's children list
      let newRootIds = state.rootIds;
      if (parentId != null) {
        const updated = [...parentChildren];
        if (embedIndex >= 0) {
          updated.splice(embedIndex, 1, rootFrame.id);
        }
        newChildrenById[parentId] = updated;
      } else {
        newRootIds = [...state.rootIds];
        if (embedIndex >= 0) {
          newRootIds.splice(embedIndex, 1, rootFrame.id);
        }
      }

      setState({
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      });

      // Ensure text nodes converted from HTML load their Google Fonts.
      loadGoogleFontsFromNodes([rootFrame]);

      return rootFrame.id;
    },
  };
}
