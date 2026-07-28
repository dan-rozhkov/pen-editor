import { consumeShowcaseAgentPrompt } from "@/lib/showcaseAgentHandoff";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

export function launchShowcaseAgentChat(): boolean {
  const text = consumeShowcaseAgentPrompt();
  if (!text) return false;

  const tabId = useChatStore.getState().createTab();
  useChatStore.getState().queueLaunchPayload(tabId, { text });
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);
  return true;
}
