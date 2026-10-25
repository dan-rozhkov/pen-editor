// Workflow scheduler: starts scheduled workflows (workflowSchedule.ts) in a NEW
// chat of the desktop agent panel. AgentPage starts it; nothing else does, so it
// is desktop only (AgentPage renders only where isAgentPanelHost() is true).
//
// Nothing runs in the cloud. It checks at start, every 30 s and when the panel
// wakes up (visibilitychange, focus, online) or a schedule changes. A computer
// asleep or an app closed misses its times; the first check after waking finds the
// most recent missed occurrence and starts ONE catch-up run (dueOccurrence collapses
// older ones). The opening message says when the run was meant to start, so the
// agent knows a late run is late.
//
// When the chat of the previous run is still busy, waiting for an answer or queued to start, the occurrence is skipped and
// recorded as skipped (it is not tried again). While offline nothing is recorded:
// the next check retries.
//
// Several desktop windows each have a panel. Passes are NOT serialised by a global lock: each
// occurrence is CLAIMED instead, with a Web Lock named after workflow id + occurrence
// (`ifAvailable`; a refused claim skips the occurrence, nothing is recorded). A granted claim holds
// its lock for 10 minutes (or until stop()), long after another window's localStorage has caught up
// with the record this window writes, which is what closes the cross-window double run. Without
// `navigator.locks` (tests, old shells) the claim is "run now". The run is recorded BEFORE the chat
// gets its payload (the record needs the new chat's id), so a later check that re-reads the
// schedule sees the occurrence as taken. A launch that throws after the record loses that
// occurrence rather than running it twice.

import { toast } from "sonner";
import { useChatStore } from "@/store/chatStore";
import {
  deleteSchedule,
  dueOccurrence,
  getSchedule,
  listSchedules,
  recordScheduledRun,
  recordScheduledSkip,
  subscribeSchedules,
  type WorkflowSchedule,
} from "./workflowSchedule";
import { workflowToPrompt } from "./workflowMarkdown";
import { getWorkflow, isWorkflowBodyMissing, subscribeWorkflows } from "./workflowStore";

const CHECK_INTERVAL_MS = 30_000;
const CLAIM_HOLD_MS = 10 * 60 * 1000;
const CLAIM_LOCK_PREFIX = "pen.workflowScheduler.run.";

function buildLaunchText(schedule: WorkflowSchedule, workflowPrompt: string, occurrenceAt: number, now: number): string {
  const message = schedule.message.trim();
  return [
    ...(message ? [message] : []),
    `Scheduled run of this workflow for ${new Date(occurrenceAt).toLocaleString()}. Started at ${new Date(now).toLocaleString()}.`,
    workflowPrompt,
  ].join("\n\n");
}

// Highest lastOccurrenceAt known per workflow. A BroadcastChannel message can reach this window
// before its localStorage cache shows the other window's write, so a re-read may look stale:
// anything at or before this value is already taken.
const knownOccurrence = new Map<string, number>();

function noteOccurrence(workflowId: string, occurrenceAt: number | undefined): void {
  if (occurrenceAt === undefined) return;
  if (occurrenceAt > (knownOccurrence.get(workflowId) ?? -Infinity)) knownOccurrence.set(workflowId, occurrenceAt);
}

/** Test helper: forgets the known occurrences. */
export function resetKnownOccurrencesForTests(): void {
  knownOccurrence.clear();
}

/** Claims one occurrence. `launch` runs only when the claim is granted. */
export type OccurrenceClaimer = (workflowId: string, occurrenceAt: number, launch: () => void) => void;

/** The claimer without locks: the launch runs at once. */
export const claimImmediately: OccurrenceClaimer = (_workflowId, _occurrenceAt, launch) => launch();

/**
 * A claimer over `navigator.locks`. The launch runs inside the lock callback; the callback then
 * returns a promise that a 10-minute timer (or `release()`) resolves, so the lock outlives the
 * localStorage sync of the record. A second claimer for the same occurrence gets a null lock and does nothing.
 */
export function createLockClaimer(locks: LockManager, holdMs = CLAIM_HOLD_MS): { claim: OccurrenceClaimer; release: () => void } {
  const holds = new Set<() => void>();
  const claim: OccurrenceClaimer = (workflowId, occurrenceAt, launch) => {
    locks
      .request(`${CLAIM_LOCK_PREFIX}${workflowId}.${occurrenceAt}`, { ifAvailable: true }, (lock) => {
        if (!lock) return undefined;
        try {
          launch();
        } catch (e) {
          console.error(`workflowScheduler failed for workflow ${workflowId}`, e);
        }
        return new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            holds.delete(done);
            resolve();
          };
          const timer = setTimeout(done, holdMs);
          holds.add(done);
        });
      })
      .catch((e) => console.error("workflowScheduler lock failed", e));
  };
  const release = () => {
    for (const done of [...holds]) done();
  };
  return { claim, release };
}

