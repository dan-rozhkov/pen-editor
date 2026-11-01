import { hashString } from "@sideform/browser-agent/loop";
import type { DesktopBrowserBridge } from "@/lib/desktopBridge";
import { desktopBrowserBridge, isDesktopBrowserAvailable } from "./bridge";

/** Longest session id the desktop shell accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const SESSION_ID_MAX = 64;
const CHAT_HASH_CHARS = 8;
let runCounter = 0;

/**
 * Whether a browse_agent QA run can get its own browser: only the desktop shell
 * with `browser.isolated`. The web client keeps QA runs sequential in the shared
 * cloud browser (a Steel session is scarce: 5 server-wide, 20 creates per user
 * per day). Static for a page load, so it is safe to advertise as a capability.
 */
export function isolatedBrowseAvailable(): boolean {
  return isDesktopBrowserAvailable() && typeof desktopBrowserBridge()?.isolated === "function";
}

/**
 * Whether the chat agent can launch and drive an external desktop app
 * (`browse_open` / `browse_agent` with `app`): the desktop shell exposes
 * `releaseApp`. Static for a page load (a capability).
 */
export function desktopAppsAvailable(): boolean {
  const bridge = desktopBrowserBridge() as DesktopBrowserBridge | undefined;
  return typeof bridge?.launchApp === "function" && typeof bridge?.releaseApp === "function";
}

/**
 * Whether the desktop shell can also drive native macOS apps (`nativeApps === true`
 * on top of `launchApp` and `releaseApp`). Static for a page load (a capability).
 */
export function desktopNativeAppsAvailable(): boolean {
  const bridge = desktopBrowserBridge() as DesktopBrowserBridge | undefined;
  return desktopAppsAvailable() && bridge?.nativeApps === true;
}

/** The `app` argument of a browse_open / browse_agent call: a non-empty trimmed string, else undefined. */
export function appArgOf(args: unknown): string | undefined {
  const app = typeof args === "object" && args !== null ? (args as { app?: unknown }).app : undefined;
  const trimmed = typeof app === "string" ? app.trim() : "";
  return trimmed === "" ? undefined : trimmed;
}

/** Extra time a launch (native confirm + up to 30 s start) may take on top of a run's normal budget. */
export const APP_LAUNCH_ALLOWANCE_MS = 80_000;

/**
 * Whether the browser the client uses can run `qa_assert` / final checks: the cloud bridge always can;
 * a desktop shell only with `browser.assert` (an older shell lacks it). Static for a page load.
 */
export function browseAssertAvailable(): boolean {
  return !isDesktopBrowserAvailable() || typeof desktopBrowserBridge()?.assert === "function";
}

const idSafe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
const NONCE_CHARS = 6;
const nonce = () => Math.random().toString(36).slice(2, 2 + NONCE_CHARS).padEnd(NONCE_CHARS, "0");

/**
 * The single predicate for "this browse_agent call is an isolated QA run": QA
 * mode, a goal and a shell that can isolate. `resume` does not matter: a QA call
 * with `resume` on an isolating shell continues a scenario in its own session. The hook (do not await) and the handler (take a slot) both use it.
 */
export function isIsolatedQaCall(args: Record<string, unknown>): boolean {
  return (
    args.qa === true &&
    typeof args.goal === "string" &&
    args.goal.trim() !== "" &&
    isolatedBrowseAvailable()
  );
}

/** `<prefix>-<hash of chat>-<tool call id>-<nonce>`, at most 64 chars; an over-long tool call id is cut and ends in its own hash. */
function sessionIdWithPrefix(prefix: string, chatId: string, toolCallId: string | undefined): string {
  const head = `${prefix}-${hashString(chatId).slice(0, CHAT_HASH_CHARS)}-`;
  const suffix = `-${nonce()}`;
  const room = SESSION_ID_MAX - head.length - suffix.length;
  const call = idSafe(toolCallId ?? `${Date.now().toString(36)}${(runCounter++).toString(36)}`);
  if (call.length <= room) return head + call + suffix;
  const tail = hashString(toolCallId ?? call).slice(0, CHAT_HASH_CHARS);
  return `${head}${call.slice(0, room - tail.length - 1)}-${tail}${suffix}`;
}

/**
 * The run's session id: `qa-<hash of chat>-<tool call id>-<nonce>`, at most 64
 * chars, unique per run (the shell treats a closed id as dead for good, so a
 * repeated tool call id must not reuse one). A tool call id too long to fit is
 * cut and ends in its own hash.
 */
export function runSessionId(chatId: string | undefined, toolCallId: string | undefined): string {
  return sessionIdWithPrefix("qa", chatId ?? "no-chat", toolCallId);
}

/**
 * The session id of a NON-QA native-app run: `app-<hash of chat>-<tool call id>-<nonce>`, at most 64 chars, unique
 * per run (the shell treats a closed id as dead for good, so a repeated or replayed tool call id must not reuse a
 * closed one). Two runs of one chat get different ids, so concurrent app runs never share the shell's app binding.
 * A tool call id too long to fit is cut and ends in its own hash. Closed at the end of the run.
 */
export function appSessionId(chatId: string, toolCallId?: string): string {
  return sessionIdWithPrefix("app", chatId, toolCallId);
}

/**
 * The app session of this browse_agent call, or undefined: set only for a non-QA native-app run (it names an
 * `app`, is not an isolated QA run) with a chat id, on a shell with `browser.isolated`.
 */
export function appSessionFor(args: Record<string, unknown>, chatId: string | undefined, toolCallId: string | undefined): string | undefined {
  if (!chatId || appArgOf(args) === undefined || isIsolatedQaCall(args) || !isolatedBrowseAvailable()) return undefined;
  return appSessionId(chatId, toolCallId);
}

const MAX_RUN_SESSIONS = 500;
const runSessionsByCall = new Map<string, string>();

/** Remembers which isolated session a `browse_agent` call runs in, so its chip can reveal that tab. Bounded, oldest dropped. */
export function rememberRunSession(toolCallId: string, runSession: string): void {
  runSessionsByCall.delete(toolCallId);
  runSessionsByCall.set(toolCallId, runSession);
  if (runSessionsByCall.size > MAX_RUN_SESSIONS) runSessionsByCall.delete(runSessionsByCall.keys().next().value as string);
}

/** The isolated session of a `browse_agent` call, or undefined (not isolated, or not remembered). */
export function runSessionForCall(toolCallId: string): string | undefined {
  return runSessionsByCall.get(toolCallId);
}
