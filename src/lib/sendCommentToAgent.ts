import { useChatStore } from "@/store/chatStore";
import { useCommentsStore } from "@/store/commentsStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { ChatLaunchPayload } from "@/types/chat";

/**
 * "Send to agent" from a comment thread: open a fresh Design Agent chat seeded
 * with a message that points the agent at comment #N, then reveal the agents
 * panel. The agent takes it from there — it calls `read_comments` to pull the
 * thread (with its node anchor), acts, and can `reply_comment` / `resolve_comment`.
 *
 * Mirrors `launchNodeAgentChat`'s tab-create + queue-payload + reveal-panel
 * flow (no screenshot — the anchor already gives the agent a precise nodeId).
 * Returns false (no side effects) when the thread doesn't exist.
 */
export function sendCommentToAgent(threadId: string): boolean {
  const thread = useCommentsStore.getState().threads.find((t) => t.id === threadId);
  if (!thread) return false;

  const payload: ChatLaunchPayload = {
    text: `разберись с комментарием #${thread.order}`,
  };

  const tabId = useChatStore.getState().createTab();
  useChatStore.getState().queueLaunchPayload(tabId, payload);
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);

  return true;
}
