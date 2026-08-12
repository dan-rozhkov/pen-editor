import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { resolveApiUrl } from "@/lib/apiBase";

// Two delayed checks per finished turn, both scheduled at turn-finish time
// (not chained). The backend's background memory review is a full
// generateText run (up to 8 steps) that can easily outlast a single 20s
// check, so a lone check loses the race on a long review; the second check
// ~60s out catches it without an unbounded poll loop. This is a fixed
// two-request budget per turn, not polling.
const FIRST_CHECK_DELAY_MS = 20_000;
const SECOND_CHECK_DELAY_MS = 60_000;

// Cursor is scoped per anonymous userId (not global) since memory itself is
// per-user, and stored in localStorage so it survives reloads/new tabs and is
// shared by every chat tab in this browser profile.
function cursorKey(userId: string): string {
  return `pen.memoryActivityCursor:${userId}`;
}

function readCursor(userId: string): number | undefined {
  try {
    const raw = localStorage.getItem(cursorKey(userId));
    if (raw === null) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    // Private-mode Safari / locked storage: fall back to baseline-every-time
    // behavior rather than throwing.
    return undefined;
  }
}

function writeCursor(userId: string, id: number): void {
  try {
    localStorage.setItem(cursorKey(userId), String(id));
  } catch {
    // Same as above — losing persistence just costs an extra baseline call
    // next time, it's not a functional break.
  }
}

type MemoryActivityEvent = {
  id?: unknown;
  origin?: unknown;
};

type ParsedActivityResponse = {
  events: MemoryActivityEvent[];
  latestId: number | null;
};

// Defensive parse: this is a nice-to-have notification, so any response
// shape we don't recognize (older/mismatched backend, network proxy
// mangling JSON, etc.) is treated as "nothing new" rather than thrown.
function parseResponse(data: unknown): ParsedActivityResponse | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { events, latestId } = data as {
    events?: unknown;
    latestId?: unknown;
  };
  if (!Array.isArray(events)) return undefined;
  if (latestId !== null && typeof latestId !== "number") return undefined;
  return { events: events as MemoryActivityEvent[], latestId };
}

function hasBackgroundReviewEvent(events: MemoryActivityEvent[]): boolean {
  return events.some(
    (event) =>
      typeof event === "object" &&
      event !== null &&
      (event as MemoryActivityEvent).origin === "background_review",
  );
}

function buildUrl(userId: string, sinceId: number | undefined): string {
  const params = new URLSearchParams({ userId });
  if (sinceId !== undefined) {
    params.set("sinceId", String(sinceId));
  }
  return `${resolveApiUrl("/api/memory/activity")}?${params.toString()}`;
}

function checkMemoryActivity(userId: string): void {
  const cursor = readCursor(userId);
  fetch(buildUrl(userId, cursor))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const parsed = parseResponse(data);
      if (!parsed) return;
      const { events, latestId } = parsed;

      if (cursor === undefined) {
        // Baseline run: no cursor yet (first check ever for this user, or
        // storage was cleared). There is nothing to compare against, so just
        // record where the timeline currently ends and never toast for
        // pre-existing history.
        if (latestId !== null) writeCursor(userId, latestId);
        return;
      }

      if (hasBackgroundReviewEvent(events)) {
        // A stable id (derived from the response's own latestId) lets sonner
        // collapse duplicate toasts: multiple chat tabs can each schedule
        // their own check against the same shared, per-user localStorage
        // cursor, and a race between reading and writing it can make more
        // than one tab observe the same new events.
        toast("Агент обновил память о вас", {
          id: `memory-activity-${latestId}`,
        });
      }

      // Advance the cursor regardless of whether we toasted — events are
      // only ever lost if we forget to record having read them, not by
      // skipping a toast for them.
      if (latestId !== null) writeCursor(userId, latestId);
    })
    .catch(() => {
      // Network error, malformed JSON, or an older backend without this
      // route — none of these should be surfaced to the user.
    });
}

interface UseMemoryActivityToastOptions {
  /** Anonymous client id memory is scoped to; absent disables the check. */
  userId: string | undefined;
  /** The chat hook's `status` — a transition into "ready" schedules a check. */
  status: string;
}

// Schedules two delayed checks for server-side memory writes that happened
// after a chat turn finished (the model has no chance to surface these
// itself — the review runs after the stream already closed) and surfaces a
// transient toast if any of them is a background review. Silent on any
// failure: this is a nice-to-have notification, never something that should
// interrupt the user or throw over a flaky network / an older backend
// without the endpoint.
//
// Cursor-based (by event id, not client clock) so a skewed browser clock
// can't hide or repeat events, and so events from a turn whose checks got
// cancelled (a new turn started before they fired) are simply picked up by
// the next turn's checks instead of being lost — the cursor only advances
// on a successful read.
export function useMemoryActivityToast({
  userId,
  status,
}: UseMemoryActivityToastOptions): void {
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const isActive = status === "submitted" || status === "streaming";
    const justFinished = wasActiveRef.current && status === "ready";
    wasActiveRef.current = isActive;

    if (!justFinished || !userId) {
      return;
    }

    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [
      setTimeout(() => checkMemoryActivity(userId), FIRST_CHECK_DELAY_MS),
      setTimeout(() => checkMemoryActivity(userId), SECOND_CHECK_DELAY_MS),
    ];
  }, [status, userId]);
}
