import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  memo,
} from "react";
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
  LineSegmentIcon,
  HexagonIcon,
  HashStraight,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useHoverStore } from "../store/hoverStore";
import type { SceneNode, FrameNode, FlatFrameNode, GroupNode, LayoutProperties, RefNode } from "../types/scene";
import { isContainerNode } from "../types/scene";
import { getAncestorIds } from "../utils/nodeUtils";
import { resolveRefToFrame } from "./nodes/instanceUtils";

// Module-level flag so LayerItem can set it without a ref prop
let _selectionFromLayers = false;

// Auto-layout alignment icon — shows 3 outlined bars positioned according to layout settings
const AutoLayoutIcon = ({ layout }: { layout: LayoutProperties }) => {
  const direction = layout.flexDirection ?? "row";
  const alignItems = layout.alignItems ?? "flex-start";
  const justifyContent = layout.justifyContent ?? "flex-start";
  const isRow = direction === "row";

  // 2 bars of different sizes to visually represent child items
  const sizes = [7, 5];
  const thick = 3.5;
  const sw = 1; // stroke width
  const pad = 2.5;
  const area = 11; // 16 - 2*pad

  // Main-axis positions for the 2 bars
  const gap = 2;
  const totalMain = thick * 2 + gap;
  let mainPositions: number[];
  switch (justifyContent) {
    case "center": {
      const s = pad + (area - totalMain) / 2;
      mainPositions = [s, s + thick + gap];
      break;
    }
    case "flex-end": {
      const s = pad + area - totalMain;
      mainPositions = [s, s + thick + gap];
      break;
    }
    case "space-between":
    case "space-around":
    case "space-evenly":
      mainPositions = [pad, pad + area - thick];
      break;
    default: // flex-start
      mainPositions = [pad, pad + thick + gap];
  }

  // Cross-axis position for each bar based on alignItems
  const crossPositions = sizes.map((size) => {
    switch (alignItems) {
      case "center":
        return pad + (area - size) / 2;
      case "flex-end":
        return pad + area - size;
      case "stretch":
        return pad;
      default: // flex-start
        return pad;
    }
  });

  const stretchedSizes = sizes.map((size) =>
    alignItems === "stretch" ? area : size,
  );

  const bars = stretchedSizes.map((size, i) =>
    isRow
      ? { x: mainPositions[i], y: crossPositions[i], width: thick, height: size }
      : { x: crossPositions[i], y: mainPositions[i], width: size, height: thick },
  );

  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      className="w-4 h-4 shrink-0 text-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
    >
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={0.5}
        />
      ))}
    </svg>
  );
};

