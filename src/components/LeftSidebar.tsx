import { useRef, useState } from "react";
import { ArrowsInLineVertical } from "@phosphor-icons/react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { LayersPanel } from "./layers";
import { ComponentsPanel } from "./ComponentsPanel";
import { SlidesPanel } from "./SlidesPanel";
import { PagesPanel } from "./PagesPanel";
import { ChatPanelContent } from "./chat/ChatPanel";
import { VariablesPanelContent } from "./VariablesPanel";
import { TextStylesPanelContent } from "./TextStylesPanel";
import { StylesPanelContent } from "./StylesPanel";
import { Toolbar } from "./Toolbar";
import { useSceneStore } from "@/store/sceneStore";
import { useDocumentStore } from "@/store/documentStore";
import { usePageStore } from "@/store/pageStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import { useChatStore } from "@/store/chatStore";
import { useIsMobile } from "@/hooks/useIsMobile";

function PagesPanelSection() {
  const hasPages = usePageStore((s) => s.pages.length > 0);
  if (!hasPages) return null;
  return <PagesPanel />;
}

export function LeftSidebar() {
  const activeSection = useLeftSidebarStore((s) => s.activeSection);
  const isPanelOpen = useLeftSidebarStore((s) => s.isPanelOpen);
  const isMobile = useIsMobile();
  const isChatExpanded = useChatStore((s) => s.isExpanded);
  const isPanelExpanded = useLeftSidebarStore((s) => s.isExpanded);
  const collapseAllFrames = useSceneStore((s) => s.collapseAllFrames);
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

  // On mobile the panel is hidden until the rail opens it, then it covers the
  // full screen width to the right of the rail. On desktop it is a fixed 300px
  // column that is always visible.
  if (isMobile && !isPanelOpen) return null;

  return (
    <div
      className={
        isMobile
          ? "fixed top-0 left-14 right-0 bottom-0 z-50 flex flex-col bg-surface-panel"
          : "w-[300px] h-full flex flex-col bg-surface-panel border-r border-border-default"
      }
    >
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
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">
            Components
          </span>
        </div>
      )}
      {activeSection === "slides" && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default shrink-0">
          <span className="text-sm font-medium text-text-primary flex-1">
            Slides
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
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span className="text-xs font-medium text-secondary-foreground">
                Layers
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={collapseAllFrames}
                      aria-label="Collapse all"
                      className="p-0.5 rounded text-text-muted hover:text-text-default hover:bg-secondary transition-colors"
                    >
                      <ArrowsInLineVertical size={14} />
                    </button>
                  }
                />
                <TooltipContent side="bottom">Collapse all</TooltipContent>
              </Tooltip>
            </div>
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

        {/* Slides section: one-per-row previews of top-level frames, no
            layer tree — a separate section from Pages, not a toggle inside it. */}
        {activeSection === "slides" && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <SlidesPanel />
          </div>
        )}

        {/* Agents (chat) — always mounted so streams survive section switches.
            Inline within the body, or fixed full-canvas overlay when expanded. */}
        <div
          className={
            activeSection !== "agents"
              ? "hidden"
              : isChatExpanded
                ? "fixed top-0 left-14 right-0 bottom-0 z-[60] flex flex-col bg-surface-panel"
                : "absolute inset-0 flex flex-col"
          }
        >
          <ChatPanelContent />
        </div>

        {/* Variables section — inline within the body, or fixed full-canvas
            overlay when expanded (same pattern as Agents). */}
        {activeSection === "variables" && (
          <div
            className={
              isPanelExpanded
                ? "fixed top-0 left-14 right-0 bottom-0 z-[60] flex flex-col bg-surface-panel"
                : "absolute inset-0 flex flex-col"
            }
          >
            <VariablesPanelContent />
          </div>
        )}

        {/* Text styles section */}
        {activeSection === "textStyles" && (
          <div
            className={
              isPanelExpanded
                ? "fixed top-0 left-14 right-0 bottom-0 z-[60] flex flex-col bg-surface-panel"
                : "absolute inset-0 flex flex-col"
            }
          >
            <TextStylesPanelContent />
          </div>
        )}

        {/* Styles section */}
        {activeSection === "styles" && (
          <div
            className={
              isPanelExpanded
                ? "fixed top-0 left-14 right-0 bottom-0 z-[60] flex flex-col bg-surface-panel"
                : "absolute inset-0 flex flex-col"
            }
          >
            <StylesPanelContent />
          </div>
        )}
      </div>
    </div>
  );
}
