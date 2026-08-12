import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { resolveApiUrl } from "@/lib/apiBase";

// Two delayed checks per finished turn, both scheduled at turn-finish time
// (not chained). The backend's background review is a full generateText run
// (up to 8 steps) that can easily outlast a single 20s check, so a lone
// check loses the race on a long review; the second check ~60s out catches
// it without an unbounded poll loop. This is a fixed two-request budget per
// turn, not polling.
const FIRST_CHECK_DELAY_MS = 20_000;
const SECOND_CHECK_DELAY_MS = 60_000;

// Cursor is scoped per anonymous userId (not global) since both memory and
// skills are user/global-server state read back through the same per-user
// endpoint, and stored in localStorage so it survives reloads/new tabs and
// is shared by every chat tab in this browser profile. The key itself keeps
// its original "memoryActivityCursor" spelling even though phase 2 (skills)
// now shares it — renaming it would silently reset every existing user's
// cursor to "no baseline yet" on the next deploy, which just costs one extra
// (harmless) baseline call, but for zero benefit since the key is never
// user-visible.
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

// `subsystem` is only populated by backends that carry the self-improvement
// loop's phase-2 (skills) migration — an older backend's events simply omit
// it, and are treated as "memory" below (see classifyActivity) since memory
// (phase 1) was the only subsystem that could have written them.
type ActivityEvent = {
  id?: unknown;
  origin?: unknown;
  subsystem?: unknown;
};

type ParsedActivityResponse = {
  events: ActivityEvent[];
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
  return { events: events as ActivityEvent[], latestId };
}

// Classifies which subsystem(s) the background review actually touched, so
// the toast can say what happened instead of always claiming "memory" (the
// spec's phase 2 reuses this same endpoint/toast for skill_manage writes,
// see pen-editor-backend's self-improvement-loop spec, "UI visibility").
// An event whose `subsystem` is missing or anything other than "skill" is
// counted as memory — this is both the phase-1 shape (no column existed
// yet) and the backend's own "memory" | "skill" contract, so "not skill"
// is the correct default rather than requiring an exact "memory" match.
function classifyActivity(events: ActivityEvent[]): { memory: boolean; skill: boolean } {
  let memory = false;
  let skill = false;
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    if (event.origin !== "background_review") continue;
    if (event.subsystem === "skill") {
      skill = true;
    } else {
      memory = true;
    }
  }
  return { memory, skill };
}

function activityToastText(events: ActivityEvent[]): string | undefined {
  const { memory, skill } = classifyActivity(events);
  if (memory && skill) return "Агент обновил память и скиллы";
  if (skill) return "Агент обновил свои скиллы";
  if (memory) return "Агент обновил память о вас";
  return undefined;
}

function buildUrl(userId: string, sinceId: number | undefined): string {
  const params = new URLSearchParams({ userId });
  if (sinceId !== undefined) {
    params.set("sinceId", String(sinceId));
  }
  return `${resolveApiUrl("/api/memory/activity")}?${params.toString()}`;
}

function checkAgentActivity(userId: string): void {
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
        //
        // A brand-new user has zero audit rows, so `latestId` is `null` here
        // — not just on their very first baseline, but on every check up
        // until their first background review actually writes a row. If we
        // left the cursor unwritten in that case (as `readCursor`'s "no
        // value" and "value 0" both look like "no cursor" would otherwise
        // require), every one of those checks would keep re-entering this
        // baseline branch, including the one right after the first review
        // finally wrote something — silently eating the very event the
        // toast exists to surface. Writing `0` distinguishes "checked, saw
        // nothing yet" from "never checked", so the next check goes out
        // with `sinceId=0` and takes the non-baseline path below instead.
        writeCursor(userId, latestId ?? 0);
        return;
      }

      const text = activityToastText(events);
      if (text !== undefined) {
        // A stable id (derived from the response's own latestId) lets sonner
        // collapse duplicate toasts: multiple chat tabs can each schedule
        // their own check against the same shared, per-user localStorage
        // cursor, and a race between reading and writing it can make more
        // than one tab observe the same new events. Keeps its original
        // "memory-activity" prefix for the same reason the cursor key does
        // — it is an internal dedup id, never shown to the user.
        toast(text, { id: `memory-activity-${latestId}` });
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

interface UseAgentActivityToastOptions {
  /** Anonymous client id memory/skills are scoped to; absent disables the check. */
  userId: string | undefined;
  /** The chat hook's `status` — a transition into "ready" schedules a check. */
  status: string;
}

// Schedules two delayed checks for server-side memory/skill writes that
// happened after a chat turn finished (the model has no chance to surface
// these itself — the review runs after the stream already closed) and
// surfaces a transient toast describing whichever subsystem(s) the review
// actually touched. Silent on any failure: this is a nice-to-have
// notification, never something that should interrupt the user or throw
// over a flaky network / an older backend without the endpoint.
//
// Cursor-based (by event id, not client clock) so a skewed browser clock
// can't hide or repeat events, and so events from a turn whose checks got
// cancelled (a new turn started before they fired) are simply picked up by
// the next turn's checks instead of being lost — the cursor only advances
// on a successful read.
export function useAgentActivityToast({
  userId,
  status,
}: UseAgentActivityToastOptions): void {
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
      setTimeout(() => checkAgentActivity(userId), FIRST_CHECK_DELAY_MS),
      setTimeout(() => checkAgentActivity(userId), SECOND_CHECK_DELAY_MS),
    ];
  }, [status, userId]);
}
