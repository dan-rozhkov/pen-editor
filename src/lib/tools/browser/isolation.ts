import { hashString } from "@sideform/browser-agent/loop";
import { isDesktopBrowserAvailable } from "./bridge";

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
  return isDesktopBrowserAvailable() && typeof window.penDesktop?.browser?.isolated === "function";
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

/**
 * The run's session id: `qa-<hash of chat>-<tool call id>-<nonce>`, at most 64
 * chars, unique per run (the shell treats a closed id as dead for good, so a
 * repeated tool call id must not reuse one). A tool call id too long to fit is
 * cut and ends in its own hash.
 */
export function runSessionId(chatId: string | undefined, toolCallId: string | undefined): string {
  const prefix = `qa-${hashString(chatId ?? "no-chat").slice(0, CHAT_HASH_CHARS)}-`;
  const suffix = `-${nonce()}`;
  const room = SESSION_ID_MAX - prefix.length - suffix.length;
  const call = idSafe(toolCallId ?? `${Date.now().toString(36)}${(runCounter++).toString(36)}`);
  if (call.length <= room) return prefix + call + suffix;
  const tail = hashString(toolCallId ?? call).slice(0, CHAT_HASH_CHARS);
  return `${prefix}${call.slice(0, room - tail.length - 1)}-${tail}${suffix}`;
}
