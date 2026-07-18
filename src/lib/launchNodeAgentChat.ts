import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { AttachedImage, ChatLaunchPayload } from "@/types/chat";

/**
 * Start a new Design Agent chat seeded by an on-canvas node: the typed text
 * becomes the first message, optionally with a screenshot of the node attached
 * as visual context. Creates a fresh chat tab, queues the launch payload (the
 * session's auto-send effect delivers it once ready), and reveals the agents
 * panel.
 *
 * Returns false (no side effects) when the text is empty/whitespace.
 *
 * `opts.attachScreenshot` (default true) controls whether a PixiJS screenshot
 * is attached — embeds render via a DOM overlay with an empty Pixi container,
 * so callers pass false for them.
 */
export async function launchNodeAgentChat(
  nodeId: string,
  text: string,
  opts: { attachScreenshot?: boolean } = {},
): Promise<boolean> {
  const { attachScreenshot = true } = opts;
  const trimmed = text.trim();
  if (!trimmed) return false;

  let images: AttachedImage[] | undefined;
  if (attachScreenshot) {
    const dataUrl = await captureNodeScreenshot(nodeId);
    const name = useSceneStore.getState().nodesById[nodeId]?.name ?? "Node";
    images = dataUrl ? [{ dataUrl, name }] : undefined;
  }

  const payload: ChatLaunchPayload = { text: trimmed, images };

  const tabId = useChatStore.getState().createTab();
  useChatStore.getState().queueLaunchPayload(tabId, payload);
  // Reveal the agents section AND open the panel: on a narrow (mobile) layout
  // LeftSidebar unmounts entirely while collapsed, which would leave the queued
  // message stranded with no session mounted to auto-send it.
  useLeftSidebarStore.getState().setActiveSection("agents");
  useLeftSidebarStore.getState().setPanelOpen(true);

  return true;
}
