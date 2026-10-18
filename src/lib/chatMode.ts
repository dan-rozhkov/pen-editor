/**
 * "Chatless" editor mode: `/app?chat=off` is the full editor minus the agent
 * chat. The desktop app hosts the chat in its own always-visible panel and
 * loads the canvas as a tab of `/app?chat=off`, so the in-editor Agents
 * section, every on-canvas "ask the agent" affordance and the chat-only
 * startup work must be absent. Tool infrastructure (WebMCP, MCP bridges,
 * plugins, tool handlers) stays fully alive so an external driver can still
 * operate this canvas.
 *
 * This is the ONE predicate for the mode. Any new agent entry point (a button,
 * palette command, context-menu item, deep link, startup fetch) must be gated
 * on `isChatDisabled()` — never parse the URL ad hoc.
 *
 * Parsing mirrors the `?view` flag in App.tsx, inverted: `chat=off`, `chat=0`
 * and `chat=false` disable the chat; absent or any other value leaves it on.
 *
 * The flag is sticky only once seen ON. While the cached value is false the
 * URL is re-read on every call (cheap), so a store imported early on `/`
 * cannot freeze chat mode before a client-side navigation to `/app?chat=off`.
 * Once ON it stays on for the page's lifetime: the router's `navigate("/app")`
 * calls (shared canvas fork, showcase "open editor") drop the query string but
 * not the mode. A full reload of a URL without the flag re-enables the chat.
 *
 * What chatless mode does NOT do: it keeps `loadModels()` (the same response
 * carries image-ops capabilities and vision metadata used by non-chat tooling)
 * and it never consumes the showcase agent prompt — that stays untouched in
 * sessionStorage (`pen:showcase-agent-prompt:v1`) for the desktop chat panel
 * to pick up later.
 */
import type { LeftSection } from "@/store/leftSidebarStore";

/** Rail sections the editor must not offer in chatless mode. */
export const CHATLESS_HIDDEN_SECTIONS: readonly LeftSection[] = ["agents"];

/** `hiddenSections` for LeftRail / LeftSidebarBase: undefined when the chat is on. */
export function chatHiddenSections(): readonly LeftSection[] | undefined {
  return isChatDisabled() ? CHATLESS_HIDDEN_SECTIONS : undefined;
}

const OFF_VALUES = new Set(["off", "0", "false"]);

/** true once the flag has been seen ON (sticky); false means "re-read the URL". */
let seenOn = false;

export function isChatDisabled(): boolean {
  if (seenOn) return true;
  try {
    const value = new URLSearchParams(window.location.search).get("chat");
    seenOn = value !== null && OFF_VALUES.has(value.toLowerCase());
  } catch {
    // keep false
  }
  return seenOn;
}

/** Test-only: forget the cached value so the next call re-reads the URL. */
export function resetChatModeForTests(): void {
  seenOn = false;
}
