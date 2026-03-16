import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { useSceneStore } from "../../store/sceneStore";
import { useSelectionStore } from "../../store/selectionStore";
import { getAncestorIds } from "../../utils/nodeUtils";
import { findNodeByPath } from "../../utils/instanceRuntime";
import { findComponentById } from "../../utils/nodeUtils";
import type { FlatFrameNode, FrameNode, RefNode, SceneNode } from "../../types/scene";
import { buildTree } from "../../types/scene";
import { createRefFromComponent } from "../../utils/componentUtils";
import { deepCloneNode } from "../../utils/cloneNode";
import { LayerItem } from "./LayerItem";
import {
  ROW_HEIGHT,
  OVERSCAN,
  flattenLayers,
  selectionFromLayersRef,
  getLayerKey,
} from "./layerTypes";
import type { DragState, DropPosition } from "./layerTypes";

export function LayersPanel() {
  const nodes = useSceneStore((state) => state.getNodes());
  const expandedFrameIds = useSceneStore((state) => state.expandedFrameIds);
  const moveNode = useSceneStore((state) => state.moveNode);
  const setFrameExpanded = useSceneStore((state) => state.setFrameExpanded);
  const expandAncestors = useSceneStore((state) => state.expandAncestors);
  const parentById = useSceneStore((state) => state.parentById);
  const childrenById = useSceneStore((state) => state.childrenById);
  const nodesById = useSceneStore((state) => state.nodesById);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const instanceContext = useSelectionStore((state) => state.instanceContext);
  const select = useSelectionStore((state) => state.select);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Auto-expand ancestors when selection changes (e.g. from canvas click)
  useEffect(() => {
    if (selectionFromLayersRef.current) {
      selectionFromLayersRef.current = false;
      return;
    }
    if (selectedIds.length === 0) return;

    const idsToExpand: string[] = [];
    for (const id of selectedIds) {
      for (const ancestor of getAncestorIds(parentById, id)) {
        if (!expandedFrameIds.has(ancestor)) {
          idsToExpand.push(ancestor);
        }
      }
    }

    // Auto-expand ref node and its descendant containers when instanceContext is active
    if (instanceContext) {
      const { instanceId, descendantPath } = instanceContext;
      if (!expandedFrameIds.has(instanceId)) {
        idsToExpand.push(instanceId);
      }
      // Expand intermediate containers within the ref tree
      const segments = descendantPath.split("/");
      for (let i = 1; i < segments.length; i++) {
        const partialPath = segments.slice(0, i).join("/");
        const expandKey = `${instanceId}:${partialPath}`;
        if (!expandedFrameIds.has(expandKey)) {
          idsToExpand.push(expandKey);
        }
      }
    }

    if (idsToExpand.length > 0) {
      expandAncestors(idsToExpand);
    }

    // Scroll first selected node into view after DOM updates
    requestAnimationFrame(() => {
      let selector: string;
      if (instanceContext) {
        selector = `[data-layer-key="${instanceContext.instanceId}:${instanceContext.descendantPath}"]`;
      } else {
        selector = `[data-node-id="${selectedIds[0]}"]`;
      }
      const el = scrollRef.current?.querySelector(selector);
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [selectedIds, instanceContext, parentById, expandedFrameIds, expandAncestors]);

  const [dragState, setDragState] = useState<DragState>({
    draggedId: null,
    dropTargetId: null,
    dropPosition: null,
    dropParentId: null,
  });

  const handleDragStart = useCallback(
    (nodeId: string) => {
      select(nodeId);

      setDragState({
        draggedId: nodeId,
        dropTargetId: null,
        dropPosition: null,
        dropParentId: null,
      });
    },
    [select],
  );

  const handleDragOver = useCallback(
    (nodeId: string, position: DropPosition, parentId: string | null, instanceId?: string, descendantPath?: string) => {
      setDragState((prev) => ({
        ...prev,
        dropTargetId: nodeId,
        dropPosition: position,
        dropParentId: parentId,
        dropInstanceId: instanceId ?? null,
        dropDescendantPath: descendantPath ?? null,
      }));
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDragState({
      draggedId: null,
      dropTargetId: null,
      dropPosition: null,
      dropParentId: null,
    });
  }, []);

  const replaceInstanceNode = useSceneStore((state) => state.replaceInstanceNode);
  const deleteNode = useSceneStore((state) => state.deleteNode);

  const handleDrop = useCallback(() => {
    const { draggedId, dropTargetId, dropPosition, dropParentId, dropInstanceId, dropDescendantPath } = dragState;

    if (!draggedId || !dropTargetId || !dropPosition) {
      handleDragEnd();
      return;
    }

    if (draggedId === dropTargetId) {
      handleDragEnd();
      return;
    }

    // Drop into a slot inside an instance — create a replace override
    if (dropInstanceId && dropDescendantPath && dropPosition === "inside") {
      const state = useSceneStore.getState();
      const instance = state.nodesById[dropInstanceId] as RefNode | undefined;
      const draggedNode = state.nodesById[draggedId];
      if (instance?.type === "ref" && draggedNode) {
        const allNodes = state.getNodes();
        const component = findComponentById(allNodes, instance.componentId);
        if (component) {
          const slotFrame = findNodeByPath(component.children, dropDescendantPath);
          if (slotFrame?.type === "frame") {
            // If dragging a reusable component, create a ref to it (don't clone the definition)
            let nodeToInsert: SceneNode;
            let shouldDelete = true;
            if (draggedNode.type === "frame" && (draggedNode as FlatFrameNode).reusable) {
              nodeToInsert = createRefFromComponent(draggedId, draggedNode.width, draggedNode.height);
              shouldDelete = false; // Don't delete the component definition
            } else {
              const draggedTree = buildTree([draggedId], state.nodesById, state.childrenById)[0];
              if (!draggedTree) { handleDragEnd(); return; }
              nodeToInsert = deepCloneNode(draggedTree);
              nodeToInsert.x = 0;
              nodeToInsert.y = 0;
            }
            // Preserve existing override children
            const currentOverride = instance.overrides?.[dropDescendantPath];
            const baseFrame = currentOverride?.kind === "replace"
              ? currentOverride.node as FrameNode
              : slotFrame as FrameNode;
            const replacement: FrameNode = {
              ...baseFrame,
              children: [...baseFrame.children, nodeToInsert],
            };
            replaceInstanceNode(dropInstanceId, dropDescendantPath, replacement);
            if (shouldDelete) deleteNode(draggedId);
            handleDragEnd();
            return;
          }
        }
      }
      handleDragEnd();
      return;
    }

    let newParentId: string | null;
    let newIndex: number;

    if (dropPosition === "inside") {
      newParentId = dropTargetId;
      newIndex = 0;
      setFrameExpanded(dropTargetId, true);
    } else {
      newParentId = dropParentId;
      const siblingIds = dropParentId === null
        ? useSceneStore.getState().rootIds
        : childrenById[dropParentId] ?? [];
      const targetIndex = siblingIds.indexOf(dropTargetId);

      if (dropPosition === "before") {
        newIndex = targetIndex;
      } else {
        newIndex = targetIndex + 1;
      }
    }

    moveNode(draggedId, newParentId, newIndex);
    handleDragEnd();
  }, [dragState, childrenById, moveNode, setFrameExpanded, handleDragEnd, replaceInstanceNode, deleteNode]);

  // Reverse the nodes array so that top items in the list appear on top visually (higher z-index)
  const reversedNodes = useMemo(() => [...nodes].reverse(), [nodes]);
  const flatLayers = useMemo(
    () => flattenLayers(reversedNodes, expandedFrameIds, nodesById, childrenById),
    [reversedNodes, expandedFrameIds, nodesById, childrenById],
  );
  const selectableFlatIds = useMemo(
    () => flatLayers.map((l) => getLayerKey(l)),
    [flatLayers],
  );
  const totalHeight = flatLayers.length * ROW_HEIGHT;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => setScrollTop(el.scrollTop);
    handleScroll();
    el.addEventListener("scroll", handleScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, []);

  // Shift+wheel → horizontal scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey && e.deltaY && !e.deltaX) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const handleAutoScroll = useCallback(
    (e: React.DragEvent) => {
      if (!dragState.draggedId) return;
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const threshold = 32;
      const speed = 12;
      if (e.clientY < rect.top + threshold) {
        el.scrollTop = Math.max(0, el.scrollTop - speed);
      } else if (e.clientY > rect.bottom - threshold) {
        el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + speed);
      }
    },
    [dragState.draggedId],
  );

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    flatLayers.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleItems = flatLayers.slice(startIndex, endIndex);
  const translateY = startIndex * ROW_HEIGHT;

  return (
    <div className="group/layers h-full bg-surface-panel flex flex-col select-none overflow-hidden">
      <div
        className="layers-scrollbar flex-1 overflow-auto"
        onDragEnd={handleDragEnd}
        onDragOver={handleAutoScroll}
        ref={scrollRef}
      >
        {reversedNodes.length === 0 ? (
          <div className="text-text-disabled text-xs text-center p-5">
            No layers yet
          </div>
        ) : (
          <div style={{ height: totalHeight + 8, position: "relative", display: "inline-block", minWidth: "100%", paddingTop: 8 }}>
            <div style={{ transform: `translateY(${translateY}px)` }}>
              {visibleItems.map((item) => (
                <LayerItem
                  key={getLayerKey(item)}
                  node={item.node}
                  depth={item.depth}
                  parentId={item.parentId}
                  dragState={dragState}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  selectableFlatIds={selectableFlatIds}
                  instanceId={item.instanceId}
                  descendantPath={item.descendantPath}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