/** Cheap checks, then claim the occurrence; the launch itself decides again on a fresh copy. */
function runOne(schedule: WorkflowSchedule, now: number, claim: OccurrenceClaimer): void {
  const id = schedule.workflowId;
  // A schedule whose workflow body is gone for good is deleted (a present but unparseable body is left alone).
  if (isWorkflowBodyMissing(id)) {
    deleteSchedule(id);
    return;
  }
  // Cheap check first: most ticks have nothing due, and reading the workflow parses its body.
  const due = dueOccurrence(schedule, now);
  if (due === null) return;
  if (due <= (knownOccurrence.get(id) ?? -Infinity)) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  claim(id, due, () => launch(id, due, now));
}

function launch(id: string, claimedAt: number, now: number): void {
  const workflow = getWorkflow(id);
  if (!workflow) return;

  // Another panel may have run it since listSchedules(): decide on a fresh copy.
  const fresh = getSchedule(id);
  if (!fresh) return;
  noteOccurrence(id, fresh.lastOccurrenceAt);
  const occurrenceAt = dueOccurrence(fresh, now);
  if (occurrenceAt === null || occurrenceAt !== claimedAt) return;
  if (occurrenceAt <= (knownOccurrence.get(id) ?? -Infinity)) return;

  // Chats are per window and in memory: a previous run started by another window, or before
  // this panel reloaded, is not in this store and is not seen here.
  const store0 = useChatStore.getState();
  const previous = fresh.lastChatId ? store0.chats.find((c) => c.id === fresh.lastChatId) : undefined;
  if (previous && (previous.isBusy || previous.needsAnswer || store0.launchQueue[previous.id] !== undefined)) {
    if (recordScheduledSkip(id, { occurrenceAt, at: now, reason: "previous-run-busy" })) noteOccurrence(id, occurrenceAt);
    return;
  }

  // The run is recorded before the title and payload are set: if those throw, the occurrence is lost, never run twice.
  const text = buildLaunchText(fresh, workflowToPrompt(workflow), occurrenceAt, now);
  const store = useChatStore.getState();
  const chatId = store.createChat({ activate: false, parallelCount: 1 });
  if (!recordScheduledRun(id, { occurrenceAt, runAt: now, chatId })) {
    store.closeChat(chatId);
    return;
  }
  noteOccurrence(id, occurrenceAt);
  store.setChatTitle(chatId, workflow.title);
  store.queueLaunchPayload(chatId, { text });
  toast(`Started scheduled workflow “${workflow.title}”`, {
    action: { label: "Open", onClick: () => useChatStore.getState().openChat(chatId) },
  });
}

/** One pass over every schedule. `claim` defaults to "run now"; startWorkflowScheduler passes the lock claimer. */
export function checkScheduledWorkflows(now = Date.now(), claim: OccurrenceClaimer = claimImmediately): void {
  let schedules: WorkflowSchedule[];
  try {
    schedules = listSchedules();
  } catch (e) {
    console.error("workflowScheduler could not list schedules", e);
    return;
  }
  for (const schedule of schedules) {
    try {
      runOne(schedule, now, claim);
    } catch (e) {
      console.error(`workflowScheduler failed for workflow ${schedule.workflowId}`, e);
    }
  }
}

let stopCurrent: (() => void) | null = null;

/** Starts the scheduler. A second call while it runs returns the same stop function. */
export function startWorkflowScheduler(): () => void {
  if (stopCurrent) return stopCurrent;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const claimer = locks ? createLockClaimer(locks) : null;

  // A tick that arrives while a pass runs (an echo of this pass's own record) only marks the
  // pass for repetition; the repeat runs afterwards from a timer, never nested.
  let checking = false;
  let again = false;
  let deferred: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      checkScheduledWorkflows(Date.now(), claimer?.claim);
    } finally {
      checking = false;
    }
    if (again) {
      again = false;
      deferTick();
    }
  };
  const deferTick = () => {
    if (deferred !== null) return;
    deferred = setTimeout(() => {
      deferred = null;
      tick();
    }, 0);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };
  const interval = setInterval(tick, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", tick);
  window.addEventListener("focus", tick);
  // Listeners never call the pass synchronously: a store write inside a pass would recurse into it.
  const unsubscribe = subscribeSchedules((change) => {
    noteOccurrence(change.workflowId, change.schedule?.lastOccurrenceAt);
    deferTick();
  });
  // A deleted workflow takes its schedule with it.
  const unsubscribeWorkflows = subscribeWorkflows((change) => {
    if (!change.deleted) return;
    try {
      deleteSchedule(change.id);
    } catch (e) {
      console.error(`workflowScheduler could not delete the schedule of workflow ${change.id}`, e);
    }
  });
  tick();
  const stop = () => {
    clearInterval(interval);
    if (deferred !== null) clearTimeout(deferred);
    deferred = null;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", tick);
    window.removeEventListener("focus", tick);
    unsubscribe();
    unsubscribeWorkflows();
    claimer?.release();
    knownOccurrence.clear();
    stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}
