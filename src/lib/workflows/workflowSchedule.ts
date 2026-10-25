// Workflow schedules: when the desktop agent panel should start a workflow by
// itself, in a new chat (workflowScheduler.ts runs them). Desktop only, and only
// while the app is open and the computer is awake: nothing runs in the cloud.
// A missed time (app closed, computer asleep) gets ONE catch-up run, for the most
// recent missed occurrence, the next time the panel checks.
//
// Kept apart from workflowStore: the scheduler writes run bookkeeping
// (lastRunAt, …) here, and that must not bump a workflow's `rev` and conflict
// with an open editor. Config sits in one localStorage key (map by workflow id) and run
// bookkeeping in a second one (`.runs`), so neither writer can overwrite the other. Changes reach other same-origin pages (the /workflow tab, the
// /agent panel) through BroadcastChannel, with the `storage` event as a backup.
//
// Every localStorage access is wrapped: a private window or blocked site data
// makes getItem/setItem throw.

export type ScheduleFrequency = "hourly" | "daily" | "weekdays" | "weekly";

export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] = ["hourly", "daily", "weekdays", "weekly"];

/** What the user sets in the schedule dialog. */
export interface WorkflowScheduleConfig {
  workflowId: string;
  enabled: boolean;
  frequency: ScheduleFrequency;
  /** Local time "HH:MM". Hourly schedules use only the minutes. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. Weekly schedules only. */
  weekday: number;
  /** Opening message of the new chat, sent before the workflow block. May be empty. */
  message: string;
}

/** Why the scheduler let an occurrence pass without starting a chat. */
export type ScheduleSkipReason = "previous-run-busy";

export interface WorkflowSchedule extends WorkflowScheduleConfig {
  /** Last time the config was saved. Occurrences at or before it never run (no run for a time set in the past). */
  updatedAt: number;
  /** Wall-clock time the last run started. */
  lastRunAt?: number;
  /** The occurrence the last run (or skip) covered. An occurrence at or before it never runs again. */
  lastOccurrenceAt?: number;
  /** The chat the last run started. */
  lastChatId?: string;
  /** Set when the last occurrence was skipped; cleared by the next run. */
  lastSkip?: { at: number; reason: ScheduleSkipReason };
}

export interface WorkflowScheduleChange {
  workflowId: string;
  /** The schedule as written; absent when it was deleted. */
  schedule?: WorkflowSchedule;
}

// Config (written only by saveSchedule/deleteSchedule) and run bookkeeping (written only by the
// record functions) live in separate keys, so a panel holding a stale copy of one can never
// write old data over the other.
const SCHEDULES_KEY = "pen.workflowSchedules";
const RUNS_KEY = "pen.workflowSchedules.runs";
const CHANNEL_NAME = "pen.workflowSchedules";

/** Thrown by saveSchedule when localStorage is full or blocked. */
export const SCHEDULE_STORAGE_ERROR = "Schedule storage is unavailable in this browser (localStorage blocked or full).";

export const DEFAULT_SCHEDULE_CONFIG: Omit<WorkflowScheduleConfig, "workflowId"> = {
  enabled: true,
  frequency: "weekdays",
  time: "09:00",
  weekday: 1,
  message: "",
};

const HOUR_MS = 60 * 60 * 1000;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

type Listener = (change: WorkflowScheduleChange) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function isFrequency(value: unknown): value is ScheduleFrequency {
  return typeof value === "string" && (SCHEDULE_FREQUENCIES as readonly string[]).includes(value);
}

type StoredConfig = WorkflowScheduleConfig & { updatedAt: number };
type RunState = Pick<WorkflowSchedule, "lastRunAt" | "lastOccurrenceAt" | "lastChatId" | "lastSkip">;

