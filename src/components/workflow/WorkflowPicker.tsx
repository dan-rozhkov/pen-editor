import { CheckIcon, TreeStructureIcon, XIcon } from "@phosphor-icons/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { stepCountLabel, useWorkflowList } from "./useWorkflowList";

interface WorkflowPickerProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The composer's "Attach workflow" button: a menu of the stored workflows, newest first. */
export function WorkflowPicker({ selectedId, onSelect }: WorkflowPickerProps) {
  const items = useWorkflowList();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton type="button" variant="ghost" size="icon" tooltip="Attach workflow" className="size-[30px] text-text-muted hover:bg-secondary">
            <TreeStructureIcon size={18} weight="light" />
          </IconButton>
        }
      />
      <DropdownMenuContent side="top" align="start" className="max-h-72 min-w-56 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-text-muted">No workflows yet</div>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => onSelect(item.id)}>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="shrink-0 text-text-muted">{stepCountLabel(item.stepCount)}</span>
              {item.id === selectedId && <CheckIcon className="shrink-0" />}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorkflowChipProps {
  title: string;
  stepCount: number;
  onRemove: () => void;
}

/** The removable chip above the composer input for the attached workflow. */
export function WorkflowChip({ title, stepCount, onRemove }: WorkflowChipProps) {
  return (
    <div className="mb-2 flex pl-2">
      <div
        data-testid="workflow-chip"
        className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--color-accent-selection)] py-1 pr-1 pl-2 text-xs text-[var(--color-accent-primary)]"
      >
        <TreeStructureIcon size={14} className="shrink-0" />
        <span className="min-w-0 truncate">{title}</span>
        <span className="shrink-0 opacity-70">{stepCountLabel(stepCount)}</span>
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