// Icons for different node types
const NodeIcon = ({
  type,
  reusable,
  layout,
}: {
  type: SceneNode["type"];
  reusable?: boolean;
  layout?: LayoutProperties;
}) => {
  const iconClass = clsx("w-4 h-4 shrink-0", "text-text-muted");

  switch (type) {
    case "frame":
      if (reusable) {
        // Component icon: 4 diamonds in a grid pattern (like Figma)
        return <DiamondsFourIcon size={16} className={iconClass} />;
      }
      if (layout?.autoLayout) {
        return <AutoLayoutIcon layout={layout} />;
      }
      return <HashStraight size={16} className={iconClass} weight="regular" />;
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
    case "line":
      return <LineSegmentIcon size={16} className={iconClass} weight="regular" />;
    case "polygon":
      return <HexagonIcon size={16} className={iconClass} weight="regular" />;
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
    size={10}
    className={clsx(
      "w-2.5 h-2.5",
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
  onDrop: () => void;
  flatIds: string[];
  instanceId?: string;
  refChildCount?: number;
}

const LayerItem = memo(function LayerItem({
  node,
  depth,
  parentId,
  dragState,
  onDragStart,
  onDragOver,
  onDrop,
  flatIds,
  instanceId,
  refChildCount,
}: LayerItemProps) {
  // Granular selection subscription - only re-render when THIS node's selection state changes
  const isSelected = useSelectionStore((s) => s.selectedIds.includes(node.id));
  const isDescendantSelected = useSelectionStore(
    (s) => !!instanceId && s.instanceContext?.instanceId === instanceId && s.instanceContext?.descendantId === node.id,
  );
  const toggleVisibility = useSceneStore((state) => state.toggleVisibility);
  const expandedFrameIds = useSceneStore((state) => state.expandedFrameIds);
  const toggleFrameExpanded = useSceneStore(
    (state) => state.toggleFrameExpanded,
  );
  const updateNode = useSceneStore((state) => state.updateNode);

  // Components (ref nodes) inside reusable frames are automatically slots
  const isSlotChild = useSceneStore((state) => {
    if (!parentId || node.type !== "ref") return false;
    const parentNode = state.nodesById[parentId];
    if (!parentNode || parentNode.type !== "frame") return false;
    const frame = parentNode as FlatFrameNode;
    return !!frame.reusable;
  });

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
    (isFrame && (node as FrameNode | GroupNode).children.length > 0) ||
    (node.type === "ref" && (refChildCount ?? 0) > 0);
  const isExpanded = expandedFrameIds.has(node.id);
  const isDragging = dragState.draggedId === node.id;
  const isDropTarget = dragState.dropTargetId === node.id;

  const handleClick = (e: React.MouseEvent) => {
    _selectionFromLayers = true;
    const selState = useSelectionStore.getState();
    if (instanceId) {
      selState.selectDescendant(instanceId, node.id);
      return;
    }
    if (e.shiftKey && selState.lastSelectedId) {
      selState.selectRange(selState.lastSelectedId, node.id, flatIds);
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
        onDragLeave={() => {}}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 flex-1">
          {/* Chevron for frames with children */}
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
            reusable={
              node.type === "frame" && (node as FrameNode).reusable === true
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
            <>
              <span
                className={clsx(
                  "text-xs whitespace-nowrap",
                  "text-text-secondary",
                  !isVisible && "opacity-50",
                )}
                onDoubleClick={handleDoubleClick}
              >
                {displayName}
              </span>
              {isSlotChild && (
                <span className="text-[9px] text-purple-400 font-medium ml-1">S</span>
              )}
            </>
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

interface FlattenedLayer {
  node: SceneNode;
  depth: number;
  parentId: string | null;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 8;

function flattenLayers(
  nodes: SceneNode[],
  expandedFrameIds: Set<string>,
  depth = 0,
  parentId: string | null = null,
  out: FlattenedLayer[] = [],
): FlattenedLayer[] {
  for (const node of nodes) {
    out.push({ node, depth, parentId });
    if (isContainerNode(node) && expandedFrameIds.has(node.id)) {
      const children = [...node.children].reverse();
      flattenLayers(children, expandedFrameIds, depth + 1, node.id, out);
    }
  }
  return out;
}

interface LayerListProps {
  items: FlattenedLayer[];
  dragState: DragState;
  onDragStart: (nodeId: string) => void;
  onDragOver: (
    nodeId: string,
    position: DropPosition,
    parentId: string | null,
  ) => void;
  onDrop: () => void;
  flatIds: string[];
}

function LayerList({
  items,
  dragState,
  onDragStart,
  onDragOver,
  onDrop,
  flatIds,
}: LayerListProps) {
  return (
    <>
      {items.map((item) => (
        <LayerItem
          key={item.node.id}
          node={item.node}
          depth={item.depth}
          parentId={item.parentId}
          dragState={dragState}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          flatIds={flatIds}
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
  const nodes = useSceneStore((state) => state.getNodes());
  const expandedFrameIds = useSceneStore((state) => state.expandedFrameIds);
  const moveNode = useSceneStore((state) => state.moveNode);
  const setFrameExpanded = useSceneStore((state) => state.setFrameExpanded);
  const expandAncestors = useSceneStore((state) => state.expandAncestors);
  const parentById = useSceneStore((state) => state.parentById);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const select = useSelectionStore((state) => state.select);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Auto-expand ancestors when selection changes (e.g. from canvas click)
  useEffect(() => {
    if (_selectionFromLayers) {
      _selectionFromLayers = false;
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
  const reversedNodes = useMemo(() => [...nodes].reverse(), [nodes]);
  const flatLayers = useMemo(
    () => flattenLayers(reversedNodes, expandedFrameIds),
    [reversedNodes, expandedFrameIds],
  );
  const flatIds = useMemo(
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
              <LayerList
                items={visibleItems}
                dragState={dragState}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                flatIds={flatIds}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
