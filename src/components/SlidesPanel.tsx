import { useMemo } from "react";
import clsx from "clsx";
import { CardsIcon, PlusIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import { generateId } from "../types/scene";
import { getTopLevelFramesFlat } from "../utils/componentUtils";
import { useNodeThumbnails } from "../hooks/useComponentThumbnails";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function SlidesPanel() {
  const nodesById = useSceneStore((state) => state.nodesById);
  const rootIds = useSceneStore((state) => state.rootIds);
  const getNodes = useSceneStore((state) => state.getNodes);
  const addNode = useSceneStore((state) => state.addNode);
  const selectedIds = useSelectionStore((state) => state.selectedIds);

  // Keep the list stable across thumbnail state/selection renders. Scene
  // changes still update this list, while useNodeThumbnails resolves the
  // changed descendant to its owning slide and refreshes only that preview.
  const slides = useMemo(
    () => getTopLevelFramesFlat(nodesById, rootIds),
    [nodesById, rootIds],
  );
  const thumbnails = useNodeThumbnails(slides);

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
    useSelectionStore.getState().select(id);
  };

  const selectSlide = (slideId: string) => {
    useSelectionStore.getState().select(slideId);

    // Focus the frame on canvas — same "fit a single node" mechanism as
    // Present mode (viewportStore.fitToContent with a one-node list).
    const target = getNodes().find((n) => n.id === slideId);
    if (target) {
      useViewportStore
        .getState()
        .fitToContent([target], window.innerWidth, window.innerHeight);
    }
  };

  return (
    <div className="h-full bg-surface-panel flex flex-col select-none overflow-hidden border-y border-border-default">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-secondary-foreground">
          Slides
        </span>
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
              return (
                <button
                  key={slide.id}
                  data-testid={`slide-card-${slide.id}`}
                  onClick={() => selectSlide(slide.id)}
                  className={clsx(
                    "flex flex-col gap-1.5 rounded-lg p-2 text-left bg-secondary/50 hover:bg-secondary",
                    isSelected && "ring-2 ring-accent-primary bg-secondary",
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
                          className="max-w-full max-h-full object-contain"
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
