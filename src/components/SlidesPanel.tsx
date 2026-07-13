import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CardsIcon, PlusIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import { generateId } from "../types/scene";
import type { FlatFrameNode } from "../types/scene";
import { resolveSlideOrder } from "../utils/slideOrder";
import { useNodeThumbnails } from "../hooks/useComponentThumbnails";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Pointer movement (px) before a press is treated as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

interface DragVisual {
  /** Slide currently being dragged. */
  id: string;
  /** Its index (in `slides`) when the drag started. */
  originalIndex: number;
  /** Raw pointer delta since drag start — drives the dragged card's own transform. */
  dy: number;
  /** Row height + gap, measured from two adjacent cards at drag start. */
  slot: number;
  /** Where the dragged card would land if dropped now (index into `slides`). */
  insertIndex: number;
}

interface PendingDrag {
  id: string;
  pointerId: number;
  originalIndex: number;
  startClientY: number;
  slot: number;
  dragging: boolean;
}

/**
 * Simulate `array.splice(fromIndex, 1); array.splice(toIndex, 0, item)` for a
 * single other card, returning how many slots (rows) it shifts by. Mirrors
 * the "no-gap position, shifted forward from the insertion point" logic in
 * autoLayoutDragAnimator, adapted to a plain vertical list.
 */
function siblingOffsetSlots(
  cardIndex: number,
  draggedOriginalIndex: number,
  insertIndex: number,
): number {
  if (cardIndex === draggedOriginalIndex) return 0;
  if (draggedOriginalIndex < insertIndex) {
    if (cardIndex > draggedOriginalIndex && cardIndex <= insertIndex) return -1;
  } else if (draggedOriginalIndex > insertIndex) {
    if (cardIndex >= insertIndex && cardIndex < draggedOriginalIndex) return 1;
  }
  return 0;
}

