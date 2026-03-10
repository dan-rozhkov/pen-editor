import { useState, useRef, useEffect, memo } from "react";
import clsx from "clsx";
import { useSceneStore } from "../../store/sceneStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useHoverStore } from "../../store/hoverStore";
import type { SceneNode, FrameNode, GroupNode, EmbedNode } from "../../types/scene";
import { NodeIcon, EyeIcon, ChevronIcon } from "./LayerIcons";
import { getDisplayName, selectionFromLayersRef } from "./layerTypes";
import type { DragState, DropPosition } from "./layerTypes";

export interface LayerItemProps {
  node: SceneNode;
  depth: number;
  parentId: string | null;
  dragState: DragState;
  onDragStart: (nodeId: string) => void;
  onDragOver: (
    nodeId: string,
    position: DropPosition,
    parentId: string | null,
  ) => void;
  onDrop: () => void;
  selectableFlatIds: string[];
}

export const LayerItem = memo(function LayerItem({
  node,
  depth,
  parentId,
  dragState,
  onDragStart,
  onDragOver,
  onDrop,
  selectableFlatIds,
}: LayerItemProps) {
  const isSelected = useSelectionStore((s) => s.selectedIds.includes(node.id));
  const toggleVisibility = useSceneStore((state) => state.toggleVisibility);
  const expandedFrameIds = useSceneStore((state) => state.expandedFrameIds);
  const toggleFrameExpanded = useSceneStore(
    (state) => state.toggleFrameExpanded,
  );
  const updateNode = useSceneStore((state) => state.updateNode);

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const isVisible = node.visible !== false;
  const isFrame = node.type === "frame" || node.type === "group";
  const hasChildren =
    isFrame && (node as FrameNode | GroupNode).children.length > 0;
  const isExpanded = expandedFrameIds.has(node.id);
  const isDragging = dragState.draggedId === node.id;
  const isDropTarget = dragState.dropTargetId === node.id;

  const handleClick = (e: React.MouseEvent) => {
    selectionFromLayersRef.current = true;
    const selState = useSelectionStore.getState();
    if (e.shiftKey && selState.lastSelectedId) {
      selState.selectRange(selState.lastSelectedId, node.id, selectableFlatIds);
    } else if (e.shiftKey) {
      selState.addToSelection(node.id);
    } else {
      selState.select(node.id);
    }
  };

  const handleVisibilityClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleVisibility(node.id);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFrameExpanded(node.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(getDisplayName(node));
    setIsEditing(true);
  };

  const handleNameSubmit = () => {
    const trimmed = editName.trim();
    if (trimmed) {
      updateNode(node.id, { name: trimmed });
    }
    setIsEditing(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  const handleNameBlur = () => {
    handleNameSubmit();
  };

  const handleMouseEnter = () => {
    useHoverStore.getState().setHoveredNode(node.id);
  };

  const handleMouseLeave = () => {
    useHoverStore.getState().setHoveredNode(null);
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
    onDragStart(node.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    let position: DropPosition;
    if (isFrame && y > height * 0.25 && y < height * 0.75) {
      position = "inside";
    } else if (y < height / 2) {
      position = "before";
    } else {
      position = "after";
    }

    onDragOver(node.id, position, parentId);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop();
  };

  const displayName = getDisplayName(node);

  return (
    <div
        data-node-id={node.id}
        className={clsx(
          "group flex items-center cursor-pointer h-[28px]",
          isSelected
            ? "bg-accent-selection hover:bg-accent-selection/80"
            : "hover:bg-surface-elevated",
          isDragging && "opacity-50",
          isDropTarget &&
            dragState.dropPosition === "before" &&
            "border-t-2 border-accent-bright",
          isDropTarget &&
            dragState.dropPosition === "after" &&
            "border-b-2 border-accent-bright",
          isDropTarget &&
            dragState.dropPosition === "inside" &&
            "bg-accent-selection/50",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 flex-1">
          {hasChildren ? (
            <button
              className="bg-transparent border-none cursor-pointer p-0.5 flex items-center justify-center rounded hover:bg-white/10 opacity-0 group-hover/layers:opacity-100"
              onClick={handleChevronClick}
            >
              <ChevronIcon expanded={isExpanded} />
            </button>
          ) : (
            <div className="w-4" />
          )}
          <NodeIcon
            type={node.type}
            isComponent={
              node.type === "embed" && (node as EmbedNode).isComponent === true
            }
            layout={
              node.type === "frame" ? (node as FrameNode).layout : undefined
            }
          />
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={handleNameBlur}
              onClick={(e) => e.stopPropagation()}
              className={clsx(
                "text-xs bg-transparent border border-accent-bright rounded px-1 py-0.5 outline-none min-w-0 flex-1",
                "text-text-secondary",
              )}
            />
          ) : (
            <span
              className={clsx(
                "text-xs whitespace-nowrap text-text-secondary",
                !isVisible && "opacity-50",
              )}
              onDoubleClick={handleDoubleClick}
            >
              {displayName}
            </span>
          )}
        </div>
        <div
          className="sticky right-0 shrink-0 flex items-center pl-2 pr-3"
          style={{ backgroundColor: "inherit" }}
        >
          <button
            className={clsx(
              "bg-transparent border-none cursor-pointer p-1 flex items-center justify-center rounded group-hover:opacity-100 opacity-0",
            )}
            onClick={handleVisibilityClick}
            title={isVisible ? "Hide layer" : "Show layer"}
          >
            <EyeIcon visible={isVisible} />
          </button>
        </div>
    </div>
  );
});
