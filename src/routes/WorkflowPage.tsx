import { useState } from "react";
import {
  CheckIcon,
  ClockIcon,
  ClipboardTextIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  ListIcon,
  PlusIcon,
  TrashIcon,
  TreeStructureIcon,
} from "@/components/icons";
import { toast } from "sonner";
import { EditorProviders } from "@/components/EditorProviders";
import { ScheduleDialog } from "@/components/workflow/ScheduleDialog";
import { useWorkflowSchedule } from "@/components/workflow/useWorkflowSchedule";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";
import { useWorkflowSync } from "@/components/workflow/useWorkflowSync";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { Textarea } from "@/components/ui/textarea";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import { markdownToSteps, stepsToMarkdown } from "@/lib/workflows/workflowMarkdown";
import { describeSchedule } from "@/lib/workflows/workflowSchedule";
import { stepsFromTexts } from "@/lib/workflows/workflowStore";

// Dots scroll with the content ("local"), not with the viewport.
const DOT_GRID_STYLE = {
  backgroundImage: "radial-gradient(color-mix(in oklab, var(--color-text-muted) 32%, transparent) 1px, transparent 1px)",
  backgroundSize: "20px 20px",
  backgroundAttachment: "local",
} as const;

// Schedules run in the desktop agent panel only; the button is hidden in a plain production browser.
const SCHEDULING_AVAILABLE = typeof window !== "undefined" && (typeof window.penDesktop !== "undefined" || import.meta.env.DEV);

/**
 * "/workflow": a visual editor for a workflow, a sequential chain of text steps
 * the agent can be asked to complete. Runs as a desktop tab
 * (`/workflow?id=<id>&chat=off`) and in a plain browser.
 * Must not import App, Pixi, the scene stores or the chat.
 */
export default function WorkflowPage() {
  useHtmlRouteClass("route-workflow");
  const sync = useWorkflowSync();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pasteText, setPasteText] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const schedule = useWorkflowSchedule(sync.id);

  const copyMarkdown = () => {
    const markdown = stepsToMarkdown(sync.steps.map((s) => s.text));
    void navigator.clipboard?.writeText(markdown).then(
      () => toast("Copied as Markdown"),
      () => toast.error("Could not copy to the clipboard."),
    );
  };

  const applyPaste = (mode: "append" | "replace") => {
    const texts = markdownToSteps(pasteText ?? "");
    setPasteText(null);
    if (texts.length === 0) return;
    const added = stepsFromTexts(texts);
    sync.setSteps((current) => (mode === "replace" ? added : [...current, ...added]));
  };

  const title = sync.title.trim() || "Untitled workflow";

  return (
    <EditorProviders>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-panel text-text-primary">
        {sync.id === null ? (
          <main className="flex flex-1 flex-col items-center justify-center px-4">
            <EmptyState
              icon={<TreeStructureIcon size={32} weight="light" />}
              title="No workflows yet"
              description="Create a workflow to describe the steps the agent should follow."
              action={
                <Button variant="outline" onClick={sync.create}>
                  <PlusIcon weight="light" /> New workflow
                </Button>
              }
            />
          </main>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-1 border-b border-border-default bg-surface-panel px-2 py-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton variant="ghost" size="icon" tooltip="Workflows">
                      <ListIcon className="size-4" weight="light" />
                    </IconButton>
                  }
                />
                <DropdownMenuContent align="start" sideOffset={4} className="max-h-80 min-w-56 overflow-y-auto">
                  {sync.workflows.map((workflow) => (
                    <DropdownMenuItem key={workflow.id} onClick={() => sync.select(workflow.id)}>
                      <span className="truncate">{workflow.title}</span>
                      {workflow.id === sync.id && <CheckIcon className="ml-auto" weight="light" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={sync.create}>
                    <PlusIcon weight="light" /> New workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input
                aria-label="Workflow title"
                placeholder="Untitled workflow"
                value={sync.title}
                spellCheck={false}
                onChange={(event) => sync.setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="min-w-0 flex-1 rounded-control border-0 bg-transparent px-1 py-1 text-sm font-medium text-text-primary outline-none placeholder:text-text-muted/60 focus-visible:ring-1 focus-visible:ring-accent-light"
              />
              {SCHEDULING_AVAILABLE &&
                (schedule?.enabled ? (
                  <Button variant="ghost" size="sm" onClick={() => setScheduling(true)} className="max-w-40 shrink-0 gap-1 sm:max-w-64">
                    <ClockIcon className="size-4 shrink-0" weight="light" />
                    <span className="truncate text-xs">{describeSchedule(schedule)}</span>
                  </Button>
                ) : (
                  <IconButton variant="ghost" size="icon" tooltip="Schedule" onClick={() => setScheduling(true)}>
                    <ClockIcon className="size-4" weight="light" />
                  </IconButton>
                ))}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton variant="ghost" size="icon" tooltip="Workflow options">
                      <DotsThreeVerticalIcon className="size-4" weight="light" />
                    </IconButton>
                  }
                />
                <DropdownMenuContent align="end" sideOffset={4} className="min-w-48">
                  <DropdownMenuItem onClick={copyMarkdown}>
                    <CopyIcon weight="light" /> Copy as Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPasteText("")}>
                    <ClipboardTextIcon weight="light" /> Paste from Markdown
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConfirmingDelete(true)}>
                    <TrashIcon weight="light" /> Delete workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            <main className="layers-scrollbar min-h-0 flex-1 overflow-y-auto bg-surface-base px-4 py-12" style={DOT_GRID_STYLE}>
              <WorkflowCanvas steps={sync.steps} setSteps={sync.setSteps} />
            </main>
          </>
        )}

        <Dialog open={pasteText !== null} onOpenChange={(open) => !open && setPasteText(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Paste from Markdown</DialogTitle>
              <DialogDescription>Each list item becomes a step. Without a list, each line does.</DialogDescription>
            </DialogHeader>
            <Textarea
              aria-label="Markdown"
              autoFocus
              value={pasteText ?? ""}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={"1. First step\n2. Second step"}
              className="min-h-28"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => applyPaste("append")} disabled={markdownToSteps(pasteText ?? "").length === 0}>
                Add to end
              </Button>
              <Button variant="accent" onClick={() => applyPaste("replace")} disabled={markdownToSteps(pasteText ?? "").length === 0}>
                Replace steps
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ScheduleDialog workflowId={sync.id} open={scheduling} onOpenChange={setScheduling} />

        <ConfirmDeleteDialog open={confirmingDelete} onOpenChange={setConfirmingDelete} name={title} onConfirm={sync.remove} />
      </div>
    </EditorProviders>
  );
}
