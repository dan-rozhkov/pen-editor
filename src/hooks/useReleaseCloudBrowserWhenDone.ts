import { useEffect, useRef } from "react";
import { releaseCloudBrowser } from "@/lib/cloudBrowser";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";

// `chat.status` dips to "ready" between tool-loop steps (a failed tool input
// settles the stream before the SDK auto-continues) and a queued message is
// sent a tick after the turn ends. Releasing on that dip would kill the browser
// mid-task and lose page state, so the release waits this long for the chat to
// turn busy again; the real gaps are milliseconds.
export const RELEASE_GRACE_MS = 2_000;

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
    }, RELEASE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [chatId, working]);
}
