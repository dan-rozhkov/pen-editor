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
import { LayerItem } from "./LayerItem";
import {
  ROW_HEIGHT,
  OVERSCAN,
  flattenLayers,
  selectionFromLayersRef,
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
  const selectedIds = useSelectionStore((state) => state.selectedIds);
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

    if (idsToExpand.length > 0) {
      expandAncestors(idsToExpand);
    }

    // Scroll first selected node into view after DOM updates
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(
        `[data-node-id="${selectedIds[0]}"]`,
      );
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [selectedIds, parentById, expandedFrameIds, expandAncestors]);

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
    (nodeId: string, position: DropPosition, parentId: string | null) => {
      setDragState((prev) => ({
        ...prev,
        dropTargetId: nodeId,
        dropPosition: position,
        dropParentId: parentId,
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

  const handleDrop = useCallback(() => {
    const { draggedId, dropTargetId, dropPosition, dropParentId } = dragState;

    if (!draggedId || !dropTargetId || !dropPosition) {
      handleDragEnd();
      return;
    }

    if (draggedId === dropTargetId) {
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
  }, [dragState, childrenById, moveNode, setFrameExpanded, handleDragEnd]);

  // Reverse the nodes array so that top items in the list appear on top visually (higher z-index)
  const reversedNodes = useMemo(() => [...nodes].reverse(), [nodes]);
  const flatLayers = useMemo(
    () => flattenLayers(reversedNodes, expandedFrameIds),
    [reversedNodes, expandedFrameIds],
  );
  const selectableFlatIds = useMemo(
    () => flatLayers.map((l) => l.node.id),
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
                  key={item.node.id}
                  node={item.node}
                  depth={item.depth}
                  parentId={item.parentId}
                  dragState={dragState}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  selectableFlatIds={selectableFlatIds}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
