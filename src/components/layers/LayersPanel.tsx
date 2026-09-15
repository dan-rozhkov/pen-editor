import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { StackIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../../store/sceneStore";
import { useSelectionStore } from "../../store/selectionStore";
import { getAncestorIds } from "../../utils/nodeUtils";
import { PanelEmptyState } from "../PanelEmptyState";
import { LayerItem } from "./LayerItem";
import {
  ROW_HEIGHT,
  OVERSCAN,
  flattenLayers,
  selectionFromLayersRef,
  getLayerKey,
  getEmbedElementLayerKey,
} from "./layerTypes";
import type { DragEmbedElement, DragState, DropPosition } from "./layerTypes";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { normalizeShadowPathToSourcePath } from "@/lib/embedLayerTree";
import { reorderEmbedElement } from "./embedLayerActions";

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
  const select = useSelectionStore((state) => state.select);
  const embedPickerSelection = useEmbedPickerStore((state) => state.selection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Canonicalize the picker's (possibly `#id`-anchored) shadow path to the
  // positional `sourcePath` a row's key is built from, ONCE here — not per
  // row in LayerItem, which would re-parse the embed's html on every render
  // of every row under it. `null` (no selection, embed not in the scene, or
  // the path no longer resolves — e.g. `edit_embed_html` ran since the
  // pick) means no row should read as selected.
  const selectedEmbedElement = useMemo(() => {
    if (!embedPickerSelection) return null;
    const embedNode = nodesById[embedPickerSelection.embedId];
    if (embedNode?.type !== "embed") return null;
    const sourcePath = normalizeShadowPathToSourcePath(
      embedPickerSelection.path,
      embedNode.htmlContent ?? "",
    );
    if (sourcePath === null) return null;
    return { embedId: embedPickerSelection.embedId, sourcePath };
  }, [embedPickerSelection, nodesById]);

  // Auto-expand ancestors when selection changes (e.g. from canvas click)
  useEffect(() => {
    if (selectionFromLayersRef.current) {
      selectionFromLayersRef.current = false;
      return;
    }
    if (selectedIds.length === 0 && !selectedEmbedElement) return;

    const idsToExpand: string[] = [];
    for (const id of selectedIds) {
      for (const ancestor of getAncestorIds(parentById, id)) {
        if (!expandedFrameIds.has(ancestor)) {
          idsToExpand.push(ancestor);
        }
      }
    }

    // Auto-expand the embed row and every ancestor element row of a
    // canvas-picked embed element. This is what makes "pick an element on
    // canvas -> its row reveals itself in the panel" work; a pick that
    // originated FROM this panel already returned above via
    // selectionFromLayersRef, so this only ever fires for a canvas pick.
    let embedElementScrollKey: string | null = null;
    if (selectedEmbedElement) {
      const { embedId, sourcePath } = selectedEmbedElement;
      if (!expandedFrameIds.has(embedId)) {
        idsToExpand.push(embedId);
      }
      const segments = sourcePath ? sourcePath.split(" > ") : [];
      for (let i = 0; i < segments.length - 1; i++) {
        const ancestorKey = getEmbedElementLayerKey(embedId, segments.slice(0, i + 1).join(" > "));
        if (!expandedFrameIds.has(ancestorKey)) {
          idsToExpand.push(ancestorKey);
        }
      }
      embedElementScrollKey = getEmbedElementLayerKey(embedId, sourcePath);
    }

    if (idsToExpand.length > 0) {
      expandAncestors(idsToExpand);
    }

    // Scroll first selected node into view after DOM updates
    requestAnimationFrame(() => {
      const selector = embedElementScrollKey
        ? `[data-layer-key="${embedElementScrollKey}"]`
        : `[data-node-id="${selectedIds[0]}"]`;
      const el = scrollRef.current?.querySelector(selector);
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, [
    selectedIds,
    parentById,
    expandedFrameIds,
    expandAncestors,
    selectedEmbedElement,
  ]);

  const [dragState, setDragState] = useState<DragState>({
    draggedId: null,
    dropTargetId: null,
    dropPosition: null,
    dropParentId: null,
    draggedEmbedElement: null,
    dropEmbedElement: null,
  });

  const handleDragStart = useCallback(
    (nodeId: string, embedElementContext?: DragEmbedElement) => {
      select(nodeId);

      setDragState({
        draggedId: nodeId,
        dropTargetId: null,
        dropPosition: null,
        dropParentId: null,
        draggedEmbedElement: embedElementContext ?? null,
        dropEmbedElement: null,
      });
    },
    [select],
  );

  const handleDragOver = useCallback(
    (
      nodeId: string,
      position: DropPosition,
      parentId: string | null,
      embedElementContext?: DragEmbedElement,
    ) => {
      setDragState((prev) => ({
        ...prev,
        dropTargetId: nodeId,
        dropPosition: position,
        dropParentId: parentId,
        dropEmbedElement: embedElementContext ?? null,
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
      draggedEmbedElement: null,
      dropEmbedElement: null,
    });
  }, []);

  const handleDrop = useCallback(() => {
    const {
      draggedId,
      dropTargetId,
      dropPosition,
      dropParentId,
      draggedEmbedElement,
      dropEmbedElement,
    } = dragState;

    // Embed-element reorder: dragging a DOM element row within an embed's
    // `htmlContent`. Handled entirely separately from the native move logic
    // below, which speaks scene node ids and parent/child references that
    // don't exist for a plain DOM element — and rejected outright (rather
    // than falling through) for any mismatched combination: two different
    // embeds, or one native end and one embed-element end.
    if (draggedEmbedElement) {
      if (
        dropEmbedElement &&
        dropPosition &&
        dropEmbedElement.embedId === draggedEmbedElement.embedId &&
        dropEmbedElement.shadowPath !== draggedEmbedElement.shadowPath
      ) {
        reorderEmbedElement(
          draggedEmbedElement.embedId,
          draggedEmbedElement.shadowPath,
          dropEmbedElement.shadowPath,
          dropPosition,
        );
      }
      handleDragEnd();
      return;
    }
    if (dropEmbedElement) {
      // Dragging a native/ref row onto an embed-element row — never legal.
      handleDragEnd();
      return;
    }

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
    () => flattenLayers(reversedNodes, expandedFrameIds, nodesById, childrenById),
    [reversedNodes, expandedFrameIds, nodesById, childrenById],
  );
  // Native-row ids ONLY: `selectionStore.selectRange` slices this array
  // straight into `selectedIds`, which every consumer (deleteNode,
  // groupNodes, alignment, `buildCanvasContext`) expects to be scene-node
  // ids. An embed-element row's key is `embed:<embedId>:<sourcePath>` —
  // never a scene node id — so including those would let a shift-click
  // spanning an expanded embed write keys naming no node into
  // `selectedIds`, which then behave as silent no-ops (or `{ id }` stubs
  // sent to the agent). Element rows are never range-selected in the first
  // place — `LayerItem`'s embed-element click branch never calls
  // `selectRange` — so leaving them out here costs nothing.
  const selectableFlatIds = useMemo(
    () => flatLayers.filter((l) => !l.embedElement).map((l) => getLayerKey(l)),
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
          <PanelEmptyState icon={<StackIcon size={28} weight="light" />}>
            No layers yet
          </PanelEmptyState>
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
                  embedElement={item.embedElement}
                  selectedEmbedElement={selectedEmbedElement}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
