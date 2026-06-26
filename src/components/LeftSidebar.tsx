import { useRef, useState } from "react";
import { ArrowsInLineVertical } from "@phosphor-icons/react";
import { LayersPanel } from "./layers";
import { ComponentsPanel } from "./ComponentsPanel";
import { PagesPanel } from "./PagesPanel";
import { ChatPanelContent } from "./chat/ChatPanel";
import { Toolbar } from "./Toolbar";
import { useSceneStore } from "@/store/sceneStore";
import { useDocumentStore } from "@/store/documentStore";
import { usePageStore } from "@/store/pageStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useChatStore } from "@/store/chatStore";

function PagesPanelSection() {
  const hasPages = usePageStore((s) => s.pages.length > 0);
  if (!hasPages) return null;
  return <PagesPanel />;
}

export function LeftSidebar() {
  const activeSection = useLeftSidebarStore((s) => s.activeSection);
  const isChatExpanded = useChatStore((s) => s.isExpanded);
  const collapseAllFrames = useSceneStore((s) => s.collapseAllFrames);
  const hasExpanded = useSceneStore((s) => s.expandedFrameIds.size > 0);
  const fileName = useDocumentStore((s) => s.fileName);
  const setFileName = useDocumentStore((s) => s.setFileName);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = fileName ? fileName.replace(/\.[^.]+$/, "") : "Untitled";
  const extension = fileName?.match(/\.[^.]+$/)?.[0] ?? "";

  const handleStartEdit = () => {
    setIsEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  };

  const handleFinishEdit = () => {
    setIsEditing(false);
    const value = inputRef.current?.value.trim();
    if (value) {
      setFileName(value + extension);
    }
  };

  return (
    <div className="w-[300px] h-full flex flex-col bg-surface-panel border-r border-border-default">
      {/* Pages keeps the File menu header; Agents has its own header (inside the
          chat); Components gets a titled header styled like the chat's. */}
      {activeSection === "pages" && (
        <div className="flex flex-row items-center gap-0 pr-1">
          <div className="flex-1 min-w-0">
            <Toolbar />
          </div>
        </div>
      )}
      {activeSection === "components" && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">
            Components
          </span>
        </div>
      )}
      {activeSection === "pages" && (
        <div className="px-2 pb-2">
          {isEditing ? (
            <input
              ref={inputRef}
              defaultValue={displayName}
              onBlur={handleFinishEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFinishEdit();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="w-full h-7 px-1 py-0.5 rounded text-sm font-medium text-text-default bg-secondary outline-none"
            />
          ) : (
            <div
              onClick={handleStartEdit}
              className="h-7 px-1 rounded truncate text-sm font-medium text-text-default cursor-text hover:bg-secondary flex items-center"
            >
              {displayName}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 relative overflow-hidden">
        {/* Pages section: pages list + layer tree of the active page */}
        {activeSection === "pages" && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <PagesPanelSection />
            {hasExpanded && (
              <div className="px-1 pt-1 pb-1 flex items-center justify-end">
                <button
                  onClick={collapseAllFrames}
                  className="p-1 rounded text-text-muted hover:text-text-default hover:bg-surface-hover transition-colors"
                  title="Collapse all"
                >
                  <ArrowsInLineVertical size={14} />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              <LayersPanel />
            </div>
          </div>
        )}

        {/* Components section */}
        {activeSection === "components" && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <ComponentsPanel />
          </div>
        )}

        {/* Agents (chat) — always mounted so streams survive section switches.
            Inline within the body, or fixed full-canvas overlay when expanded. */}
        <div
          className={
            activeSection !== "agents"
              ? "hidden"
              : isChatExpanded
                ? "fixed top-0 left-14 right-0 bottom-0 z-50 flex flex-col bg-surface-panel"
                : "absolute inset-0 flex flex-col"
          }
        >
          <ChatPanelContent />
        </div>
      </div>
    </div>
  );
}
