import { TreeStructureIcon } from "@/components/icons";
import type { WorkflowAttachment } from "@/lib/workflows/workflowAttachment";

/** A workflow attached to a user message: a small non-interactive chip with its title. */
export function WorkflowAttachmentCard({ attachment }: { attachment: Pick<WorkflowAttachment, "title"> }) {
  return (
    <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border-default px-2 py-1 text-xs text-text-primary first:mt-0">
      <TreeStructureIcon size={14} weight="light" className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate">{attachment.title}</span>
    </div>
  );
}
