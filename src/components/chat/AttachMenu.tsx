import { CheckIcon, ImageIcon, PaperclipIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { useWorkflowList } from "@/components/workflow/useWorkflowList";

interface AttachMenuProps {
  /** Why images cannot be attached right now; null when they can. */
  imageDisabledReason: string | null;
  /** Muted note next to "Image" when attaching works but only as a text description. */
  imageHint?: string;
  onPickImage: () => void;
  selectedWorkflowId: string | null;
  /** The picked id, or null when the already attached workflow is picked again (detach). */
  onSelectWorkflow: (id: string | null) => void;
}

/** The composer's single "Attach" paperclip: an Image item and one item per stored workflow (newest first). */
export function AttachMenu({ imageDisabledReason, imageHint, onPickImage, selectedWorkflowId, onSelectWorkflow }: AttachMenuProps) {
  const items = useWorkflowList();
  const secondary = imageDisabledReason ?? imageHint;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton type="button" variant="ghost" size="icon" tooltip="Attach" className="size-[30px] text-text-muted hover:bg-secondary">
            <PaperclipIcon size={18} weight="light" />
          </IconButton>
        }
      />
      <DropdownMenuContent side="top" align="start" className="max-h-80 min-w-56 overflow-y-auto">
        <DropdownMenuItem disabled={imageDisabledReason !== null} onClick={onPickImage}>
          <ImageIcon weight="light" />
          <span className="shrink-0">Image</span>
          {secondary && <span className="min-w-0 flex-1 truncate text-right text-text-muted">{secondary}</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workflow</DropdownMenuLabel>
          {items.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-muted">No workflows yet</div>
          ) : (
            items.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => onSelectWorkflow(item.id === selectedWorkflowId ? null : item.id)}>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.id === selectedWorkflowId && <CheckIcon className="shrink-0" weight="light" />}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
