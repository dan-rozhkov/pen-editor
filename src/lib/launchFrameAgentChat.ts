import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";
import type { AttachedImage, ChatLaunchPayload } from "@/types/chat";

/**
 * Start a new Design Agent chat seeded by an on-canvas frame: the typed text
 * becomes the first message and a screenshot of the frame is attached as visual
 * context. Creates a fresh chat tab, queues the launch payload (the session's
 * auto-send effect delivers it once ready), and reveals the agents panel.
 *
 * Returns false (no side effects) when the text is empty/whitespace.
 */
export async function launchFrameAgentChat(
  frameId: string,
  text: string,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const dataUrl = await captureNodeScreenshot(frameId);
  const name = useSceneStore.getState().nodesById[frameId]?.name ?? "Frame";
  const images: AttachedImage[] | undefined = dataUrl
    ? [{ dataUrl, name }]
    : undefined;

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
