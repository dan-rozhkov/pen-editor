import { useState, useRef, useEffect, memo } from "react";
import clsx from "clsx";
import { useSceneStore } from "../../store/sceneStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useHoverStore } from "../../store/hoverStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import type { SceneNode, FrameNode, GroupNode } from "../../types/scene";
import { NodeIcon, EmbedElementIcon, EyeIcon, ChevronIcon } from "./LayerIcons";
import { getDisplayName, getEmbedElementLayerKey, selectionFromLayersRef } from "./layerTypes";
import type { DragEmbedElement, DragState, DropPosition } from "./layerTypes";
import type { EmbedElementLayer } from "@/lib/embedLayerTree";
import { buildSourceEmbedElementSelection, getEmbedLayerTree } from "@/lib/embedLayerTree";
import { describeEmbedElement, resolveElementPath } from "@/lib/embedElementPicker";
import { findEmbedShadowRoot } from "@/lib/embedElementStyle";
import { renameEmbedElement, resolveEmbedElementEditName, toggleEmbedElementHidden } from "./embedLayerActions";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export interface LayerItemProps {
  node: SceneNode;
  depth: number;
  parentId: string | null;
  dragState: DragState;
  onDragStart: (nodeId: string, embedElementContext?: DragEmbedElement) => void;
  onDragOver: (
    nodeId: string,
    position: DropPosition,
    parentId: string | null,
    embedElementContext?: DragEmbedElement,
  ) => void;
  onDrop: () => void;
  selectableFlatIds: string[];
  /** Set on embed-element rows — see `FlattenedLayer.embedElement`'s doc
   * comment in `layerTypes.ts`. */
  embedElement?: { embedId: string; element: EmbedElementLayer };
  /** The canonical `sourcePath` of the currently picked embed element (from
   * `embedPickerStore.selection`, normalized once by `LayersPanel` — see
   * that component for why this isn't recomputed per row), or `null` when
   * no embed element is picked. Compared by string, never re-derived here. */
  selectedEmbedElement?: { embedId: string; sourcePath: string } | null;
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
  embedElement,
  selectedEmbedElement,
}: LayerItemProps) {
  const isEmbedElement = !!embedElement;
  const readOnly = useReadOnly();
  // Picking an element inside an embed still selects the OWNING embed in
  // selectionStore (see handleClick below — the picker only activates once
  // the embed is the sole native selection), so the embed's own native row
  // would otherwise read as selected the whole time an element inside it is
  // picked. That's wrong for the LAYERS PANEL specifically: the row that
  // should look selected is the element's, not the embed's. Don't touch
  // selectionStore itself for this — the properties panel, the Pixi
  // selection outline and canvasContext all key off the embed actually being
  // selected there, and changing that would break all three; this is purely
  // how the row is DRAWN, applied down at `rowSelected`.
  const isNativeEmbedWithPickedElement =
    !isEmbedElement &&
    node.type === "embed" &&
    !!selectedEmbedElement &&
    selectedEmbedElement.embedId === node.id;
  const isSelected = useSelectionStore((s) => {
    // Embed-element selection isn't tracked in selectionStore at all (it
    // lives in embedPickerStore, gated on the embed being the sole native
    // selection — see useEmbedPickerLifecycle) — the caller-computed
    // `selectedEmbedElement` below is the source of truth for these rows.
    if (isEmbedElement) return false;
    return s.selectedIds.includes(node.id);
  });
  const isSelectedEmbedElement =
    isEmbedElement &&
    !!selectedEmbedElement &&
    selectedEmbedElement.embedId === embedElement.embedId &&
    selectedEmbedElement.sourcePath === embedElement.element.sourcePath;
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

  // `onMouseLeave` never fires for a row that disappears out from under the
  // pointer instead of being moved away from — deleted via Delete/keyboard,
  // collapsed by its parent, or scrolled out of the virtualized window.
  // Without this, `hoveredEmbedId`/`hoveredPath` keeps naming a path that
  // may now resolve to whatever slid into this row's old slot, and
  // `EmbedElementHighlight` keeps painting a hover outline on it. Clears
  // ONLY when this row still owns the hover (an unrelated row may have
  // taken it over by the time this one unmounts).
  useEffect(() => {
    if (!isEmbedElement) return;
    const { embedId, element } = embedElement;
    return () => {
      const picker = useEmbedPickerStore.getState();
      if (picker.hoveredEmbedId === embedId && picker.hoveredPath === element.shadowPath) {
        picker.setHoveredElement(null, null);
      }
    };
    // Deliberately `embedElement?.embedId` / `embedElement?.element.shadowPath`
    // rather than the `embedElement` OBJECT: `flattenLayers` rebuilds that
    // object on every scene change (even ones unrelated to this row), so
    // depending on it re-runs this cleanup — and clears the canvas hover
    // highlight while the pointer is still on the row — for any unrelated
    // mutation. Primitives only change when this row's own identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmbedElement, embedElement?.embedId, embedElement?.element.shadowPath]);

  const isVisible = node.visible !== false;
  const isFrame = node.type === "frame" || node.type === "group";
  // A plain `embed` row (not one of its element rows) gets a chevron once
  // its parsed html yields at least one element row. `getEmbedLayerTree` is
  // memoized by html string, so a collapsed embed re-checking this on every
  // render is a cache hit after the first, not a re-parse.
  const embedTree =
    !isEmbedElement && node.type === "embed" ? getEmbedLayerTree(node.htmlContent ?? "") : null;
  const hasChildren = isEmbedElement
    ? embedElement.element.children.length > 0
    : embedTree
      ? embedTree.length > 0
      : isFrame && (node as FrameNode | GroupNode).children.length > 0;
  const expandKey = isEmbedElement
    ? getEmbedElementLayerKey(embedElement.embedId, embedElement.element.sourcePath)
    : node.id;
  const isExpanded = expandedFrameIds.has(expandKey);
  // Embed-element rows share `node` (the owning embed) across every row
  // under it, so `dragState.draggedId === node.id` can't tell them apart —
  // identify by (embedId, shadowPath) instead, via the dedicated
  // `draggedEmbedElement`/`dropEmbedElement` fields.
  const isEmbedDraggedRow =
    isEmbedElement &&
    dragState.draggedEmbedElement?.embedId === embedElement.embedId &&
    dragState.draggedEmbedElement.shadowPath === embedElement.element.shadowPath;
  const isEmbedDropTargetRow =
    isEmbedElement &&
    dragState.dropEmbedElement?.embedId === embedElement.embedId &&
    dragState.dropEmbedElement.shadowPath === embedElement.element.shadowPath;
  // A drag only "belongs" to this embed row's tree once the row being
  // dragged is itself an embed-element row of the SAME embed — this both
  // gates which rows offer a drop position (native rows, and rows of a
  // different embed, offer none) and is reused by the geometry handler
  // below.
  const embedDragAllowed =
    isEmbedElement &&
    dragState.draggedEmbedElement?.embedId === embedElement.embedId;
  const isDragging = (!isEmbedElement && dragState.draggedId === node.id) || isEmbedDraggedRow;
  const isDropTarget =
    (!isEmbedElement && dragState.dropTargetId === node.id) || isEmbedDropTargetRow;

  const handleClick = (e: React.MouseEvent) => {
    selectionFromLayersRef.current = true;
    const selState = useSelectionStore.getState();
    if (isEmbedElement) {
      const { embedId, element } = embedElement;
      // Select the OWNING embed first — useEmbedPickerLifecycle drops any
      // picker selection the instant the embed stops being the sole
      // selected node, so selecting it after `selectElement` below would
      // immediately clear what we just set.
      selState.select(embedId);

      const sceneNode = useSceneStore.getState().nodesById[embedId];
      const html = sceneNode?.type === "embed" ? sceneNode.htmlContent : undefined;

      // Prefer the LIVE element so the selection is byte-identical to what
      // the canvas picker itself produces; fall back to a source-derived
      // selection when the embed isn't currently mounted (e.g. off-screen,
      // virtualized, or the panel is open before the canvas has rendered).
      const root = findEmbedShadowRoot(embedId);
      const liveEl = root ? resolveElementPath(root, element.shadowPath) : null;
      const selection =
        liveEl && root
          ? describeEmbedElement(liveEl, root, embedId)
          : html !== undefined
            ? buildSourceEmbedElementSelection(html, element.sourcePath, embedId)
            : null;

      if (selection) {
        useEmbedPickerStore.getState().selectElement(selection, html);
      }
      return;
    }
    // Clicking an embed's OWN row (never an element row of it — that branch
    // already returned above) must drop any element selection picked inside
    // it. `useEmbedPickerLifecycle` only clears the picker selection when
    // the owning embed stops being the SOLE native selection — re-selecting
    // the SAME embed by clicking its row doesn't trip that check, so
    // without this a stale element selection survives and Delete removes
    // the DOM element instead of the embed, with no visible cue why.
    const pickerSelection = useEmbedPickerStore.getState().selection;
    if (pickerSelection && pickerSelection.embedId === node.id) {
      useEmbedPickerStore.getState().clearSelection();
    }

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
    if (readOnly) return;
    if (isEmbedElement) {
      toggleEmbedElementHidden(embedElement.embedId, embedElement.element.shadowPath, !embedElement.element.hidden);
      return;
    }
    toggleVisibility(node.id);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFrameExpanded(expandKey);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    // `embedElement.element.name` is already truncated for a long
    // text-derived label (see `resolveEmbedElementEditName`'s doc comment)
    // — seeding the input with the ellipsis and blurring without an actual
    // edit would submit that truncated text as the permanent name.
    setEditName(
      isEmbedElement
        ? resolveEmbedElementEditName(embedElement.embedId, embedElement.element)
        : getDisplayName(node),
    );
    setIsEditing(true);
  };

  const handleNameSubmit = () => {
    if (isEmbedElement) {
      // Unlike the native branch below, an empty/whitespace name is a
      // legal (and meaningful) submission here: `setEmbedElementName`
      // treats it as "clear `data-layer-name`", falling back to the
      // element's derived name — not "leave editing without renaming".
      //
      // But skip the call entirely when `editName` is exactly the name the
      // input was SEEDED with (`resolveEmbedElementEditName` — the same
      // resolver `handleDoubleClick` uses): a double-click followed by a
      // blur with no actual edit must not stamp a `data-layer-name`
      // override for a value that was never a real rename. Only comparing
      // against `element.name` here would miss the common case that name is
      // truncated for a long derived text label; re-resolving matches the
      // untruncated value the input was actually seeded with.
      const seedName = resolveEmbedElementEditName(embedElement.embedId, embedElement.element);
      if (editName !== seedName) {
        renameEmbedElement(embedElement.embedId, embedElement.element.shadowPath, editName);
      }
      setIsEditing(false);
      return;
    }
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
    if (isEmbedElement) {
      useEmbedPickerStore.getState().setHoveredElement(embedElement.embedId, embedElement.element.shadowPath);
      return;
    }
    useHoverStore.getState().setHoveredNode(node.id);
  };

  const handleMouseLeave = () => {
    if (isEmbedElement) {
      useEmbedPickerStore.getState().setHoveredElement(null, null);
      return;
    }
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

  const handleEmbedElementDragStart = (e: React.DragEvent) => {
    if (!isEmbedElement) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", embedElement.embedId);
    onDragStart(embedElement.embedId, {
      embedId: embedElement.embedId,
      shadowPath: embedElement.element.shadowPath,
    });
  };

  const handleEmbedElementDragOver = (e: React.DragEvent) => {
    if (!isEmbedElement) return;
    e.preventDefault();
    e.stopPropagation();

    // Same drop-zone geometry as native rows, but the middle ("inside")
    // band is only offered for a row that can actually contain children —
    // a text leaf or a void-ish element (image/shape kind) never gets an
    // "inside" position, matching `hasChildren`'s own "frame" carve-out.
    const canContainChildren = embedElement.element.kind === "frame";
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    let position: DropPosition;
    if (canContainChildren && y > height * 0.25 && y < height * 0.75) {
      position = "inside";
    } else if (y < height / 2) {
      position = "before";
    } else {
      position = "after";
    }

    onDragOver(embedElement.embedId, position, null, {
      embedId: embedElement.embedId,
      shadowPath: embedElement.element.shadowPath,
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop();
  };

  const displayName = isEmbedElement ? embedElement.element.name : getDisplayName(node);
  // Native rows dim on `!isVisible` (a scene-level flag with a toggle);
  // embed-element rows dim on the DOM element's own inline `display:none`,
  // toggled through the same eye button below.
  const isElementHidden = isEmbedElement ? embedElement.element.hidden : !isVisible;
  const isDimmed = isElementHidden;
  // The highlight belongs to the picked element's own row, never to both.
  // That row is always on screen while the pick is live: LayersPanel's
  // auto-expand effect re-runs on `expandedFrameIds` and re-expands the embed
  // whenever `selectedEmbedElement` names it, so collapsing the embed over a
  // picked element cannot leave the panel with no highlighted row at all.
  const rowSelected = isEmbedElement
    ? isSelectedEmbedElement
    : isSelected && !isNativeEmbedWithPickedElement;

  return (
    <div
        data-node-id={isEmbedElement ? undefined : node.id}
        data-layer-key={expandKey}
        className={clsx(
          "group flex items-center cursor-pointer h-[28px]",
          rowSelected
            ? "bg-accent-selection hover:bg-accent-selection"
            : "hover:bg-secondary",
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
        draggable={!readOnly}
        onDragStart={
          readOnly ? undefined : isEmbedElement ? handleEmbedElementDragStart : handleDragStart
        }
        onDragOver={
          readOnly
            ? undefined
            : isEmbedElement
              ? (embedDragAllowed ? handleEmbedElementDragOver : undefined)
              : handleDragOver
        }
        onDrop={
          readOnly
            ? undefined
            : isEmbedElement
              ? (embedDragAllowed ? handleDrop : undefined)
              : handleDrop
        }
      >
        <div className="flex items-center gap-1 flex-1">
          {hasChildren ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className="bg-transparent border-none cursor-pointer p-0.5 flex items-center justify-center rounded opacity-0 group-hover/layers:opacity-100 hover:bg-white/10"
                    onClick={handleChevronClick}
                    aria-label={isExpanded ? "Collapse layer" : "Expand layer"}
                  >
                    <ChevronIcon expanded={isExpanded} />
                  </button>
                }
              />
              <TooltipContent side="right">
                {isExpanded ? "Collapse" : "Expand"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="w-4" />
          )}
          {isEmbedElement ? (
            <EmbedElementIcon kind={embedElement.element.kind} />
          ) : (
            <NodeIcon
              type={node.type}
              isMask={node.isMask === true}
              layout={
                node.type === "frame" ? (node as FrameNode).layout : undefined
              }
            />
          )}
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
                isDimmed && "opacity-50",
              )}
              onDoubleClick={handleDoubleClick}
            >
              {displayName}
            </span>
          )}
        </div>
        <div
          className={clsx(
            "relative sticky right-0 shrink-0 flex items-center pl-2 pr-3 bg-surface-panel",
            !rowSelected && "group-hover:bg-secondary",
          )}
        >
          {/* Paint the translucent selection tint exactly once over the opaque
              panel base so the eye-icon region matches the row instead of
              double-stacking the alpha (which would read as a second shade). */}
          {rowSelected && (
            <div className="absolute inset-0 pointer-events-none bg-accent-selection group-hover:bg-accent-selection" />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={clsx(
                    "relative bg-transparent border-none cursor-pointer p-1 flex items-center justify-center rounded group-hover:opacity-100 opacity-0",
                  )}
                  onClick={handleVisibilityClick}
                  aria-label={isElementHidden ? "Show layer" : "Hide layer"}
                >
                  <EyeIcon visible={!isElementHidden} />
                </button>
              }
            />
            <TooltipContent side="right">
              {isElementHidden ? "Show layer" : "Hide layer"}
            </TooltipContent>
          </Tooltip>
        </div>
    </div>
  );
});
