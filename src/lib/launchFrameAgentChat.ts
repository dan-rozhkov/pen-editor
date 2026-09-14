import { launchNodeAgentChat } from "@/lib/launchNodeAgentChat";

/**
 * Start a Design Agent chat seeded by an on-canvas frame. Does NOT attach a
 * screenshot — this is only ever invoked for the currently *selected* frame
 * (FrameAgentButton), so its id already rides along in the next request's
 * canvasContext (`selectedIds`). The agent can call `get_screenshot` with
 * that id itself if it needs to see the frame, instead of every launch
 * paying for a screenshot up front. Thin wrapper over `launchNodeAgentChat`;
 * kept for the frame-specific call site and its tests.
 */
export function launchFrameAgentChat(
  frameId: string,
  text: string,
): Promise<boolean> {
  return launchNodeAgentChat(frameId, text, { attachScreenshot: false });
}
