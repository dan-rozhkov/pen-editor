import { useEffect } from "react";
import { Navigate } from "react-router";
import { EditorProviders } from "@/components/EditorProviders";
import { ChatPanelContent } from "@/components/chat/ChatPanel";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import { useChatBootstrap } from "@/hooks/useChatBootstrap";
import { isAgentPanelHost } from "@/lib/agentPanel";
import { startPanelRuntime } from "@/lib/canvasLink/panelRuntime";
import { startDesktopChatPersistence } from "@/lib/chats/desktopChatPersistence";
import { startWorkflowScheduler } from "@/lib/workflows/workflowScheduler";

/**
 * "/agent": the agent chat on its own (chat list + open chat), full height.
 * Meant for a narrow fixed panel in the desktop shell. It must NOT import
 * App.tsx or mount PixiCanvas / a pixi.js Application: no canvas lives here.
 * Outside the desktop agent panel (and dev) it redirects to /app.
 */
export default function AgentPage() {
  if (!isAgentPanelHost()) return <Navigate to="/app" replace />;
  return <AgentPanel />;
}

function AgentPanel() {
  useChatBootstrap();
  // The canvas-link client listens from the start, not from the first chat request (canvas `launch`es).
  useEffect(() => {
    startPanelRuntime();
  }, []);
  // Desktop shell: show the chats stored on disk and keep saving them. No-op without the bridge.
  useEffect(() => {
    void startDesktopChatPersistence();
  }, []);
  // Scheduled workflows start new chats from this panel (desktop only: AgentPage is gated by isAgentPanelHost).
  useEffect(() => startWorkflowScheduler(), []);
  // body defaults to --color-surface-base; paint the panel surface edge to
  // edge (overscroll, resize gaps) so the page matches the desktop island.
  useHtmlRouteClass("route-agent");
  return (
    <EditorProviders>
      <div
        role="region"
        aria-label="Sideform Agent"
        className="h-dvh w-full overflow-hidden bg-surface-panel"
      >
        {/* isVisible: there is no sidebar section to derive visibility from,
            and the global leftSidebarStore must not be touched (it would leak
            into /app on SPA navigation). */}
        <ChatPanelContent variant="standalone" isVisible />
      </div>
    </EditorProviders>
  );
}
