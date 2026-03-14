import { useRef, useState, useEffect, useCallback } from "react";
import clsx from "clsx";
import { PlusIcon } from "@phosphor-icons/react";
import { usePageStore } from "@/store/pageStore";

interface ContextMenuState {
  pageId: string;
  x: number;
  y: number;
}

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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleStartRename = (pageId: string) => {
    setEditingId(pageId);
    setContextMenu(null);
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

  const handleContextMenu = (e: React.MouseEvent, pageId: string) => {
    e.preventDefault();
    setContextMenu({ pageId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => closeContextMenu();
    document.addEventListener("click", handler);
    document.addEventListener("contextmenu", handler);
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("contextmenu", handler);
    };
  }, [contextMenu, closeContextMenu]);

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
      <div className="flex items-center justify-between pl-3 pr-1 pt-1.5 pb-1.5">
        <span className="text-xs font-medium text-secondary-foreground">
          Pages
        </span>
        <button
          onClick={() => addPage()}
          className="p-0.5 rounded text-text-muted hover:text-text-default hover:bg-surface-hover"
          title="Add page"
        >
          <PlusIcon size={14} />
        </button>
      </div>
      <div className="flex flex-col pt-0.5 pb-1.5">
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
            onContextMenu={(e) => handleContextMenu(e, page.id)}
            className={clsx(
              "flex items-center h-7 px-3 text-xs cursor-default select-none",
              page.id === activePageId
                ? "bg-surface-elevated text-text-default font-medium"
                : "text-text-secondary hover:bg-surface-elevated",
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
              <span className="truncate">{page.name}</span>
            )}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] bg-surface-panel border border-border-default rounded-md shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-text-default hover:bg-surface-hover"
            onClick={() => handleStartRename(contextMenu.pageId)}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-text-default hover:bg-surface-hover"
            onClick={() => {
              duplicatePage(contextMenu.pageId);
              setContextMenu(null);
            }}
          >
            Duplicate
          </button>
          {pages.length > 1 && (
            <>
              <div className="my-1 border-t border-border-default" />
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-surface-hover"
                onClick={() => {
                  deletePage(contextMenu.pageId);
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
