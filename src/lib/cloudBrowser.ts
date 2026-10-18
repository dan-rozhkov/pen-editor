import { apiFetch } from "@/lib/apiBase";
import { getRequestUserId } from "@/lib/auth/authState";
import {
  getSessionStaleAt,
  useCloudBrowserStore,
  type CloudBrowserSession,
} from "@/store/cloudBrowserStore";
import type { PenDesktopApi } from "@/lib/desktopBridge";

// Web-build twin of the desktop shell's `window.penDesktop.browser` bridge
// (pen-editor-backend docs/specs/2026-09-29-cloud-browser-steel-design.md §4).
// Each method forwards to `POST /api/browser/cmd/:name`, where the same
// BrowserController runs against a Steel-hosted Chromium. Like the desktop
// bridge it NEVER rejects: every failure resolves to `{ error }`, so the
// browse_* handlers stay unchanged.

type CloudBrowserBridge = NonNullable<PenDesktopApi["browser"]> &
  Required<Pick<NonNullable<PenDesktopApi["browser"]>, "screenshot" | "tabs">>;

const STORAGE_PREFIX = "pen.cloudBrowser.";
const FALLBACK_CHAT_ID = "default";

// Per-command fetch budgets, each just under the matching browse_* tool
// timeout in useDesignChat (cloud mode: open 150s, act 180s, tabs 130s,
// default 30s+60s) so the clean {error} below wins the race, not the tool's
// generic "timed out".
const COMMAND_TIMEOUT_MS: Record<string, number> = {
  open: 145_000,
  act: 175_000,
  tabs: 125_000,
  // The controller's fixture budget is capped at 5 min (MAX_BUDGET_MS in
  // browser-agent/src/fixture/apply.ts); this must outlast it (+30s margin),
  // or the fetch aborts a setup that is still legitimately running.
  applyFixture: 330_000,
  // Checkpoint journal (browser-agent v0.2.16). start/stop create no session
  // and are quick. The capture reads cookies, storage and the tab list, and
  // may queue behind an in-flight act; its fetch stays under the recorder's
  // 30 s bound (browseAgent.ts, CHECKPOINT_CALL_TIMEOUT_MS) so the recorder's
  // clean {error} wins over a generic timeout. Trade-off: a capture behind an
  // act longer than 25 s still fails, and the run then has no checkpoint.
  startJournal: 15_000,
  stopJournal: 15_000,
  captureCheckpoint: 25_000,
  // QA assertions (browser-agent v0.2.21): one page script; the final checks are bounded at 30 s by the package.
  assert: 30_000,
  // Run-end viewport reset (browser-agent v0.2.23): no navigation, quick; the host bounds it at 5 s anyway.
  clearActEmulation: 10_000,
};
const DEFAULT_COMMAND_TIMEOUT_MS = 85_000;
const TIMEOUT_ERROR = "Cloud browser timed out — try again.";

const handles = new Map<string, string>();
// Per-chat FIFO tail: commands for one chat go out one at a time, so several
// parallel no-handle `open`s can't each create a session. Chats are independent.
const chatQueues = new Map<string, Promise<unknown>>();

function runExclusive<T>(chatId: string, task: () => Promise<T>): Promise<T> {
  const run = (chatQueues.get(chatId) ?? Promise.resolve()).then(task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  chatQueues.set(chatId, tail);
  void tail.then(() => {
    if (chatQueues.get(chatId) === tail) chatQueues.delete(chatId);
  });
  return run;
}
let currentChatId: string | undefined;

/** Fallback chat for callers that have no chat context (MCP bridges). */
export function setCloudBrowserChat(chatId: string): void {
  currentChatId = chatId;
}

function readStoredHandle(chatId: string): string | undefined {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + chatId) ?? undefined;
  } catch {
    return undefined;
  }
}

function getHandle(chatId: string): string | undefined {
  return handles.get(chatId) ?? readStoredHandle(chatId);
}

function saveHandle(chatId: string, handle: string): void {
  handles.set(chatId, handle);
  try {
    sessionStorage.setItem(STORAGE_PREFIX + chatId, handle);
  } catch {
    // Storage blocked: the in-memory map still covers this page's lifetime.
  }
}

function dropHandle(chatId: string): void {
  handles.delete(chatId);
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + chatId);
  } catch {
    // ignore
  }
  useCloudBrowserStore.getState().clearSession(chatId);
}

/** Clears local session state (handle + live view) without a network call. */
export function expireCloudBrowser(chatId: string): void {
  dropHandle(chatId);
}

