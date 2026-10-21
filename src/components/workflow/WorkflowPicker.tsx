import { TreeStructureIcon, XIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";

interface WorkflowChipProps {
  title: string;
  onRemove: () => void;
}

/** The removable chip above the composer input for the attached workflow. */
export function WorkflowChip({ title, onRemove }: WorkflowChipProps) {
  return (
    <div className="mb-2 flex pl-2">
      <div
        data-testid="workflow-chip"
        className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--color-accent-selection)] py-1 pr-1 pl-2 text-xs text-[var(--color-accent-primary)]"
      >
        <TreeStructureIcon size={14} className="shrink-0" />
        <span className="min-w-0 truncate">{title}</span>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          tooltip="Remove workflow"
          onClick={onRemove}
          className="text-[var(--color-accent-primary)] hover:bg-transparent hover:opacity-70"
        >
          <XIcon />
        </IconButton>
      </div>
    </div>
  );
}
