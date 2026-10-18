import { useEffect, useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { apiFetchUrl, resolveApiUrl } from "@/lib/apiBase";
import { isSignedIn } from "@/lib/auth/authState";
import { changesFromEventDetail, eventKey, type ChangeDetail } from "@/lib/memoryActivity";

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
// it and are never classified below (see classifyActivity).
type ActivityEvent = {
  id?: unknown;
  origin?: unknown;
  subsystem?: unknown;
  /** Newer backends: the chat and the turn's user message the review looked at. */
  chatId?: unknown;
  messageId?: unknown;
  /** Newer backends: what exactly was written. Absent on older ones. */
  detail?: unknown;
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

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

type NoteContent = { changesByEvent: Record<string, ChangeDetail[]> };
type TurnGroup = NoteContent & { chatId: string; messageId: string };

// Only events with origin `background_review` and subsystem `memory` or
// `skill` produce a row (FIR-71, which kept memory silent, is reversed). An
// event without a `subsystem` (a pre-phase-2 backend shape) is ignored.
//
// Events carrying BOTH chatId and messageId are grouped per
// (chatId, messageId) — one note per reviewed turn. Events missing either
// field (older backend) go to `legacy`, which keeps the old
// single-note-in-the-scheduling-chat behaviour. Events without `detail` still
// trigger the row but add nothing to its change list.
function classifyActivity(events: ActivityEvent[]): { legacy: NoteContent | null; groups: TurnGroup[] } {
  let legacy: NoteContent | null = null;
  const groups = new Map<string, TurnGroup>();
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    if (event.origin !== "background_review") continue;
    if (event.subsystem !== "skill" && event.subsystem !== "memory") continue;
    const changes = changesFromEventDetail(event.detail);
    const key = eventKey(event.id, changes);
    const chatId = nonEmptyString(event.chatId);
    const messageId = nonEmptyString(event.messageId);
    if (chatId === undefined || messageId === undefined) {
      legacy ??= { changesByEvent: {} };
      legacy.changesByEvent[key] ??= changes;
      continue;
    }
    const gkey = JSON.stringify([chatId, messageId]);
    let g = groups.get(gkey);
    if (!g) groups.set(gkey, (g = { chatId, messageId, changesByEvent: {} }));
    g.changesByEvent[key] ??= changes;
  }
  return { legacy, groups: [...groups.values()] };
}

function buildUrl(userId: string, sinceId: number | undefined): string {
  // Signed in: no userId param, the session cookie identifies the caller.
  const params = new URLSearchParams(isSignedIn() || !userId ? {} : { userId });
  if (sinceId !== undefined) {
    params.set("sinceId", String(sinceId));
  }
  return `${resolveApiUrl("/api/memory/activity")}?${params.toString()}`;
}

function checkAgentActivity(
  userId: string,
  sessionId: string,
  afterMessageId: string,
): void {
  const cursor = readCursor(userId);
  apiFetchUrl(buildUrl(userId, cursor))
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const parsed = parseResponse(data);
      if (!parsed) return;
      const { events, latestId } = parsed;

      if (cursor === undefined) {
        // Baseline run: no cursor yet (first check ever for this user, or
        // storage was cleared). There is nothing to compare against, so just
        // record where the timeline currently ends and never note for
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
        // note exists to surface. Writing `0` distinguishes "checked, saw
        // nothing yet" from "never checked", so the next check goes out
        // with `sinceId=0` and takes the non-baseline path below instead.
        writeCursor(userId, latestId ?? 0);
        return;
      }

      const { legacy, groups } = classifyActivity(events);
      const store = useChatStore.getState();

      // Events that name their chat and turn: the note goes to THAT chat,
      // anchored to that turn's user message, whichever chat scheduled this
      // check. A chat this tab does not hold (closed, or open in another
      // browser tab) is skipped rather than shown in the wrong chat. The id
      // is the turn itself, so a write seen by the 20s check and another by
      // the 60s check give one row (the store merges their events), and it can never
      // collide with a legacy `memory-activity-<latestId>` id.
      for (const g of groups) {
        if (!store.chats.some((c) => c.id === g.chatId)) continue;
        store.addActivityNote(g.chatId, {
          id: `memory-activity-turn-${JSON.stringify([g.chatId, g.messageId])}`,
          turnMessageId: g.messageId,
          changesByEvent: g.changesByEvent,
        });
      }

      if (legacy) {
        // Older backend (no chatId/messageId). The anchor was captured when
        // the turn finished, not now (the check fires 20-60s later): a
        // message sent in the meantime must not pull the row under the next
        // turn, or under the user's own bubble. A stable id (derived from the
        // response's own latestId) lets the store collapse duplicates:
        // multiple chat tabs can each schedule their own check against the
        // same shared, per-user localStorage cursor, and a race between
        // reading and writing it can make more than one observe the same new
        // events. Keeps its original "memory-activity" prefix for the same
        // reason the cursor key does — it is an internal dedup id.
        store.addActivityNote(sessionId, {
          id: `memory-activity-${latestId}`,
          afterMessageId,
          changesByEvent: legacy.changesByEvent,
        });
      }

      // Advance the cursor regardless of whether we added a note — events
      // are only ever lost if we forget to record having read them, not by
      // skipping a note for them.
      if (latestId !== null) writeCursor(userId, latestId);
    })
    .catch(() => {
      // Network error, malformed JSON, or an older backend without this
      // route — none of these should be surfaced to the user.
    });
}

interface UseAgentActivityNotesOptions {
  /** Anonymous client id memory/skills are scoped to; absent disables the check. */
  userId: string | undefined;
  /** The chat hook's `status` — a transition into "ready" schedules a check. */
  status: string;
  /** Chat the note is recorded under. */
  sessionId: string;
  /** Reads the latest message id at call time (not a stale render's). Read
   * once when the turn finishes — that message is the note's anchor. */
  getLastMessageId: () => string | undefined;
}

// Schedules two delayed checks for server-side memory/skill writes that
// happened after a chat turn finished (the model has no chance to surface
// these itself — the review runs after the stream already closed) and
// records a UI-only chat note (rendered as a row after the last message)
// when the review wrote memory or a skill. The note lists WHAT changed (from
// the events' `detail`); a later check for the same turn merges its changes
// into the same note. Silent on any failure: this is a nice-to-have
// notification, never something that should interrupt the user or throw over
// a flaky network / an older backend without the endpoint.
//
// Cursor-based (by event id, not client clock) so a skewed browser clock
// can't hide or repeat events, and so events from a turn whose checks got
// cancelled (a new turn started before they fired) are simply picked up by
// the next turn's checks instead of being lost — the cursor only advances
// on a successful read.
export function useAgentActivityNotes({
  userId,
  status,
  sessionId,
  getLastMessageId,
}: UseAgentActivityNotesOptions): void {
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
    const afterMessageId = getLastMessageId();
    if (afterMessageId === undefined) return;

    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [
      setTimeout(() => checkAgentActivity(userId, sessionId, afterMessageId), FIRST_CHECK_DELAY_MS),
      setTimeout(() => checkAgentActivity(userId, sessionId, afterMessageId), SECOND_CHECK_DELAY_MS),
    ];
  }, [status, userId, sessionId, getLastMessageId]);
}
