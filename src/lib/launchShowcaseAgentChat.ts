import { isChatDisabled } from "@/lib/chatMode";
import { deliverAgentLaunch, isCanvasHostRunning } from "@/lib/canvasLink/agentLaunch";
import { consumeShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

/**
 * Chatless tab: the prompt stays in sessionStorage until the canvas host is
 * registered, then it is forwarded once to the agent panel (and removed). Without a
 * host it is left untouched. `App.tsx` calls this again when the host starts.
 */
export function launchShowcaseAgentChat(): boolean {
  const remote = isChatDisabled();
  if (remote && !isCanvasHostRunning()) return false;

  const text = consumeShowcaseAgentPrompt();
  if (!text) return false;

  if (remote) return deliverAgentLaunch({ text, target: "new-chat" });

  const chatId = useChatStore.getState().createChat();
  useChatStore.getState().queueLaunchPayload(chatId, { text });
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);
  return true;
}
