import type {
  FlatSceneNode,
  FrameNode,
  FlatFrameNode,
  EmbedNode,
  SceneNode,
} from "../../types/scene";
import { generateId, buildTree } from "../../types/scene";
import { convertHtmlToDesignNodes } from "../../lib/htmlToDesign";
import { convertDesignNodesToHtml } from "../../lib/designToHtml";
import { loadGoogleFontsFromNodes } from "../../utils/fontUtils";
import { useLayoutStore } from "../layoutStore";
import { calculateFrameIntrinsicSize, calculateFrameLayout } from "../../utils/yogaLayout";
import { saveHistory } from "./helpers/history";
import {
  insertTreeIntoFlat,
  removeNodeAndDescendants,
} from "./helpers/flatStoreHelpers";
import type { SceneState } from "./types";

type Bounds = { x: number; y: number; width: number; height: number };

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

      // Check if any node is actually ungroupable before saving history
      const ungroupableTypes = new Set(["group", "frame"]);
      const hasUngroupable = ids.some((id) => {
        const node = state.nodesById[id];
        return node && ungroupableTypes.has(node.type);
      });
      if (!hasUngroupable) return childIds;

      saveHistory(state);

      const newNodesById = { ...state.nodesById };
      const newParentById = { ...state.parentById };
      const newChildrenById = { ...state.childrenById };
      let newRootIds = [...state.rootIds];

      for (const id of ids) {
        const node = state.nodesById[id];
        if (!node || !ungroupableTypes.has(node.type)) continue;

        const containerParentId = state.parentById[id];
        const containerChildIds = state.childrenById[id] ?? [];

        // For auto-layout frames, compute yoga positions for children
        // since their stored x/y don't reflect visual positions
        let yogaPositions: Map<string, { x: number; y: number }> | null = null;
        if (node.type === "frame" && (node as FlatFrameNode).layout?.autoLayout) {
          // Build a tree node for yoga calculation
          const treeChildren: SceneNode[] = containerChildIds
            .map((cid) => {
              const cn = newNodesById[cid];
              if (!cn) return null;
              // For frame children, build subtree recursively
              if (cn.type === "frame" || cn.type === "group") {
                const subChildIds = newChildrenById[cid] ?? [];
                return { ...cn, children: subChildIds.map((scid) => newNodesById[scid]).filter(Boolean) } as SceneNode;
              }
              return cn as SceneNode;
            })
            .filter(Boolean) as SceneNode[];

          const treeFrame: FrameNode = {
            ...(node as FlatFrameNode),
            children: treeChildren,
          } as FrameNode;

          const layoutResults = calculateFrameLayout(treeFrame);
          if (layoutResults.length > 0) {
            yogaPositions = new Map();
            for (const result of layoutResults) {
              yogaPositions.set(result.id, { x: result.x, y: result.y });
            }
          }
        }

        // Adjust children positions: convert from container-local to parent-local
        for (const childId of containerChildIds) {
          const child = newNodesById[childId];
          if (child) {
            // Use yoga-computed position if available, otherwise use stored x/y
            const childX = yogaPositions?.get(childId)?.x ?? child.x;
            const childY = yogaPositions?.get(childId)?.y ?? child.y;

            newNodesById[childId] = {
              ...child,
              x: childX + node.x,
              y: childY + node.y,
            } as FlatSceneNode;
            newParentById[childId] = containerParentId;
            childIds.push(childId);
          }
        }

        // Replace container with its children in parent
        if (containerParentId !== null && containerParentId !== undefined) {
          const parentChildList = newChildrenById[containerParentId] ?? [];
          const idx = parentChildList.indexOf(id);
          if (idx >= 0) {
            const updated = [...parentChildList];
            updated.splice(idx, 1, ...containerChildIds);
            newChildrenById[containerParentId] = updated;
          }
        } else {
          const idx = newRootIds.indexOf(id);
          if (idx >= 0) {
            newRootIds.splice(idx, 1, ...containerChildIds);
          }
        }

        // Remove the container node itself
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
      const rootFrame = convertedRoot as FrameNode;

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

    convertDesignToEmbed: (id: string, options?: { isComponent?: boolean }): string | null => {
      const state = get();
      const node = state.nodesById[id];
      if (!node || (node.type !== "frame" && node.type !== "group")) return null;

      // Build full tree for resolving refs
      const allNodes = state.getNodes();

      // Generate HTML from the design node
      const htmlContent = convertDesignNodesToHtml(
        id,
        state.nodesById,
        state.childrenById,
        allNodes,
      );

      saveHistory(state);

      // Determine node's parent and position in sibling list
      const parentId = state.parentById[id];
      const parentChildren = parentId != null
        ? (state.childrenById[parentId] ?? [])
        : state.rootIds;
      const nodeIndex = parentChildren.indexOf(id);

      // Create EmbedNode with same position/size
      const embedId = generateId();
      const embedNode: EmbedNode = {
        id: embedId,
        type: "embed",
        name: node.name ?? "Embed",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        sizing: node.sizing,
        htmlContent,
        ...(options?.isComponent ? { isComponent: true } : {}),
      };

      // Build new state: remove frame tree, insert embed
      const newNodesById = { ...state.nodesById };
      const newParentById = { ...state.parentById };
      const newChildrenById = { ...state.childrenById };

      removeNodeAndDescendants(id, newNodesById, newParentById, newChildrenById);

      // Insert embed node
      newNodesById[embedId] = embedNode;
      newParentById[embedId] = parentId ?? null;

      // Replace frame in parent's children list
      let newRootIds = state.rootIds;
      if (parentId != null) {
        const updated = [...parentChildren];
        if (nodeIndex >= 0) {
          updated.splice(nodeIndex, 1, embedId);
        }
        newChildrenById[parentId] = updated;
      } else {
        newRootIds = [...state.rootIds];
        if (nodeIndex >= 0) {
          newRootIds.splice(nodeIndex, 1, embedId);
        }
      }

      setState({
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      });

      return embedId;
    },
  };
}