function parseConfig(value: unknown): StoredConfig | null {
  const s = value as Partial<WorkflowSchedule> | null;
  if (
    !s ||
    typeof s.workflowId !== "string" ||
    typeof s.enabled !== "boolean" ||
    !isFrequency(s.frequency) ||
    typeof s.time !== "string" ||
    !TIME_PATTERN.test(s.time) ||
    typeof s.weekday !== "number" ||
    typeof s.message !== "string" ||
    typeof s.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    workflowId: s.workflowId,
    enabled: s.enabled,
    frequency: s.frequency,
    time: s.time,
    weekday: Math.min(6, Math.max(0, Math.trunc(s.weekday))),
    message: s.message,
    updatedAt: s.updatedAt,
  };
}

function parseRun(value: unknown): RunState {
  const s = (value ?? {}) as Partial<WorkflowSchedule>;
  return {
    ...(typeof s.lastRunAt === "number" ? { lastRunAt: s.lastRunAt } : {}),
    ...(typeof s.lastOccurrenceAt === "number" ? { lastOccurrenceAt: s.lastOccurrenceAt } : {}),
    ...(typeof s.lastChatId === "string" ? { lastChatId: s.lastChatId } : {}),
    ...(s.lastSkip && typeof s.lastSkip.at === "number" && s.lastSkip.reason === "previous-run-busy" ? { lastSkip: { at: s.lastSkip.at, reason: s.lastSkip.reason } } : {}),
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseMap(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readConfigs(): Record<string, StoredConfig> {
  const result: Record<string, StoredConfig> = {};
  for (const [id, value] of Object.entries(parseMap(readRaw(SCHEDULES_KEY)))) {
    const config = parseConfig(value);
    if (config && config.workflowId === id) result[id] = config;
  }
  return result;
}

function readRuns(): Record<string, RunState> {
  const result: Record<string, RunState> = {};
  for (const [id, value] of Object.entries(parseMap(readRaw(RUNS_KEY)))) result[id] = parseRun(value);
  return result;
}

function merge(configs: Record<string, StoredConfig>, runs: Record<string, RunState>): Record<string, WorkflowSchedule> {
  const result: Record<string, WorkflowSchedule> = {};
  for (const [id, config] of Object.entries(configs)) result[id] = { ...config, ...(runs[id] ?? {}) };
  return result;
}

// The merged map, re-parsed only when one of the two raw strings changed, so repeated reads
// (useSyncExternalStore calls getSnapshot on every render) return the same objects.
let cachedRaw: [string | null, string | null] | null = null;
let cachedAll: Record<string, WorkflowSchedule> = {};
function readAll(): Record<string, WorkflowSchedule> {
  const raw: [string | null, string | null] = [readRaw(SCHEDULES_KEY), readRaw(RUNS_KEY)];
  if (cachedRaw && cachedRaw[0] === raw[0] && cachedRaw[1] === raw[1]) return cachedAll;
  cachedAll = merge(readConfigs(), readRuns());
  cachedRaw = raw;
  return cachedAll;
}

function writeKey(key: string, value: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<WorkflowScheduleChange>) => emitLocal(event.data);
  return channel;
}

// The `storage` event only says a map changed: report the schedules whose merged value differs
// from the last seen one, and the ids that disappeared as deletes.
let storageListening = false;
let lastSeen: Record<string, string> = {};
function snapshotJson(all: Record<string, WorkflowSchedule>): Record<string, string> {
  return Object.fromEntries(Object.entries(all).map(([id, schedule]) => [id, JSON.stringify(schedule)]));
}
function onStorage(event: StorageEvent): void {
  if (event.key !== SCHEDULES_KEY && event.key !== RUNS_KEY && event.key !== null) return;
  const all = readAll();
  const json = snapshotJson(all);
  for (const id of Object.keys(lastSeen)) {
    if (!all[id]) emitLocal({ workflowId: id });
  }
  for (const [id, schedule] of Object.entries(all)) {
    if (json[id] !== lastSeen[id]) emitLocal({ workflowId: id, schedule });
  }
  lastSeen = json;
}
function listenToStorage(): void {
  if (storageListening || typeof window === "undefined") return;
  storageListening = true;
  lastSeen = snapshotJson(readAll());
  window.addEventListener("storage", onStorage);
}

// One listener throwing must neither skip the others nor make a finished write look failed.
function emitLocal(change: WorkflowScheduleChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (e) {
      console.error("workflowSchedule listener failed", e);
    }
  }
}

function notify(change: WorkflowScheduleChange): void {
  // This page's own write is "seen": a later storage event must not re-emit it.
  if (storageListening) lastSeen = snapshotJson(readAll());
  emitLocal(change);
  try {
    getChannel()?.postMessage(change);
  } catch (e) {
    console.error("workflowSchedule broadcast failed", e);
  }
}

/** Parses "HH:MM"; null when malformed. */
export function parseScheduleTime(time: string): { hours: number; minutes: number } | null {
  const match = TIME_PATTERN.exec(time);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

export function getSchedule(workflowId: string): WorkflowSchedule | null {
  return readAll()[workflowId] ?? null;
}

/** Ids come from the config map only; run bookkeeping alone never lists a schedule. */
export function listSchedules(): WorkflowSchedule[] {
  return Object.values(readAll());
}

/**
 * Writes the config only. Run bookkeeping lives in its own key and is untouched, so getSchedule
 * still shows it. `updatedAt` becomes now when the TIMING changes (new schedule, frequency, time,
 * weekday, or off -> on): a time already past today does not run until its next occurrence. An edit
 * of the message alone keeps the old `updatedAt`, so a due occurrence that has not run yet is not dropped.
 */
export function saveSchedule(config: WorkflowScheduleConfig): WorkflowSchedule {
  if (!parseScheduleTime(config.time)) throw new Error(`Invalid schedule time "${config.time}". Use HH:MM.`);
  const configs = readConfigs();
  const previous = configs[config.workflowId];
  const weekday = Math.min(6, Math.max(0, Math.trunc(config.weekday)));
  const timingChanged =
    !previous ||
    previous.frequency !== config.frequency ||
    previous.time !== config.time ||
    previous.weekday !== weekday ||
    (!previous.enabled && config.enabled);
  configs[config.workflowId] = {
    workflowId: config.workflowId,
    enabled: config.enabled,
    frequency: config.frequency,
    time: config.time,
    weekday,
    message: config.message,
    updatedAt: timingChanged || !previous ? Date.now() : previous.updatedAt,
  };
  if (!writeKey(SCHEDULES_KEY, configs)) throw new Error(SCHEDULE_STORAGE_ERROR);
  const schedule = merge(configs, readRuns())[config.workflowId];
  notify({ workflowId: schedule.workflowId, schedule });
  return schedule;
}

/**
 * Deletes the config first; when that write fails nothing else is touched and SCHEDULE_STORAGE_ERROR
 * is thrown (the schedule still exists). Run bookkeeping is then cleared best-effort: without a config
 * it is never listed or merged.
 */
export function deleteSchedule(workflowId: string): void {
  const configs = readConfigs();
  const runs = readRuns();
  if (!configs[workflowId] && !runs[workflowId]) return;
  delete configs[workflowId];
  delete runs[workflowId];
  if (!writeKey(SCHEDULES_KEY, configs)) throw new Error(SCHEDULE_STORAGE_ERROR);
  writeKey(RUNS_KEY, runs);
  notify({ workflowId });
}

function writeRun(workflowId: string, update: (current: RunState) => RunState): boolean {
  const configs = readConfigs();
  // Never resurrect a deleted schedule: a record for an id without a config is refused.
  if (!configs[workflowId]) return false;
  const runs = readRuns();
  runs[workflowId] = update(runs[workflowId] ?? {});
  if (!writeKey(RUNS_KEY, runs)) return false;
  notify({ workflowId, schedule: merge(configs, runs)[workflowId] });
  return true;
}

/** Records a started run. Returns false when the schedule is gone or storage failed. */
export function recordScheduledRun(workflowId: string, run: { occurrenceAt: number; runAt: number; chatId: string }): boolean {
  return writeRun(workflowId, () => ({ lastRunAt: run.runAt, lastOccurrenceAt: run.occurrenceAt, lastChatId: run.chatId }));
}

/** Records an occurrence that passed without a run, so it is not tried again. */
export function recordScheduledSkip(workflowId: string, skip: { occurrenceAt: number; at: number; reason: ScheduleSkipReason }): boolean {
  return writeRun(workflowId, (current) => ({ ...current, lastOccurrenceAt: skip.occurrenceAt, lastSkip: { at: skip.at, reason: skip.reason } }));
}

function dayMatches(frequency: ScheduleFrequency, weekday: number, day: number): boolean {
  if (frequency === "weekdays") return day >= 1 && day <= 5;
  if (frequency === "weekly") return day === weekday;
  return true;
}

/**
 * The latest occurrence at or before `now` (ms, local time), or null when the time
 * is malformed. Disabled schedules still have occurrences; callers check `enabled`.
 */
export function previousOccurrence(schedule: Pick<WorkflowScheduleConfig, "frequency" | "time" | "weekday">, now: number): number | null {
  const time = parseScheduleTime(schedule.time);
  if (!time) return null;
  if (schedule.frequency === "hourly") {
    const candidate = new Date(now);
    candidate.setMinutes(time.minutes, 0, 0);
    const at = candidate.getTime();
    return at <= now ? at : at - HOUR_MS;
  }
  for (let back = 0; back <= 7; back += 1) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() - back);
    candidate.setHours(time.hours, time.minutes, 0, 0);
    if (candidate.getTime() <= now && dayMatches(schedule.frequency, schedule.weekday, candidate.getDay())) return candidate.getTime();
  }
  return null;
}