export function SlidesPanel() {
  const nodesById = useSceneStore((state) => state.nodesById);
  const rootIds = useSceneStore((state) => state.rootIds);
  const slideOrder = useSceneStore((state) => state.slideOrder);
  const getNodes = useSceneStore((state) => state.getNodes);
  const addNode = useSceneStore((state) => state.addNode);
  const reorderSlide = useSceneStore((state) => state.reorderSlide);
  const selectedIds = useSelectionStore((state) => state.selectedIds);

  // Keep the list stable across thumbnail state/selection renders. Scene
  // changes still update this list, while useNodeThumbnails resolves the
  // changed descendant to its owning slide and refreshes only that preview.
  // Order comes from slideOrder (independent of canvas x/y and rootIds
  // z-order) via resolveSlideOrder — it drops deleted ids and appends new
  // top-level frames not yet in slideOrder.
  const slides = useMemo(() => {
    const order = resolveSlideOrder(nodesById, rootIds, slideOrder);
    return order
      .map((id) => nodesById[id])
      .filter((n): n is FlatFrameNode => !!n && n.type === "frame");
  }, [nodesById, rootIds, slideOrder]);
  const thumbnails = useNodeThumbnails(slides);

  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const didDragRef = useRef(false);
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);

  const setCardRef = (id: string, el: HTMLButtonElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };

  /** Row height + gap, measured from the first two cards' current layout. */
  const measureSlot = (): number => {
    if (slides.length < 2) return 0;
    const first = cardRefs.current.get(slides[0].id);
    const second = cardRefs.current.get(slides[1].id);
    if (!first || !second) return 0;
    const slot = second.getBoundingClientRect().top - first.getBoundingClientRect().top;
    return slot > 0 ? slot : 0;
  };

  const computeInsertIndex = (drag: PendingDrag, dy: number): number => {
    if (drag.slot <= 0 || slides.length === 0) return drag.originalIndex;
    const deltaSlots = Math.round(dy / drag.slot);
    return Math.min(Math.max(drag.originalIndex + deltaSlots, 0), slides.length - 1);
  };

  const addSlide = () => {
    const rightmost = slides.reduce(
      (right, slide) => Math.max(right, slide.x + slide.width),
      0,
    );
    const id = generateId();
    const slideNumber = slides.length + 1;

    addNode({
      id,
      type: "frame",
      name: `Slide ${slideNumber}`,
      x: rightmost > 0 ? rightmost + 100 : 0,
      y: 0,
      width: 960,
      height: 540,
      fill: "#ffffff",
      stroke: "#cccccc",
      strokeWidth: 1,
      children: [],
    });
    selectSlide(id);
  };

  const selectSlide = (slideId: string) => {
    useSelectionStore.getState().select(slideId);

    const target = getNodes().find((n) => n.id === slideId);
    if (target) {
      const canvas = document.querySelector<HTMLElement>("[data-canvas]");
      const viewportWidth = canvas?.clientWidth ?? window.innerWidth;
      const viewportHeight = canvas?.clientHeight ?? window.innerHeight;
      const viewport = useViewportStore.getState();

      viewport.stopAnimation();
      viewport.setViewportState({
        scale: 1,
        x: viewportWidth / 2 - (target.x + target.width / 2),
        y: viewportHeight / 2 - (target.y + target.height / 2),
      });
    }
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
    index: number,
  ) => {
    if (e.button !== 0) return;
    // Clear any drag flag left over from a previous gesture whose trailing
    // click never fired (browsers often suppress click after a real drag) —
    // otherwise it would swallow this press's click selection.
    didDragRef.current = false;
    pendingDragRef.current = {
      id,
      pointerId: e.pointerId,
      originalIndex: index,
      startClientY: e.clientY,
      slot: measureSlot(),
      dragging: false,
    };
  };

  const handlePointerMove = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    const drag = pendingDragRef.current;
    if (!drag || drag.id !== id) return;
    const dy = e.clientY - drag.startClientY;

    if (!drag.dragging) {
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      didDragRef.current = true;
      e.currentTarget.setPointerCapture(drag.pointerId);
    }

    const insertIndex = computeInsertIndex(drag, dy);
    setDragVisual({
      id: drag.id,
      originalIndex: drag.originalIndex,
      dy,
      slot: drag.slot,
      insertIndex,
    });
  };

  const finishDrag = (commit: boolean) => {
    const drag = pendingDragRef.current;
    pendingDragRef.current = null;
    const visual = dragVisual;
    setDragVisual(null);
    if (!commit || !drag || !drag.dragging || !visual) return;
    if (visual.insertIndex !== drag.originalIndex) {
      reorderSlide(drag.originalIndex, visual.insertIndex);
    }
  };

  const handlePointerUp = (id: string) => {
    const drag = pendingDragRef.current;
    if (!drag || drag.id !== id) return;
    finishDrag(true);
  };

  const handlePointerCancel = (id: string) => {
    const drag = pendingDragRef.current;
    if (!drag || drag.id !== id) return;
    finishDrag(false);
  };

  const handleClick = (slideId: string) => {
    // A drag gesture (past the threshold) already committed the reorder on
    // pointerup — the trailing click event it fires shouldn't also select.
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    selectSlide(slideId);
  };

  return (
    <div className="h-full bg-surface-panel flex flex-col select-none overflow-hidden border-y border-border-default">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-secondary-foreground">
          Slides
        </span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={addSlide}
                  className="p-0.5 rounded text-text-muted hover:text-text-default hover:bg-secondary"
                  aria-label="Add slide"
                >
                  <PlusIcon size={14} />
                </button>
              }
            />
            <TooltipContent>Add slide</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-5">
        {slides.length === 0 ? (
          <div className="text-text-disabled text-xs text-center p-5">
            No slides yet
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {slides.map((slide, index) => {
              const thumb = thumbnails.get(slide.id);
              const isSelected = selectedIds.includes(slide.id);
              const isDragging = dragVisual?.id === slide.id;
              const dragOffset =
                dragVisual &&
                siblingOffsetSlots(
                  index,
                  dragVisual.originalIndex,
                  dragVisual.insertIndex,
                ) * dragVisual.slot;
              const translateY = isDragging ? dragVisual.dy : dragOffset || 0;

              return (
                <button
                  key={slide.id}
                  ref={(el) => setCardRef(slide.id, el)}
                  data-testid={`slide-card-${slide.id}`}
                  onClick={() => handleClick(slide.id)}
                  onPointerDown={(e) => handlePointerDown(e, slide.id, index)}
                  onPointerMove={(e) => handlePointerMove(e, slide.id)}
                  onPointerUp={() => handlePointerUp(slide.id)}
                  onPointerCancel={() => handlePointerCancel(slide.id)}
                  style={
                    translateY !== 0 || isDragging
                      ? {
                          transform: `translateY(${translateY}px)`,
                          transition: isDragging ? "none" : "transform 150ms ease",
                          position: "relative",
                          zIndex: isDragging ? 10 : undefined,
                          opacity: isDragging ? 0.85 : undefined,
                          boxShadow: isDragging
                            ? "0 8px 24px rgba(0, 0, 0, 0.25)"
                            : undefined,
                        }
                      : undefined
                  }
                  className={clsx(
                    "flex flex-col gap-1.5 rounded-lg p-2 text-left touch-none",
                    !isSelected && "bg-secondary/50 hover:bg-secondary",
                    isSelected && "bg-accent-primary/10 hover:bg-accent-primary/10",
                  )}
                >
                  <div
                    className="w-full rounded-md flex overflow-hidden"
                    style={{ aspectRatio: "16 / 9" }}
                  >
                    <span
                      data-testid={`slide-number-${slide.id}`}
                      className="shrink-0 w-7 pl-1 pr-2 pt-1.5 text-sm font-medium text-text-disabled"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 flex items-center justify-center overflow-hidden">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={slide.name || "Slide"}
                          className="max-w-full max-h-full object-contain pointer-events-none"
                        />
                      ) : (
                        <CardsIcon
                          size={28}
                          weight="thin"
                          className="text-text-secondary"
                        />
                      )}
                    </div>
                  </div>
                  <span data-testid="slide-name" className="pl-6 text-[11px] text-text-secondary truncate">
                    {slide.name || "Slide"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
