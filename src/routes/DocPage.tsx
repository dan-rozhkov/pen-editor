import { useState } from "react";
import { CheckIcon, DotsThreeVerticalIcon, FilePlusIcon, FileTextIcon, ListIcon, TrashIcon } from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import { EditorProviders } from "@/components/EditorProviders";
import { DocEditor } from "@/components/doc/DocEditor";
import { DocTitle } from "@/components/doc/ui/DocTitle";
import { titleAfterTemplate } from "@/lib/docs/docTemplates";
import { useDocSync } from "@/components/doc/useDocSync";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";

/**
 * "/doc": a minimal WYSIWYG markdown editor over the localStorage docStore.
 * Runs as a desktop tab (`/doc?id=<id>&chat=off`) and in a plain browser.
 * Must not import App, Pixi or the chat: Tiptap lives only in this lazy chunk.
 */
export default function DocPage() {
  useHtmlRouteClass("route-doc");
  const sync = useDocSync();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <EditorProviders>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-panel text-text-primary">
        {sync.id === null ? (
          <main className="flex flex-1 flex-col items-center justify-center px-4">
            <EmptyState
              icon={<FileTextIcon weight="light" />}
              title="No documents yet"
              description="Create a document to start writing."
              action={
                <Button variant="outline" onClick={sync.create}>
                  <FilePlusIcon /> New document
                </Button>
              }
            />
          </main>
        ) : (
          <>
            {/* Same row as the chat header (OpenChatHeader) and the desktop browser bar. */}
            <header className="flex shrink-0 items-center gap-1 border-b border-border-default bg-surface-panel px-2 py-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton variant="ghost" size="icon" tooltip="Documents">
                      <ListIcon className="size-4" weight="light" />
                    </IconButton>
                  }
                />
                <DropdownMenuContent align="start" sideOffset={4} className="max-h-80 min-w-56 overflow-y-auto">
                  {sync.docs.map((doc) => (
                    <DropdownMenuItem key={doc.id} onClick={() => sync.select(doc.id)}>
                      <span className="truncate">{doc.title}</span>
                      {doc.id === sync.id && <CheckIcon className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={sync.create}>
                    <FilePlusIcon /> New document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text-primary">
                {sync.title.trim() || "Untitled"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton variant="ghost" size="icon" tooltip="Document options">
                      <DotsThreeVerticalIcon className="size-4" weight="bold" />
                    </IconButton>
                  }
                />
                <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
                  <DropdownMenuItem onClick={() => setConfirmingDelete(true)}>
                    <TrashIcon /> Delete document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            <main className="layers-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-24 pt-10 sm:px-24 sm:pt-16">
              <div className="mx-auto w-full max-w-[708px]">
                <DocTitle value={sync.title} onChange={sync.setTitle} onLeave={() => editor?.commands.focus("start")} />
                <DocEditor
                  key={sync.editorId}
                  markdown={sync.markdown}
                  revision={sync.revision}
                  onMarkdown={sync.onEditorMarkdown}
                  onSynced={sync.onEditorSynced}
                  onEditor={setEditor}
                  docId={sync.id}
                  onOpenDoc={sync.select}
                  onTemplateTitle={(title) => {
                    const next = titleAfterTemplate(sync.title, title);
                    if (next !== null) sync.setTitle(next);
                  }}
                />
              </div>
            </main>
          </>
        )}
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{sync.title.trim() || "Untitled"}”?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  sync.remove();
                  setConfirmingDelete(false);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </EditorProviders>
  );
}
