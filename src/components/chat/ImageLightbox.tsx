import { useEffect } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface ImageLightboxProps {
  urls: string[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ImageLightbox({
  urls,
  index,
  onClose,
  onNavigate,
}: ImageLightboxProps) {
  const hasMultiple = urls.length > 1;

  const goTo = (next: number) => {
    if (urls.length === 0) return;
    const wrapped = ((next % urls.length) + urls.length) % urls.length;
    onNavigate(wrapped);
  };

  const prev = () => goTo(index - 1);
  const next = () => goTo(index + 1);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && hasMultiple) {
        e.preventDefault();
        e.stopPropagation();
        prev();
      } else if (e.key === "ArrowRight" && hasMultiple) {
        e.preventDefault();
        e.stopPropagation();
        next();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, urls.length, hasMultiple]);

  const url = urls[index];
  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <img
        src={url}
        alt="attached image"
        onError={onClose}
        className="max-w-[90vw] max-h-[90vh] rounded-lg"
      />

      {hasMultiple && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    prev();
                  }}
                  aria-label="Previous image"
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <CaretLeftIcon size={24} />
                </button>
              }
            />
            <TooltipContent>Previous image</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    next();
                  }}
                  aria-label="Next image"
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <CaretRightIcon size={24} />
                </button>
              }
            />
            <TooltipContent>Next image</TooltipContent>
          </Tooltip>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-xs">
            {index + 1} / {urls.length}
          </div>
        </>
      )}
    </div>
  );
}
