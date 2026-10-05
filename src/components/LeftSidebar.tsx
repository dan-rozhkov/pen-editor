import { ChatPanelContent } from "./chat/ChatPanel";
import { Toolbar } from "./Toolbar";
import { useChatStore } from "@/store/chatStore";
import { LeftSidebarBase } from "./LeftSidebarBase";

// Agents (chat) — always mounted so streams survive section switches.
// Inline within the body, or fixed full-canvas overlay when expanded.
function AgentsPane({ active }: { active: boolean }) {
  const isChatExpanded = useChatStore((s) => s.isExpanded);
  return (
    <div
      className={
        !active
          ? "hidden"
          : isChatExpanded
            ? "fixed top-0 left-14 right-0 bottom-0 z-[60] flex flex-col bg-surface-panel"
            : "absolute inset-0 flex flex-col"
      }
    >
      <ChatPanelContent />
    </div>
  );
}

export function LeftSidebar() {
  return <LeftSidebarBase renderHeader={() => <Toolbar />} renderAgents={(active) => <AgentsPane active={active} />} />;
}
