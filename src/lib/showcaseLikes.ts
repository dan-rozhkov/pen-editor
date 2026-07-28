import { useCallback, useEffect, useRef, useState } from "react";

import { likeShowcaseApp } from "@/lib/showcase";

// Which apps this visitor has ever clapped — cosmetic only (fills the heart),
// never consulted for the counter or the feed's ordering. Same `pen.` prefix
// convention as pixiSync's dev-only localStorage flags.
const LIKED_STORAGE_KEY = "pen.showcase.liked";

// A single POST's `count` is bounded 1..25 server-side (not a rate limit,
// just a guard against a single request posting an absurd number) — a burst
// bigger than that is split into multiple sequential requests so nothing is
// lost, it's just not one round trip anymore.
export const MAX_LIKE_COUNT_PER_REQUEST = 25;

const LIKE_DEBOUNCE_MS = 700;

function readLikedRunIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LIKED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : new Set();
  } catch {
    // Safari private mode throws on localStorage access; cosmetic feature,
    // just behave as if nothing has ever been liked.
    return new Set();
  }
}

export function hasLikedShowcaseApp(runId: string): boolean {
  return readLikedRunIds().has(runId);
}

export function markShowcaseAppLiked(runId: string): void {
  try {
    const set = readLikedRunIds();
    if (set.has(runId)) return;
    set.add(runId);
    localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Cosmetic only — ignore write failures the same way reads are ignored.
  }
}

/** Splits an accumulated delta into requests of at most 25 each, in order. */
export function chunkLikeDelta(
  delta: number,
  maxPerRequest: number = MAX_LIKE_COUNT_PER_REQUEST,
): number[] {
  const chunks: number[] = [];
  let remaining = delta;
  while (remaining > 0) {
    const chunk = Math.min(maxPerRequest, remaining);
    chunks.push(chunk);
    remaining -= chunk;
  }
  return chunks;
}

/**
 * Local like-counter state for one showcase app: optimistic increment on
 * click, one debounced POST per burst (also flushed on tab-hide and on
 * unmount), and rollback of only the unconfirmed part of the delta on
 * failure. `initialLikes` seeds the displayed count on mount only — the same
 * `runId` can stay mounted across a filter switch (an app present in both
 * "popular" and "latest" isn't remounted just because the active tab
 * changed; `key={runId}` only forces a remount when the app itself drops out
 * of the list), so once a burst has fully landed this hook pulls the
 * authoritative total the server just returned, without clobbering any
 * optimistic clicks still unconfirmed at that moment.
 */
export function useShowcaseLikes(runId: string, initialLikes: number) {
  const [count, setCount] = useState(initialLikes);
  const [liked, setLiked] = useState(() => hasLikedShowcaseApp(runId));

  const pendingRef = useRef(0);
  const sendingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const flush = useCallback(async () => {
    if (sendingRef.current) return;
    if (pendingRef.current <= 0) return;
    sendingRef.current = true;
    try {
      // Re-check after every chunk: a click landing mid-flush adds to
      // `pendingRef` and gets picked up by this loop instead of waiting for
      // a whole new debounce cycle.
      let lastAuthoritativeLikes: number | null = null;
      while (pendingRef.current > 0) {
        const toSend = pendingRef.current;
        pendingRef.current = 0;
        let remaining = toSend;
        for (const chunk of chunkLikeDelta(toSend)) {
          const result = await likeShowcaseApp(runId, chunk);
          if (!result.ok) {
            // Roll back only what's unconfirmed: this chunk plus whatever of
            // `toSend` hadn't been sent yet. Chunks that already succeeded
            // this round stay counted. Capture the amount into a constant
            // before zeroing `remaining` below — the updater passed to
            // `setCount` runs later (React invokes it at commit time), so a
            // closure over `remaining` itself would see 0 by then instead of
            // the value at the point of failure.
            const rollbackAmount = remaining;
            if (mountedRef.current) {
              setCount((c) => c - rollbackAmount);
            }
            remaining = 0;
            lastAuthoritativeLikes = null;
            break;
          }
          remaining -= chunk;
          lastAuthoritativeLikes = result.likes;
        }
      }
      // Once every chunk of every burst in this flush has landed (no more
      // rollback pending, nothing new queued while we were sending),
      // `pendingRef` is back to 0 and the server's own total is the ground
      // truth — someone else may have liked the same app in the meantime.
      // Snapping to it here (rather than trusting our own running total
      // forever) is what lets that show up without a page refresh.
      if (lastAuthoritativeLikes != null && mountedRef.current && pendingRef.current === 0) {
        setCount(lastAuthoritativeLikes);
      }
    } finally {
      sendingRef.current = false;
    }
  }, [runId]);

  const scheduleFlush = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      void flush();
    }, LIKE_DEBOUNCE_MS);
  }, [flush]);

  const like = useCallback(() => {
    setCount((c) => c + 1);
    pendingRef.current += 1;
    setLiked(true);
    markShowcaseAppLiked(runId);
    scheduleFlush();
  }, [runId, scheduleFlush]);

  useEffect(() => {
    mountedRef.current = true;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (timeoutRef.current != null) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        void flush();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      void flush();
    };
  }, [flush]);

  return { count, liked, like };
}
