import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useEditorModeStore } from "@/store/editorModeStore";

export function PresentOverlay() {
  const total = useEditorModeStore((s) => s.presentFrameIds.length);
  const index = useEditorModeStore((s) => s.presentIndex);
  const next = useEditorModeStore((s) => s.nextFrame);
  const prev = useEditorModeStore((s) => s.prevFrame);
  const exit = useEditorModeStore((s) => s.exitToEdit);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 bg-surface-panel border border-border-default rounded-full shadow-lg pointer-events-auto">
      <button
        data-testid="present-prev"
        onClick={() => prev()}
        disabled={index <= 0}
        title="Previous (←)"
        className="flex items-center justify-center w-7 h-7 rounded-full text-text-muted hover:bg-surface-hover disabled:opacity-30"
      >
        <CaretLeftIcon size={16} />
      </button>
      <span
        data-testid="present-counter"
        className="text-xs text-text-muted tabular-nums min-w-[3rem] text-center"
      >
        {index + 1} / {total}
      </span>
      <button
        data-testid="present-next"
        onClick={() => next()}
        disabled={index >= total - 1}
        title="Next (→)"
        className="flex items-center justify-center w-7 h-7 rounded-full text-text-muted hover:bg-surface-hover disabled:opacity-30"
      >
        <CaretRightIcon size={16} />
      </button>
      <button
        data-testid="present-exit"
        onClick={() => exit()}
        title="Exit (Esc)"
        className="flex items-center justify-center w-7 h-7 rounded-full text-text-muted hover:bg-surface-hover ml-1"
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}
