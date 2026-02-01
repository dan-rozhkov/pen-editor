import { useState, useCallback, useRef, useEffect } from "react";
import {
  DiamondsFourIcon,
  RectangleIcon,
  CircleIcon,
  TextTIcon,
  DiamondIcon,
  EyeIcon as EyeIconIcon,
  EyeSlashIcon,
  CaretRightIcon,
  PenNibIcon,
  SelectionIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useHoverStore } from "../store/hoverStore";
import type { SceneNode, FrameNode, GroupNode } from "../types/scene";
import { isContainerNode } from "../types/scene";
import { FrameIcon } from "./ui/custom-icons/frame-icon";

// Icons for different node types
const NodeIcon = ({
  type,
  reusable,
}: {
  type: SceneNode["type"];
  reusable?: boolean;
}) => {
  const iconClass = clsx("w-4 h-4 shrink-0", "text-text-muted");

  switch (type) {
    case "frame":
      if (reusable) {
        // Component icon: 4 diamonds in a grid pattern (like Figma)
        return <DiamondsFourIcon size={16} className={iconClass} />;
      }
      return <FrameIcon size={16} className={iconClass} />;
    case "group":
      return <SelectionIcon size={16} className={iconClass} />;
    case "rect":
      return <RectangleIcon size={16} className={iconClass} weight="regular" />;
    case "ellipse":
      return <CircleIcon size={16} className={iconClass} weight="regular" />;
    case "text":
      return <TextTIcon size={16} className={iconClass} weight="regular" />;
    case "ref":
      // Instance icon: single diamond (like Figma instance)
      return <DiamondIcon size={16} className={iconClass} weight="regular" />;
    case "path":
      return <PenNibIcon size={16} className={iconClass} weight="regular" />;
    default:
      return null;
  }
};

// Eye icon for visibility
const EyeIcon = ({ visible }: { visible: boolean }) => {
  const iconClass = clsx("w-4 h-4", "text-text-muted");

  return visible ? (
    <EyeIconIcon size={16} className={iconClass} weight="regular" />
  ) : (
    <EyeSlashIcon size={16} className={iconClass} weight="regular" />
  );
};

// Chevron icon for expand/collapse
const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <CaretRightIcon
    size={12}
    className={clsx(
      "w-3 h-3 transition-transform duration-150",
      "text-text-muted",
      expanded && "rotate-90",
    )}
    weight="bold"
  />
);

type DropPosition = "before" | "after" | "inside" | null;

interface DragState {
  draggedId: string | null;
  dropTargetId: string | null;
  dropPosition: DropPosition;
  dropParentId: string | null;
}

interface LayerItemProps {
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
  onDragEnd: () => void;
  onDrop: () => void;
}

function LayerItem({
  node,
  depth,
  parentId,
  dragState,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: LayerItemProps) {
  const { selectedIds, select, addToSelection } = useSelectionStore();
  const { setHoveredNode } = useHoverStore();
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

  const isSelected = selectedIds.includes(node.id);
  const isVisible = node.visible !== false;
  const isFrame = node.type === "frame" || node.type === "group";
  const hasChildren =
    isFrame && (node as FrameNode | GroupNode).children.length > 0;
  const isExpanded = expandedFrameIds.has(node.id);
  const isDragging = dragState.draggedId === node.id;
  const isDropTarget = dragState.dropTargetId === node.id;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      addToSelection(node.id);
    } else {
      select(node.id);
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

  // Inline editing handlers
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentName =
      node.name || `${node.type.charAt(0).toUpperCase() + node.type.slice(1)}`;
    setEditName(currentName);
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
    setHoveredNode(node.id);
  };

  const handleMouseLeave = () => {
    setHoveredNode(null);
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
      // Drop inside frame (middle 50%)
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

  const displayName =
    node.name || `${node.type.charAt(0).toUpperCase() + node.type.slice(1)}`;

  return (
    <>
      <div
        className={clsx(
          "group flex items-center justify-between py-1.5 pr-3 cursor-pointer",
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
        onDragLeave={() => {}}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {/* Chevron for frames with children */}
          {hasChildren ? (
            <button
              className="bg-transparent border-none cursor-pointer p-0.5 flex items-center justify-center rounded hover:bg-white/10"
              onClick={handleChevronClick}
            >
              <ChevronIcon expanded={isExpanded} />
            </button>
          ) : (
            <div className="w-4" />
          )}
          <NodeIcon
            type={node.type}
            reusable={
              node.type === "frame" && (node as FrameNode).reusable === true
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
                "text-xs whitespace-nowrap overflow-hidden text-ellipsis",
                "text-text-secondary",
                !isVisible && "opacity-50",
              )}
              onDoubleClick={handleDoubleClick}
            >
              {displayName}
            </span>
          )}
        </div>
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

      {/* Render children if this is an expanded frame/group */}
      {isFrame && isExpanded && (
        <LayerList
          nodes={[...(node as FrameNode | GroupNode).children].reverse()}
          depth={depth + 1}
          parentId={node.id}
          dragState={dragState}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
        />
      )}
    </>
  );
}

