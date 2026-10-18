/**
 * The chat-side part of the per-turn `canvasContext`: the reference images the
 * user hearted in this chat. One source for the local chat path
 * (`buildCanvasContext`) and the agent panel (`withPanelCanvasContext`).
 */
import { useChatStore } from "@/store/chatStore";

export function getLikedReferences(sessionId?: string): Array<{ url: string; sourceUrl?: string; tool?: string }> {
  return ((sessionId ? useChatStore.getState().likedReferences[sessionId] : undefined) ?? []).map((r) => ({
    url: r.url,
    ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
    ...(r.tool ? { tool: r.tool } : {}),
  }));
}
