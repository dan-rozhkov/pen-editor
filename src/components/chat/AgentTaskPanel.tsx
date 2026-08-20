import { useState } from "react";
import {
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  ClockIcon,
  ImageIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { QueuedChatMessage, Task } from "@/types/chat";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface AgentTaskPanelProps {
  tasks: Task[];
  /** Messages submitted while the agent was busy — moved here from ChatInput. */
  queuedMessages: QueuedChatMessage[];
  onRemoveQueued: (id: string) => void;
}

// 14x14 ring + conic-gradient wedge, matching the aicss.dev-style progress
// glyph in the design spec: a dashed ring (text-text-muted) with an inset
// solid arc (text-text-secondary) whose sweep is the completion percentage.
// Deliberately not a filled pie — the dashed ring must stay visible outside
// the arc at every percentage, including 0 and 100.
function ProgressIcon({ pct }: { pct: number }) {
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-text-muted">
      <CircleDashedIcon size={14} />
      <span
        className="absolute inset-[2.6px] rounded-full text-text-secondary"
        style={{ background: `conic-gradient(currentColor ${pct}%, transparent 0)` }}
      />
    </span>
  );
}

function TaskRow({ task }: { task: Task }) {
  if (task.status === "completed") {
    return (
      <li className="flex items-center gap-2 py-0.5 text-[13px] leading-[18px]">
        <CheckCircleIcon size={16} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-text-muted line-through decoration-black/20 dark:decoration-white/25">
          {task.title}
        </span>
      </li>
    );
  }
  if (task.status === "in_progress") {
    return (
      <li className="flex items-center gap-2 py-0.5 text-[13px] leading-[18px]">
        <SpinnerGapIcon
          size={16}
          className="shrink-0 animate-[spin_1.1s_linear_infinite] text-accent-primary motion-reduce:animate-none"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
          {task.title}
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 py-0.5 text-[13px] leading-[18px]">
      <CircleDashedIcon size={16} className="shrink-0 text-text-disabled" />
      <span className="min-w-0 flex-1 truncate text-text-disabled">{task.title}</span>
    </li>
  );
}

export function AgentTaskPanel({ tasks, queuedMessages, onRemoveQueued }: AgentTaskPanelProps) {
  const [open, setOpen] = useState(true);

  const hasTasks = tasks.length > 0;
  const hasQueue = queuedMessages.length > 0;
  if (!hasTasks && !hasQueue) {
    return null;
  }

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const allDone = hasTasks && completed === total;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const currentTask =
    tasks.find((t) => t.status === "in_progress") ??
    tasks.find((t) => t.status === "pending");

  return (
    <div className="relative mx-3 mt-2 -mb-3 shrink-0 rounded-t-xl bg-secondary px-2.5 pt-2 pb-5">
      {hasTasks && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-5 w-full items-center gap-2 text-left"
          >
            {!open && allDone ? (
              <CheckCircleIcon
                size={14}
                weight="fill"
                className="shrink-0 text-accent-primary"
              />
            ) : !open && currentTask ? (
              <SpinnerGapIcon
                size={16}
                className="shrink-0 animate-[spin_1.1s_linear_infinite] text-accent-primary motion-reduce:animate-none"
              />
            ) : (
              <ProgressIcon pct={pct} />
            )}

            <span
              className={
                !open
                  ? "min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary"
                  : "flex-1 truncate text-xs font-medium tracking-[-0.01em] text-text-secondary"
              }
            >
              {!open && allDone
                ? "All tasks complete"
                : !open && currentTask
                  ? currentTask.title
                  : "Tasks"}
            </span>

            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {completed}/{total}
            </span>

            <CaretDownIcon
              size={12}
              className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>

          {open && (
            <ul className="layers-scrollbar mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {tasks.map((task, i) => (
                <TaskRow key={i} task={task} />
              ))}
            </ul>
          )}
        </>
      )}

      {hasQueue && (
        <div className={hasTasks ? "mt-2.5 border-t border-black/[0.08] pt-2 dark:border-white/10" : ""}>
          <div className="flex items-center gap-1.5 text-text-muted">
            <ClockIcon size={14} className="shrink-0" />
            <span className="text-xs font-medium">Queued</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums">
              {queuedMessages.length}
            </span>
          </div>
          <ul className="mt-1 flex flex-col gap-1">
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
                        className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
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
      )}
    </div>
  );
}
