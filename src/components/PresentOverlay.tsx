import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useEditorModeStore } from "@/store/editorModeStore";
import { IconButton } from "./ui/IconButton";

const navButtonClass =
  "group relative size-9 p-0 rounded-lg transition-none outline-none text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary disabled:opacity-30";

export function PresentOverlay() {
  const total = useEditorModeStore((s) => s.presentFrameIds.length);
  const index = useEditorModeStore((s) => s.presentIndex);
  const next = useEditorModeStore((s) => s.nextFrame);
  const prev = useEditorModeStore((s) => s.prevFrame);
  const exit = useEditorModeStore((s) => s.exitToEdit);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
      <div className="flex items-center gap-1 p-1.5 bg-surface-panel border border-border-default rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
        <IconButton
          data-testid="present-prev"
          onClick={() => prev()}
          disabled={index <= 0}
          tooltip="Previous (←)"
          side="top"
          variant="ghost"
          size="lg"
          className={navButtonClass}
        >
          <CaretLeftIcon size={40} className="size-6" weight="light" />
        </IconButton>
        <span
          data-testid="present-counter"
          className="text-xs text-text-primary tabular-nums min-w-[3rem] text-center"
        >
          {index + 1} / {total}
        </span>
        <IconButton
          data-testid="present-next"
          onClick={() => next()}
          disabled={index >= total - 1}
          tooltip="Next (→)"
          side="top"
          variant="ghost"
          size="lg"
          className={navButtonClass}
        >
          <CaretRightIcon size={40} className="size-6" weight="light" />
        </IconButton>
        <IconButton
          data-testid="present-exit"
          onClick={() => exit()}
          tooltip="Exit (Esc)"
          side="top"
          variant="ghost"
          size="lg"
          className={`${navButtonClass} ml-1`}
        >
          <XIcon size={40} className="size-6" weight="light" />
        </IconButton>
      </div>
    </div>
  );
}
