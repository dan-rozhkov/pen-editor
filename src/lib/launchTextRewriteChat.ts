import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { ChatLaunchPayload } from "@/types/chat";
import { buildRewriteMessage, type TextRewritePreset } from "@/lib/textRewritePresets";

/**
 * Start a Design Agent chat that rewrites the text of one or more selected
 * text nodes using a preset instruction (Figma "Rewrite this" analog).
 * Mirrors `launchNodeAgentChat`'s tab-creation/reveal semantics, but targets
 * an arbitrary set of node ids in a single message rather than one node with
 * an attached screenshot.
 *
 * Returns false (no side effects) when there are no target nodes.
 */
export function launchTextRewriteChat(
  nodeIds: string[],
  preset: TextRewritePreset,
): boolean {
  if (nodeIds.length === 0) return false;

  const payload: ChatLaunchPayload = {
    text: buildRewriteMessage(nodeIds, preset.instruction),
  };

  const tabId = useChatStore.getState().createTab();
  useChatStore.getState().queueLaunchPayload(tabId, payload);
  // Reveal the agents section AND open the panel: on a narrow (mobile) layout
  // LeftSidebar unmounts entirely while collapsed, which would leave the
  // queued message stranded with no session mounted to auto-send it.
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);

  return true;
}
