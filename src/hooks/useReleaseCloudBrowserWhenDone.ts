import { useEffect, useRef } from "react";
import { releaseCloudBrowser } from "@/lib/cloudBrowser";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";

// How long the chat must stay idle before its browser is released. Not
// released right at turn end: an agent often ends a turn with a plain-text
// question, and the user's answer should find the same page (login, filled
// form, scroll) still open. It also absorbs `chat.status`'s brief "ready" dips
// between tool-loop steps. Kept under the backend's CLOUD_BROWSER_IDLE_MS
// (5 min) so the preview closes before the session silently dies.
export const RELEASE_IDLE_MS = 3 * 60_000;

/**
 * Releases the chat's cloud browser once the agent's work has really ended: not
 * streaming, not paused on an ask_user answer, nothing queued. Runs from the
 * always-mounted part of ChatPanel so background chats release too.
 */
export function useReleaseCloudBrowserWhenDone({
  chatId,
  isBusy,
  awaitingAnswer,
  hasQueuedMessages,
}: {
  chatId: string;
  isBusy: boolean;
  awaitingAnswer: boolean;
  hasQueuedMessages: boolean;
}): void {
  const working = isBusy || awaitingAnswer || hasQueuedMessages;
  // Only a working -> idle edge counts, so a chat that merely mounts idle
  // (or re-renders) never triggers a release.
  const wasWorkingRef = useRef(false);

  useEffect(() => {
    const finished = wasWorkingRef.current && !working;
    wasWorkingRef.current = working;
    if (!finished) return;
    const timer = setTimeout(() => {
      if (isDesktopBrowserAvailable()) return;
      if (!useCloudBrowserStore.getState().sessions[chatId]) return;
      void releaseCloudBrowser(chatId);
    }, RELEASE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [chatId, working]);
}