/** The first occurrence strictly after `now` (ms, local time), or null when the time is malformed. */
export function nextOccurrence(schedule: Pick<WorkflowScheduleConfig, "frequency" | "time" | "weekday">, now: number): number | null {
  const time = parseScheduleTime(schedule.time);
  if (!time) return null;
  if (schedule.frequency === "hourly") {
    const candidate = new Date(now);
    candidate.setMinutes(time.minutes, 0, 0);
    const at = candidate.getTime();
    return at > now ? at : at + HOUR_MS;
  }
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + ahead);
    candidate.setHours(time.hours, time.minutes, 0, 0);
    if (candidate.getTime() > now && dayMatches(schedule.frequency, schedule.weekday, candidate.getDay())) return candidate.getTime();
  }
  return null;
}

/**
 * The occurrence the scheduler should run now, or null: the latest occurrence at or before
 * `now` that is after both the last save and the last run (or skip). Because only the
 * latest one counts, any number of missed times collapse into one catch-up run.
 */
export function dueOccurrence(schedule: WorkflowSchedule, now: number): number | null {
  if (!schedule.enabled) return null;
  const at = previousOccurrence(schedule, now);
  if (at === null) return null;
  if (at <= schedule.updatedAt) return null;
  if (schedule.lastOccurrenceAt !== undefined && at <= schedule.lastOccurrenceAt) return null;
  return at;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Every weekday at 09:00", "Every hour at :15", … */
export function describeSchedule(schedule: Pick<WorkflowScheduleConfig, "frequency" | "time" | "weekday">): string {
  const time = parseScheduleTime(schedule.time);
  if (!time) return "Invalid time";
  switch (schedule.frequency) {
    case "hourly":
      return `Every hour at :${String(time.minutes).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${schedule.time}`;
    case "weekdays":
      return `Every weekday at ${schedule.time}`;
    case "weekly":
      return `Every ${WEEKDAY_NAMES[schedule.weekday] ?? "week"} at ${schedule.time}`;
  }
}

/** Subscribes to schedule changes from this page and from other same-origin pages. Returns the unsubscribe function. */
export function subscribeSchedules(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  listenToStorage();
  return () => {
    listeners.delete(listener);
  };
}