function errorMessage(body: unknown, status: number): string {
  const err = (body as { error?: unknown } | null)?.error;
  if (typeof err === "string" && err !== "") return err;
  return `The cloud browser request failed (HTTP ${status}).`;
}

// Chats with a release requested but not yet finished. While set, command
// responses for the chat must not save a handle or repopulate the live view.
const releasing = new Map<string, number>();

function postRelease(chatId: string, handle: string): Promise<boolean> {
  return apiFetch("/api/browser/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: getRequestUserId(), chatId, handle }),
  }).then(
    async (res) => {
      if (!res.ok) return false;
      const body = (await res.json()) as { released?: unknown };
      return body.released === true;
    },
    () => false
  );
}

/**
 * `deadline` is fixed at enqueue time (like the tool timeout, which starts at
 * dispatch), so time spent queued behind other commands counts against it.
 */
async function callCommand(
  chatId: string,
  name: string,
  args: Record<string, unknown> | undefined,
  deadline: number
): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { error: TIMEOUT_ERROR };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, remaining);
  try {
    const handle = getHandle(chatId);
    const res = await apiFetch(`/api/browser/cmd/${name}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: getRequestUserId(),
        chatId,
        ...(handle ? { handle } : {}),
        args: args ?? {},
      }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON body; handled below
    }
    if (timedOut) return { error: TIMEOUT_ERROR };
    if (releasing.has(chatId)) {
      // A release was requested while this command was in flight: never adopt
      // its session. A brand-new session would otherwise leak until idle expiry.
      const fresh = (body as { handle?: unknown } | null)?.handle;
      if (typeof fresh === "string" && fresh !== "" && fresh !== getHandle(chatId)) {
        void postRelease(chatId, fresh);
      }
      const r = (body as { result?: unknown } | null)?.result;
      return res.ok ? (r ?? {}) : { error: errorMessage(body, res.status) };
    }
    if (!res.ok) {
      // 403: the stored handle no longer verifies. Forget it so the next
      // browse_open starts a fresh session instead of failing forever.
      if (res.status === 403) dropHandle(chatId);
      return { error: errorMessage(body, res.status) };
    }
    const data = (body ?? {}) as {
      result?: unknown;
      handle?: unknown;
      liveViewUrl?: unknown;
      expiresAt?: unknown;
      idleMs?: unknown;
    };
    const result = data.result ?? {};
    if ((result as { sessionExpired?: unknown }).sessionExpired === true) {
      dropHandle(chatId);
      return result;
    }
    if (typeof data.handle === "string" && data.handle !== "") {
      saveHandle(chatId, data.handle);
    }
    if (typeof data.liveViewUrl === "string" && data.liveViewUrl !== "") {
      const expires = typeof data.expiresAt === "number" ? data.expiresAt : null;
      useCloudBrowserStore.getState().setSession(chatId, {
        liveViewUrl: data.liveViewUrl,
        expiresAt: expires,
        lastUsedAt: Date.now(),
        ...(typeof data.idleMs === "number" ? { idleMs: data.idleMs } : {}),
      });
    }
    return result;
  } catch (err) {
    if (timedOut) return { error: TIMEOUT_ERROR };
    return {
      error: `Could not reach the cloud browser: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ends the chat's cloud session. The chat is marked "releasing" at once, so
 * commands already in flight or queued cannot save a handle or set the live
 * view; the release request itself runs on the per-chat queue after they
 * finish, then handle + live view are cleared. Commands issued afterwards
 * start a new session. Best-effort, never rejects; resolves true when the
 * backend confirmed a release.
 */
export function releaseCloudBrowser(chatId: string): Promise<boolean> {
  releasing.set(chatId, (releasing.get(chatId) ?? 0) + 1);
  return runExclusive(chatId, async () => {
    const handle = getHandle(chatId);
    dropHandle(chatId);
    if (!handle) return false;
    return postRelease(chatId, handle);
  }).finally(() => {
    const n = (releasing.get(chatId) ?? 1) - 1;
    if (n <= 0) releasing.delete(chatId);
    else releasing.set(chatId, n);
  });
}

/**
 * `startJournal` answers `{ token }`; the package's recorder wants the bare
 * owner-token string. An `{ error }` (or any other shape) throws, so the
 * recorder reports a start failure instead of running without a journal.
 * Kept in one place so a change in the backend's response shape is a one-line fix.
 */
export function unwrapJournalToken(result: unknown): string {
  const r = (result ?? {}) as { token?: unknown; error?: unknown };
  if (typeof r.token === "string" && r.token !== "") return r.token;
  throw new Error(typeof r.error === "string" ? r.error : "the cloud browser returned no journal token");
}

function makeBridge(resolveChat: () => string): CloudBrowserBridge {
  const call = (name: string, args?: Record<string, unknown>) => {
    const chatId = resolveChat();
    const deadline = Date.now() + (COMMAND_TIMEOUT_MS[name] ?? DEFAULT_COMMAND_TIMEOUT_MS);
    return runExclusive(chatId, () => callCommand(chatId, name, args, deadline));
  };
  return {
    open: (args) => call("open", args),
    act: (args) => call("act", args),
    findImages: (args) => call("findImages", args),
    read: (args) => call("read", args),
    capture: (args) => call("capture", args),
    snapshot: () => call("snapshot"),
    perform: (args) => call("perform", args),
    screenshot: (args) => call("screenshot", args),
    tabs: (args) => call("tabs", args),
    // The signal and options of the BrowserBridge call stay local: the host
    // gate (allowNetworkMocks) is set by the backend, and the command timeout
    // bounds the request.
    applyFixture: (fixture) => call("applyFixture", { fixture }),
    releaseFixture: (token) => call("releaseFixture", { token }),
    // Checkpoint journal. captureCheckpoint's answer ({ ok, fixture, ... } or
    // { error }) goes to the package's normalizeCheckpoint as is.
    startJournal: async (opts) => unwrapJournalToken(await call("startJournal", { ...(opts?.origins ? { origins: opts.origins } : {}) })),
    stopJournal: (token) => call("stopJournal", token ? { token } : {}),
    assert: (args) => call("assert", args),
    clearActEmulation: () => call("clearActEmulation"),
    captureCheckpoint: (token) => call("captureCheckpoint", token ? { token } : {}),
  };
}

/** Follows the chat last passed to `setCloudBrowserChat`. */
export const cloudBrowserBridge: CloudBrowserBridge = makeBridge(
  () => currentChatId ?? FALLBACK_CHAT_ID
);

const boundBridges = new Map<string, CloudBrowserBridge>();

/** A bridge bound to one chat, so parallel chats never share a session. */
export function getCloudBrowserBridge(chatId?: string): CloudBrowserBridge {
  if (!chatId) return cloudBrowserBridge;
  let bridge = boundBridges.get(chatId);
  if (!bridge) {
    bridge = makeBridge(() => chatId);
    boundBridges.set(chatId, bridge);
  }
  return bridge;
}

// --- Session expiry --------------------------------------------------------
// One timer per live session, owned here (not by any view): it fires at the
// moment the backend will have dropped the session (min of hard expiry and
// last use + idle timeout) and clears local state. It re-arms itself because
// setTimeout cannot represent delays past ~24.8 days. A republished session
// (new lastUsedAt) replaces its timer; a cleared one drops it.

const MAX_TIMER_MS = 2 ** 31 - 1;
const expiryTimers = new Map<string, { session: CloudBrowserSession; timer?: ReturnType<typeof setTimeout> }>();

function armExpiry(chatId: string, session: CloudBrowserSession): void {
  const entry: { session: CloudBrowserSession; timer?: ReturnType<typeof setTimeout> } = { session };
  expiryTimers.set(chatId, entry);
  const staleAt = getSessionStaleAt(session);
  if (staleAt === null) return;
  const arm = () => {
    const remaining = staleAt - Date.now();
    if (remaining <= 0) {
      expireCloudBrowser(chatId);
      return;
    }
    entry.timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
  };
  arm();
}

function syncExpiryTimers(sessions: Record<string, CloudBrowserSession>): void {
  for (const [chatId, entry] of [...expiryTimers]) {
    if (sessions[chatId] === entry.session) continue;
    clearTimeout(entry.timer);
    expiryTimers.delete(chatId);
  }
  for (const [chatId, session] of Object.entries(sessions)) {
    if (!expiryTimers.has(chatId)) armExpiry(chatId, session);
  }
}

useCloudBrowserStore.subscribe((state, prev) => {
  if (state.sessions !== prev.sessions) syncExpiryTimers(state.sessions);
});
syncExpiryTimers(useCloudBrowserStore.getState().sessions);

/** Number of live expiry timers (tests: one per session, however many views). */
export function getExpiryTimerCount(): number {
  return [...expiryTimers.values()].filter((e) => e.timer !== undefined).length;
}
