import { useMemo, useState } from "react";
import { ChatCircleIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useCommentsStore, type CommentThread } from "@/store/commentsStore";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import { isThreadUnattached, isAgentThread } from "@/lib/comments/commentsLogic";
import { navigateToThread } from "@/lib/comments/commentNavigation";
import { IconButton } from "@/components/ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelEmptyState } from "@/components/PanelEmptyState";

interface PanelRow {
  thread: CommentThread;
  pageId: string | null;
  pageName: string;
  unattached: boolean;
}

/**
 * Comments tab body (LeftRail section "comments"): lists every thread in the
 * document (current page + others), with "Show resolved" and "Current page
 * only" filters and an "unattached" badge for node-anchored threads whose node
 * is gone. Clicking a row navigates to the pin (switching page if needed).
 */
export function CommentsPanelContent() {
  const [showResolved, setShowResolved] = useState(false);
  const [currentPageOnly, setCurrentPageOnly] = useState(true);

  const liveThreads = useCommentsStore((s) => s.threads);
  const nodesById = useSceneStore((s) => s.nodesById);
  const pages = usePageStore((s) => s.pages);
  const activePageId = usePageStore((s) => s.activePageId);

  const rows = useMemo<PanelRow[]>(() => {
    const out: PanelRow[] = [];
    // Active page: use the live store threads (source of truth), resolving
    // attachment against the live scene.
    for (const thread of liveThreads) {
      out.push({
        thread,
        pageId: null,
        pageName: pages.find((p) => p.id === activePageId)?.name ?? "",
        unattached: isThreadUnattached(thread, nodesById),
      });
    }
    if (!currentPageOnly) {
      for (const page of pages) {
        if (page.id === activePageId) continue;
        for (const thread of page.comments ?? []) {
          // Other pages' nodes aren't in the live scene map; resolve attachment
          // against that page's own node map instead.
          out.push({
            thread,
            pageId: page.id,
            pageName: page.name,
            unattached: isThreadUnattached(thread, page.nodesById),
          });
        }
      }
    }
    return out
      .filter((r) => (showResolved ? true : r.thread.resolvedAt == null))
      .sort((a, b) => a.thread.order - b.thread.order);
  }, [liveThreads, nodesById, pages, activePageId, showResolved, currentPageOnly]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default shrink-0">
        <span className="flex-1 text-sm font-medium text-text-primary">Threads</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                data-testid="threads-settings-trigger"
                variant="ghost"
                size="icon-sm"
                tooltip="Thread settings"
                aria-label="Thread settings"
              >
                <SlidersHorizontalIcon size={16} />
              </IconButton>
            }
          />
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuCheckboxItem
              checked={showResolved}
              onCheckedChange={setShowResolved}
            >
              Show resolved
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={currentPageOnly}
              onCheckedChange={setCurrentPageOnly}
            >
              Current page only
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <PanelEmptyState icon={<ChatCircleIcon size={28} weight="light" />}>
            No comments yet. Press C and click the canvas to add one.
          </PanelEmptyState>
        ) : (
          <ul className="flex flex-col gap-1 p-2">
            {rows.map((row) => (
              <li key={row.thread.id}>
                <button
                  data-comment-row
                  data-thread-id={row.thread.id}
                  onClick={() => navigateToThread(row.thread.id)}
                  className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left hover:bg-secondary"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">
                      #{row.thread.order}
                    </span>
                    {isAgentThread(row.thread) && (
                      <span className="rounded bg-violet-500/15 px-1 py-0.5 text-[10px] text-violet-500">
                        Agent
                      </span>
                    )}
                    {row.thread.resolvedAt != null && (
                      <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-text-muted">
                        Resolved
                      </span>
                    )}
                    {row.unattached && (
                      <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-600">
                        Unattached
                      </span>
                    )}
                    {row.pageId && (
                      <span className="ml-auto truncate text-[10px] text-text-muted">
                        {row.pageName}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-text-primary">
                    {row.thread.messages[0]?.text ?? ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