interface LayerListProps {
  nodes: SceneNode[];
  depth: number;
  parentId: string | null;
  dragState: DragState;
  onDragStart: (nodeId: string) => void;
  onDragOver: (
    nodeId: string,
    position: DropPosition,
    parentId: string | null,
  ) => void;
  onDragEnd: () => void;
  onDrop: () => void;
}

function LayerList({
  nodes,
  depth,
  parentId,
  dragState,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: LayerListProps) {
  return (
    <>
      {nodes.map((node) => (
        <LayerItem
          key={node.id}
          node={node}
          depth={depth}
          parentId={parentId}
          dragState={dragState}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
        />
      ))}
    </>
  );
}

// Helper to get children array of a parent (or root nodes if parentId is null)
function getChildrenOfParent(
  nodes: SceneNode[],
  parentId: string | null,
): SceneNode[] {
  if (parentId === null) {
    return nodes;
  }
  for (const node of nodes) {
    if (node.id === parentId && isContainerNode(node)) {
      return node.children;
    }
    if (isContainerNode(node)) {
      const found = getChildrenOfParent(node.children, parentId);
      if (found.length > 0 || parentId === node.id) {
        return found;
      }
    }
  }
  return [];
}

export function LayersPanel() {
  const nodes = useSceneStore((state) => state.nodes);
  const moveNode = useSceneStore((state) => state.moveNode);
  const setFrameExpanded = useSceneStore((state) => state.setFrameExpanded);
  const select = useSelectionStore((state) => state.select);

  const [dragState, setDragState] = useState<DragState>({
    draggedId: null,
    dropTargetId: null,
    dropPosition: null,
    dropParentId: null,
  });

  const handleDragStart = useCallback(
    (nodeId: string) => {
      // Select the node when starting to drag
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

    // Don't drop on itself
    if (draggedId === dropTargetId) {
      handleDragEnd();
      return;
    }

    // Calculate new parent and index
    let newParentId: string | null;
    let newIndex: number;

    if (dropPosition === "inside") {
      // Drop inside a frame
      newParentId = dropTargetId;
      newIndex = 0; // Insert at the beginning (will appear at top in reversed list)
      // Auto-expand the frame
      setFrameExpanded(dropTargetId, true);
    } else {
      // Drop before or after the target
      newParentId = dropParentId;
      const siblings = getChildrenOfParent(nodes, dropParentId);
      const targetIndex = siblings.findIndex((n) => n.id === dropTargetId);

      if (dropPosition === "before") {
        newIndex = targetIndex;
      } else {
        newIndex = targetIndex + 1;
      }
    }

    moveNode(draggedId, newParentId, newIndex);
    handleDragEnd();
  }, [dragState, nodes, moveNode, setFrameExpanded, handleDragEnd]);

  // Reverse the nodes array so that top items in the list appear on top visually (higher z-index)
  const reversedNodes = [...nodes].reverse();

  return (
    <div className="flex-1 bg-surface-panel flex flex-col select-none overflow-hidden">
      <div className="relative border-b border-border-default">
        <div className="px-4 pt-3 pb-3">
          <div className="text-[11px] font-semibold text-text-primary">
            Layers
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" onDragEnd={handleDragEnd}>
          {reversedNodes.length === 0 ? (
            <div className="text-text-disabled text-xs text-center p-5">
              No layers yet
            </div>
          ) : (
            <LayerList
              nodes={reversedNodes}
              depth={0}
              parentId={null}
              dragState={dragState}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
            />
          )}
        </div>
      </div>
    </div>
  );
}
