import { useState } from "react";
import { CaretDownIcon, CheckIcon, FilePlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import { EditorProviders } from "@/components/EditorProviders";
import { DocEditor } from "@/components/doc/DocEditor";
import { DocToolbar } from "@/components/doc/DocToolbar";
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
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
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
      <div className="flex min-h-dvh flex-col bg-surface-panel text-text-primary">
        {sync.id === null ? (
          <main className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="text-sm text-text-muted">No documents yet.</p>
            <Button variant="outline" onClick={sync.create}>
              <FilePlusIcon /> New document
            </Button>
          </main>
        ) : (
          <>
            <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-default bg-surface-panel px-3 py-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Documents" className="text-text-muted" />}>
                  Documents <CaretDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
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
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
                    <TrashIcon /> Delete document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Input
                aria-label="Title"
                value={sync.title}
                onChange={(event) => sync.setTitle(event.target.value)}
                placeholder="Untitled"
                className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-sm font-medium sm:w-48 sm:flex-none md:text-sm"
              />
              <span aria-hidden className="mx-1 hidden h-4 w-px shrink-0 bg-border-default sm:block" />
              <div className="order-last flex w-full flex-wrap sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
                <DocToolbar editor={editor} />
              </div>
              <IconButton tooltip="New document" variant="ghost" size="icon-sm" className="text-text-muted" onClick={sync.create}>
                <FilePlusIcon />
              </IconButton>
            </header>
            <main className="flex-1 px-6 py-10 sm:py-14">
              <div className="mx-auto w-full max-w-[720px]">
                <DocEditor
                  key={sync.editorId}
                  markdown={sync.markdown}
                  revision={sync.revision}
                  onMarkdown={sync.onEditorMarkdown}
                  onSynced={sync.onEditorSynced}
                  onEditor={setEditor}
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
