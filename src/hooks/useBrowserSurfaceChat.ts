import { useChatStore } from "@/store/chatStore";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";
import { useSurfaceStore } from "@/store/surfaceStore";

/**
 * The chat whose cloud session the browser surface shows: the chat it was
 * opened from while that chat still has a session, else the active chat (so a
 * released or expired session falls back instead of showing nothing).
 */
export function useBrowserSurfaceChatId(): string | null {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const pinned = useSurfaceStore((s) => s.browserChatId);
  const pinnedHasSession = useCloudBrowserStore((s) => (pinned ? pinned in s.sessions : false));
  return pinned && pinnedHasSession ? pinned : activeChatId;
}
