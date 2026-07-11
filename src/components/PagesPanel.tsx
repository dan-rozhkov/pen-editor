import { useRef, useState } from "react";
import clsx from "clsx";
import { DotsThreeVertical, PlusIcon } from "@phosphor-icons/react";
import { usePageStore } from "@/store/pageStore";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { IconButton } from "@/components/ui/IconButton";

export function PagesPanel() {
  const pages = usePageStore((s) => s.pages);
  const activePageId = usePageStore((s) => s.activePageId);
  const switchToPage = usePageStore((s) => s.switchToPage);
  const addPage = usePageStore((s) => s.addPage);
  const renamePage = usePageStore((s) => s.renamePage);
  const deletePage = usePageStore((s) => s.deletePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const reorderPages = usePageStore((s) => s.reorderPages);

  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleStartRename = (pageId: string) => {
    setEditingId(pageId);
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  };

  const handleFinishRename = (pageId: string) => {
    const value = inputRef.current?.value.trim();
    if (value) {
      renamePage(pageId, value);
    }
    setEditingId(null);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      reorderPages(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <div className="border-y border-border-default">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-secondary-foreground">
          Pages
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={() => addPage()}
                className="p-0.5 rounded text-text-muted hover:text-text-default hover:bg-secondary"
                aria-label="Add page"
              >
                <PlusIcon size={14} />
              </button>
            }
          />
          <TooltipContent>Add page</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-0.5 px-4 pt-1 pb-3">
        {pages.map((page, index) => (
          <div
            key={page.id}
            draggable={editingId !== page.id}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => {
              if (editingId !== page.id) {
                switchToPage(page.id);
              }
            }}
            onDoubleClick={() => handleStartRename(page.id)}
            className={clsx(
              "group/page flex items-center h-7 rounded-md pl-2 pr-1 text-xs cursor-default select-none",
              page.id === activePageId
                ? "bg-secondary text-text-default font-medium"
                : "text-text-secondary hover:bg-secondary",
              dropIndex === index &&
                dragIndex !== null &&
                dragIndex !== index &&
                "border-t border-accent-primary",
            )}
          >
            {editingId === page.id ? (
              <input
                ref={inputRef}
                defaultValue={page.name}
                onBlur={() => handleFinishRename(page.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFinishRename(page.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-transparent outline-none text-xs"
                autoFocus
              />
            ) : (
              <>
                <span className="truncate flex-1">{page.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <IconButton
                        tooltip="Page options"
                        onClick={(e) => e.stopPropagation()}
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover/page:opacity-100 data-popup-open:opacity-100 text-text-muted hover:text-text-default hover:bg-secondary shrink-0"
                      >
                        <DotsThreeVertical size={14} weight="bold" />
                      </IconButton>
                    }
                  />
                  <DropdownMenuContent side="right" align="start">
                    <DropdownMenuItem onClick={() => duplicatePage(page.id)}>
                      Duplicate
                    </DropdownMenuItem>
                    {pages.length > 1 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => deletePage(page.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
