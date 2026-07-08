import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { ChatLaunchPayload } from "@/types/chat";

export type FirstDraftPlatform = "mobile" | "desktop";

/**
 * Start a Design Agent chat that runs the `/first-draft` skill (Figma "First
 * Draft" analog): the user provides a one-sentence description and a target
 * platform, and this dispatches a synthetic `/first-draft` message into a
 * fresh chat tab pinned to `edits` mode (native nodes + auto-layout, no
 * embed-HTML). Mirrors `launchTextRewriteChat`'s tab-creation/reveal
 * semantics.
 *
 * Returns false (no side effects) when the description is empty/whitespace.
 */
export function launchFirstDraftChat(
  description: string,
  platform: FirstDraftPlatform,
): boolean {
  const trimmed = description.trim();
  if (!trimmed) return false;

  const payload: ChatLaunchPayload = {
    text: `/first-draft ${trimmed}\n\nPlatform: ${platform}`,
  };

  const tabId = useChatStore.getState().createTab();
  useChatStore.getState().setTabAgentMode(tabId, "edits");
  useChatStore.getState().queueLaunchPayload(tabId, payload);
  // Reveal the agents section AND open the panel: on a narrow (mobile) layout
  // LeftSidebar unmounts entirely while collapsed, which would leave the
  // queued message stranded with no session mounted to auto-send it.
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);

  return true;
}
