import type { PenDesktopApi } from "@/lib/desktopBridge";
import { cloudBrowserBridge, getCloudBrowserBridge } from "@/lib/cloudBrowser";

export type BrowserBridge = NonNullable<PenDesktopApi["browser"]>;

/**
 * The bridge every browse_* handler talks to: the Electron shell's own
 * `window.penDesktop.browser` when present (byte-identical desktop
 * behavior), otherwise the cloud bridge that forwards to the backend
 * (pen-editor-backend docs/specs/2026-09-29-cloud-browser-steel-design.md).
 * `chatId` binds the cloud bridge to the calling chat's session; without it
 * the chat last set via `setCloudBrowserChat` is used.
 *
 * `browserSession` (a browse_agent QA run's id) selects the run's isolated
 * browser: the shell's `browser.isolated(id)`. Desktop only: the cloud browser
 * has no isolated sessions (a Steel session is scarce, see the isolation spec).
 * Ignored when isolation is unavailable.
 */
// One isolated bridge per run session, dropped by closeBrowserSession.
const isolatedBridges = new Map<string, BrowserBridge>();
// Run sessions already closed (bounded): the shell treats a closed id as dead
// for good, so a straggler call must not revive it through `isolated()`.
const MAX_CLOSED_SESSIONS = 500;
const closedSessions = new Set<string>();
const CLOSED_ERROR = { error: "browser session closed" };
const closedBridge = new Proxy({} as BrowserBridge, {
  get: (_t, key) => (key === "then" || typeof key === "symbol" ? undefined : async () => CLOSED_ERROR),
});

export function getBrowserBridge(chatId?: string, browserSession?: string): BrowserBridge | undefined {
  const desktop = window.penDesktop?.browser;
  if (desktop && browserSession && typeof desktop.isolated === "function") {
    if (closedSessions.has(browserSession)) return closedBridge;
    let bridge = isolatedBridges.get(browserSession);
    if (!bridge) {
      bridge = desktop.isolated(browserSession);
      isolatedBridges.set(browserSession, bridge);
    }
    return bridge;
  }
  if (desktop) return desktop;
  return chatId ? getCloudBrowserBridge(chatId) : cloudBrowserBridge;
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
      window.penDesktop?.browser?.closeSession?.(browserSession),
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

// Lives in its own dependency-free module (the surface metadata and so the embed
// entry need it without the cloud browser); re-exported for existing importers.
export { isDesktopBrowserAvailable } from "./desktopBrowser";
