import type { PenDesktopApi } from "@/lib/desktopBridge";
import { cloudBrowserBridge, getCloudBrowserBridge } from "@/lib/cloudBrowser";

export type BrowserBridge = NonNullable<PenDesktopApi["browser"]>;

// One isolated bridge per run session, dropped by closeBrowserSession.
const isolatedBridges = new Map<string, BrowserBridge>();
// Run sessions already closed (bounded): the shell treats a closed id as dead
// for good, so a straggler call must not revive it through `isolated()`.
const MAX_CLOSED_SESSIONS = 500;
const closedSessions = new Set<string>();
// The shell rejects any other chat id, so such an id never leaves this module.
const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CLOSED_ERROR = { error: "browser session closed" };
const closedBridge = new Proxy({} as BrowserBridge, {
  get: (_t, key) => (key === "then" || typeof key === "symbol" ? undefined : async () => CLOSED_ERROR),
});

/**
 * The shell's own browser bridge: `window.penDesktop.browser` in an editor tab,
 * `window.penAgentPanel.browser` in the agent panel (which has no scene but runs
 * every browse_* tool itself; same shape).
 */
export function desktopBrowserBridge(): BrowserBridge | undefined {
  return window.penDesktop?.browser ?? window.penAgentPanel?.browser;
}

/**
 * The bridge every browse_* handler talks to: the Electron shell's own
 * `window.penDesktop.browser` when present (byte-identical desktop
 * behavior), otherwise the cloud bridge that forwards to the backend
 * (pen-editor-backend docs/specs/2026-09-29-cloud-browser-steel-design.md).
 * `chatId` binds the cloud bridge to the calling chat's session; without it
 * the chat last set via `setCloudBrowserChat` is used.
 *
 * `browserSession` (a browse_agent QA run's id, or a non-QA app run's session id) selects the run's
 * isolated bridge: the shell's `browser.isolated(id)`. Desktop only: the cloud browser
 * has no isolated sessions (a Steel session is scarce, see the isolation spec).
 * Ignored when isolation is unavailable.
 *
 * Without a run session, a shell that has `browser.forChat` gets the calling chat's own
 * bridge (a stateless wrapper, built per call), so each chat keeps its own app binding. Falls back to the
 * shared `browser` when `forChat` is missing or `chatId` is not a valid shell id.
 */
export function getBrowserBridge(chatId?: string, browserSession?: string): BrowserBridge | undefined {
  const desktop = desktopBrowserBridge();
  if (desktop && browserSession && typeof desktop.isolated === "function") {
    if (closedSessions.has(browserSession)) return closedBridge;
    let bridge = isolatedBridges.get(browserSession);
    if (!bridge) {
      bridge = desktop.isolated(browserSession);
      isolatedBridges.set(browserSession, bridge);
    }
    return bridge;
  }
  if (desktop) {
    const chatBridge = chatId ? desktopChatBridge(desktop, chatId) : undefined;
    return chatBridge ?? desktop;
  }
  return chatId ? getCloudBrowserBridge(chatId) : cloudBrowserBridge;
}

/** The chat's own view of the shared browser, or undefined (old shell, or an id the shell rejects). */
function desktopChatBridge(desktop: BrowserBridge, chatId: string): BrowserBridge | undefined {
  if (!CHAT_ID_PATTERN.test(chatId) || typeof desktop.forChat !== "function") return undefined;
  return desktop.forChat(chatId);
}

/**
 * Ends the desktop app that one chat launched (`releaseApp` on its per-chat bridge).
 * Fire-and-forget; never throws. Does nothing without `forChat` or with an invalid id.
 */
export function releaseDesktopChatApp(chatId: string): void {
  try {
    const desktop = desktopBrowserBridge();
    const release = desktop ? desktopChatBridge(desktop, chatId)?.releaseApp?.() : undefined;
    void Promise.resolve(release).catch(() => {});
  } catch {
    // Best effort: the shell also drops a chat's binding when its tab closes.
  }
}

/** Longest wait for the shell to confirm a close: a hung shell must not hold the run (and its slot) forever. */
export const CLOSE_SESSION_TIMEOUT_MS = 15_000;

/** Ends an isolated run's browser. Bounded by CLOSE_SESSION_TIMEOUT_MS; never rejects. */
export async function closeBrowserSession(browserSession: string): Promise<void> {
  closedSessions.add(browserSession);
  if (closedSessions.size > MAX_CLOSED_SESSIONS) closedSessions.delete(closedSessions.values().next().value as string);
  isolatedBridges.delete(browserSession);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      desktopBrowserBridge()?.closeSession?.(browserSession),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_SESSION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Best effort: the shell also closes a session when its editor tab goes away.
  } finally {
    clearTimeout(timer);
    isolatedBridges.delete(browserSession);
  }
}

/**
 * The single predicate for "this client has its own built-in browser": the
 * Electron shell exposes `window.penDesktop.browser` (or the agent panel
 * `window.penAgentPanel.browser`). A `penDesktop` without
 * `.browser` (older shell) falls through to the cloud browser, so bridge
 * selection, the live-view panel and the request capability must all use this.
 */
export function isDesktopBrowserAvailable(): boolean {
  return Boolean(desktopBrowserBridge());
}

/** Test-only: forget cached bridges and closed ids. */
export function resetBrowserBridgeCacheForTests(): void {
  isolatedBridges.clear();
  closedSessions.clear();
}
