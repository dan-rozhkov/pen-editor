import { launchNodeAgentChat } from "@/lib/launchNodeAgentChat";

/**
 * Start a Design Agent chat seeded by an on-canvas frame, attaching a
 * screenshot of the frame as visual context. Thin wrapper over
 * `launchNodeAgentChat`; kept for the frame-specific call site and its tests.
 */
export function launchFrameAgentChat(
  frameId: string,
  text: string,
): Promise<boolean> {
  return launchNodeAgentChat(frameId, text, { attachScreenshot: true });
}
