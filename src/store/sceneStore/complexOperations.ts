import type {
  FlatSceneNode,
  FrameNode,
  FlatFrameNode,
} from "../../types/scene";
import { generateId, buildTree } from "../../types/scene";
import { useLayoutStore } from "../layoutStore";
import { calculateFrameIntrinsicSize } from "../../utils/yogaLayout";
import { saveHistory } from "./helpers/history";
import type { SceneState } from "./types";

export function createComplexOperations(
  get: () => SceneState,
  setState: (state: Partial<SceneState>) => void,
) {
  return {
    groupNodes: (ids: string[]): string | null => {
      const state = get();
      if (ids.length < 2) return null;

      const calculateLayoutForFrame =
        useLayoutStore.getState().calculateLayoutForFrame;

      // All nodes must share the same parent
      const parentId = state.parentById[ids[0]];
      if (!ids.every((id) => state.parentById[id] === parentId)) return null;

      // Get the actual nodes
      const selectedNodes = ids.map((id) => state.nodesById[id]).filter(Boolean);
      if (selectedNodes.length !== ids.length) return null;

      // If parent is an auto-layout frame, use Yoga-computed positions
      let layoutMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      if (parentId) {
        const parentNode = state.nodesById[parentId];
        if (
          parentNode &&
          parentNode.type === "frame" &&
          (parentNode as FlatFrameNode).layout?.autoLayout
        ) {
          // Build a temporary tree node for Yoga calculation
          const parentTree = buildTree([parentId], state.nodesById, state.childrenById)[0] as FrameNode;
          const layoutNodes = calculateLayoutForFrame(parentTree);
          for (const ln of layoutNodes) {
            layoutMap.set(ln.id, { x: ln.x, y: ln.y, width: ln.width, height: ln.height });
          }
        }
      }

      // Get effective bounds for each node
      function getEffectiveBounds(node: FlatSceneNode): { x: number; y: number; width: number; height: number } {
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

      // Calculate bounding box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const boundsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      for (const node of selectedNodes) {
        const bounds = getEffectiveBounds(node);
        boundsMap.set(node.id, bounds);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      }

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

      // Find insertion index in parent's children
      const parentChildren = parentId !== null && parentId !== undefined
        ? (state.childrenById[parentId] ?? [])
        : state.rootIds;
      const insertIndex = Math.min(
        ...ids.map((id) => parentChildren.indexOf(id)).filter((i) => i >= 0),
      );

      // Build new state
      const newNodesById = { ...state.nodesById, [groupId]: groupNode };
      const newParentById = { ...state.parentById, [groupId]: parentId };
      const newChildrenById = { ...state.childrenById };
      const idSet = new Set(ids);

      // Update each moved node: adjust position relative to group, set parent to group
      for (const id of ids) {
        const bounds = boundsMap.get(id)!;
        const existingNode = newNodesById[id];
        newNodesById[id] = { ...existingNode, x: bounds.x - minX, y: bounds.y - minY, width: bounds.width, height: bounds.height } as FlatSceneNode;
        newParentById[id] = groupId;
      }

      // Set group's children
      newChildrenById[groupId] = ids;

      // Update parent's children: remove grouped nodes, insert group
      let newRootIds = state.rootIds;
      if (parentId !== null && parentId !== undefined) {
        const filtered = (state.childrenById[parentId] ?? []).filter((cid) => !idSet.has(cid));
        filtered.splice(Math.min(insertIndex, filtered.length), 0, groupId);
        newChildrenById[parentId] = filtered;
      } else {
        const filtered = state.rootIds.filter((rid) => !idSet.has(rid));
        filtered.splice(Math.min(insertIndex, filtered.length), 0, groupId);
        newRootIds = filtered;
      }

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

      const calculateLayoutForFrame =
        useLayoutStore.getState().calculateLayoutForFrame;

      // All nodes must share the same parent
      const parentId = state.parentById[ids[0]];
      if (!ids.every((id) => state.parentById[id] === parentId)) return null;

      const selectedNodes = ids.map((id) => state.nodesById[id]).filter(Boolean);
      if (selectedNodes.length !== ids.length) return null;

      // If parent is an auto-layout frame, use Yoga-computed positions
      let layoutMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      if (parentId) {
        const parentNode = state.nodesById[parentId];
        if (
          parentNode &&
          parentNode.type === "frame" &&
          (parentNode as FlatFrameNode).layout?.autoLayout
        ) {
          const parentTree = buildTree([parentId], state.nodesById, state.childrenById)[0] as FrameNode;
          const layoutNodes = calculateLayoutForFrame(parentTree);
          for (const ln of layoutNodes) {
            layoutMap.set(ln.id, { x: ln.x, y: ln.y, width: ln.width, height: ln.height });
          }
        }
      }

      function getEffectiveBounds(node: FlatSceneNode): { x: number; y: number; width: number; height: number } {
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

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const boundsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      for (const node of selectedNodes) {
        const bounds = getEffectiveBounds(node);
        boundsMap.set(node.id, bounds);
        minX = Math.min(minX, bounds.x);
        minY = Math.min(minY, bounds.y);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        maxY = Math.max(maxY, bounds.y + bounds.height);
      }

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

      // Find insertion index
      const parentChildren = parentId !== null && parentId !== undefined
        ? (state.childrenById[parentId] ?? [])
        : state.rootIds;
      const insertIndex = Math.min(
        ...ids.map((id) => parentChildren.indexOf(id)).filter((i) => i >= 0),
      );

      const newNodesById = { ...state.nodesById, [frameId]: frameNode };
      const newParentById = { ...state.parentById, [frameId]: parentId };
      const newChildrenById = { ...state.childrenById };
      const idSet = new Set(ids);

      // Update each wrapped node
      for (const id of ids) {
        const bounds = boundsMap.get(id)!;
        const existingNode = newNodesById[id];
        newNodesById[id] = { ...existingNode, x: bounds.x - minX, y: bounds.y - minY, width: bounds.width, height: bounds.height } as FlatSceneNode;
        newParentById[id] = frameId;
      }

      newChildrenById[frameId] = ids;

      let newRootIds = state.rootIds;
      if (parentId !== null && parentId !== undefined) {
        const filtered = (state.childrenById[parentId] ?? []).filter((cid) => !idSet.has(cid));
        filtered.splice(Math.min(insertIndex, filtered.length), 0, frameId);
        newChildrenById[parentId] = filtered;
      } else {
        const filtered = state.rootIds.filter((rid) => !idSet.has(rid));
        filtered.splice(Math.min(insertIndex, filtered.length), 0, frameId);
        newRootIds = filtered;
      }

      setState({
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      });
      return frameId;
    },
  };
}
