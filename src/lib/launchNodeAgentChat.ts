import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";
import { canLaunchAgent, launchAgentChat } from "@/lib/canvasLink/agentLaunch";
import { useSceneStore } from "@/store/sceneStore";
import type { AttachedImage, ChatLaunchPayload } from "@/types/chat";

/**
 * Start a new Design Agent chat seeded by an on-canvas node: the typed text
 * becomes the first message, optionally with a screenshot of the node attached
 * as visual context. Creates a fresh chat, queues the launch payload (the
 * session's auto-send effect delivers it once ready), and reveals the agents
 * panel (`launchAgentChat`, which also routes the launch to the agent panel from a
 * chatless tab with a running canvas host; the selection is not touched either way).
 *
 * Returns false (no side effects) when the text is empty/whitespace, or when
 * nothing can take the launch (chatless tab without a host, or the agent panel did not answer).
 *
 * `opts.attachScreenshot` (default false) controls whether a PixiJS screenshot
 * is attached — the node's id already rides along in the next request's
 * canvasContext, so the agent can call `get_screenshot` itself if it needs
 * pixels. Pass true only when a caller genuinely needs a screenshot attached
 * up front regardless.
 */
export async function launchNodeAgentChat(
  nodeId: string,
  text: string,
  opts: { attachScreenshot?: boolean } = {},
): Promise<boolean> {
  // Defence in depth: the UI entry points are hidden without `canLaunchAgent()`.
  if (!canLaunchAgent()) return false;
  const { attachScreenshot = false } = opts;
  const trimmed = text.trim();
  if (!trimmed) return false;

  let images: AttachedImage[] | undefined;
  if (attachScreenshot) {
    const dataUrl = await captureNodeScreenshot(nodeId);
    const name = useSceneStore.getState().nodesById[nodeId]?.name ?? "Node";
    images = dataUrl ? [{ dataUrl, name }] : undefined;
  }

  const payload: ChatLaunchPayload = { text: trimmed, images };
  return launchAgentChat(payload);
}
