import { launchNodeAgentChat } from "@/lib/launchNodeAgentChat";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";

/**
 * Start a new Design Agent chat seeded from a picked embed element. Thin
 * wrapper over `launchNodeAgentChat` keyed by the *embed's* node id, not the
 * element: the embed's id is what rides along in the next request's
 * canvasContext, and the picked element itself already travels there too,
 * as `canvasContext.selectedEmbedElement` (see `buildCanvasContext` in
 * `src/hooks/useDesignChat.ts`). No screenshot is attached — the agent has
 * the element's outerHTML/path/text preview already and can call
 * `get_screenshot` itself if it needs pixels.
 */
export function launchEmbedElementAgentChat(
  selection: EmbedElementSelection,
  text: string,
): Promise<boolean> {
  return launchNodeAgentChat(selection.embedId, text, { attachScreenshot: false });
}
