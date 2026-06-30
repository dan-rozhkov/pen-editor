import { launchNodeAgentChat } from "@/lib/launchNodeAgentChat";
import type { AgentMode } from "@/store/chatStore";

/**
 * Start a Design Agent chat seeded by an on-canvas embed ("code layer"). Unlike
 * frames, no screenshot is attached: an embed's PixiJS container is empty (its
 * HTML renders in a DOM overlay), so a Pixi screenshot would be blank. The
 * embed is identified to the backend through the current selection in
 * `canvasContext` instead.
 */
export function launchEmbedAgentChat(
  embedId: string,
  text: string,
  agentMode?: AgentMode,
): Promise<boolean> {
  return launchNodeAgentChat(embedId, text, { agentMode, attachScreenshot: false });
}
