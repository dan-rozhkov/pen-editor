import { resolveApiUrl } from "@/lib/apiBase";
import { getUserId } from "@/lib/userId";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";
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
  return fetch(resolveApiUrl("/api/browser/release"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: getUserId(), chatId, handle }),
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
    const res = await fetch(resolveApiUrl(`/api/browser/cmd/${name}`), {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: getUserId(),
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
    snapshot: () => call("snapshot"),
    perform: (args) => call("perform", args),
    screenshot: (args) => call("screenshot", args),
    tabs: (args) => call("tabs", args),
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
