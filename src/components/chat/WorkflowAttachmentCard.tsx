import { useState } from "react";
import { CaretRightIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { stepCountLabel } from "@/components/workflow/useWorkflowList";
import type { WorkflowAttachment } from "@/lib/workflows/workflowAttachment";
import { cn } from "@/lib/utils";

/** A workflow attached to a user message: a compact line that expands into the numbered steps. */
export function WorkflowAttachmentCard({ attachment }: { attachment: Pick<WorkflowAttachment, "title" | "steps"> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-border-default bg-surface-panel text-xs text-text-primary first:mt-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
      >
        <TreeStructureIcon size={14} className="shrink-0 text-accent-primary" />
        <span className="min-w-0 flex-1 truncate">
          Workflow · {attachment.title} · {stepCountLabel(attachment.steps.length)}
        </span>
        <CaretRightIcon size={12} className={cn("shrink-0 text-text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <ol className="list-decimal space-y-1 border-t border-border-default py-2 pr-2 pl-7 text-text-secondary">
          {attachment.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
