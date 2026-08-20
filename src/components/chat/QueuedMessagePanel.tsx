import { ClockIcon, ImageIcon, XIcon } from "@phosphor-icons/react";
import type { QueuedChatMessage } from "@/types/chat";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface QueuedMessagePanelProps {
  queuedMessages: QueuedChatMessage[];
  onRemoveQueued: (id: string) => void;
}

export function QueuedMessagePanel({
  queuedMessages,
  onRemoveQueued,
}: QueuedMessagePanelProps) {
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="relative mx-3 mt-2 -mb-3 shrink-0 rounded-t-xl bg-secondary px-2.5 pt-2 pb-5">
      <div className="flex items-center gap-1.5 text-text-muted">
        <ClockIcon size={14} className="shrink-0" />
        <span className="text-xs font-medium">Queued</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums">
          {queuedMessages.length}
        </span>
      </div>
      <ul className="layers-scrollbar mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
        {queuedMessages.map((queued) => (
          <li
            key={queued.id}
            className="group flex items-center gap-2 rounded-[5px] bg-surface-panel px-2 py-1 text-xs text-text-muted"
          >
            {queued.payload.images && queued.payload.images.length > 0 && (
              <ImageIcon size={12} weight="light" className="shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {queued.payload.text || "(image)"}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onRemoveQueued(queued.id)}
                    aria-label="Remove queued message"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary"
                  >
                    <XIcon size={10} />
                  </button>
                }
              />
              <TooltipContent>Remove queued message</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
