import clsx from "clsx";
import { CardsIcon } from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import { getTopLevelFramesFlat } from "../utils/componentUtils";
import { useNodeThumbnails } from "../hooks/useComponentThumbnails";

export function SlidesPanel() {
  const nodesById = useSceneStore((state) => state.nodesById);
  const rootIds = useSceneStore((state) => state.rootIds);
  const getNodes = useSceneStore((state) => state.getNodes);
  const selectedIds = useSelectionStore((state) => state.selectedIds);

  const slides = getTopLevelFramesFlat(nodesById, rootIds);
  const thumbnails = useNodeThumbnails(slides);

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

  if (slides.length === 0) {
    return (
      <div className="h-full bg-surface-panel flex flex-col select-none">
        <div className="text-text-disabled text-xs text-center p-5">
          No slides yet
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-surface-panel flex flex-col select-none overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-5">
        <div className="flex flex-col gap-3">
          {slides.map((slide, index) => {
            const thumb = thumbnails.get(slide.id);
            const isSelected = selectedIds.includes(slide.id);
            const aspectRatio = slide.width > 0 && slide.height > 0
              ? `${slide.width} / ${slide.height}`
              : undefined;
            return (
              <button
                key={slide.id}
                data-testid={`slide-card-${slide.id}`}
                onClick={() => selectSlide(slide.id)}
                className={clsx(
                  "flex flex-col gap-1.5 rounded-lg p-2 text-left",
                  "hover:bg-secondary",
                  isSelected && "ring-2 ring-accent-primary bg-secondary",
                )}
              >
                <div
                  className="w-full bg-secondary rounded-md flex items-center justify-center overflow-hidden"
                  style={{ aspectRatio: aspectRatio ?? "16 / 9" }}
                >
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
                <span className="flex items-center gap-1.5 text-[11px] text-text-secondary truncate">
                  <span className="text-text-disabled">{index + 1}</span>
                  <span data-testid="slide-name" className="truncate">
                    {slide.name || "Slide"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
