import type { ModelContextLike } from "./types";

/**
 * Console banners for an agent that is already running JavaScript in the tab
 * and reading its console, but has no reason to suspect `navigator.modelContext`
 * exists unless something tells it so.
 *
 * WebMCP is a passive surface: nothing about a page announces it, so an agent
 * only finds it by already knowing to look — a chicken-and-egg problem for
 * exactly the audience this surface is for. A `console.info` costs nothing
 * and closes that gap for any agent whose harness (or the human driving it)
 * can read the console it is already sitting in.
 *
 * Every line carries the `[webmcp] ` prefix, on its own, so an agent filtering
 * the console by a regex on that literal string catches the whole message —
 * no `%c` styling and no `console.group`, both of which some harnesses don't
 * unwrap before matching.
 *
 * This module is imported from `earlyInstall.ts`, which sits in the entry
 * bundle shared with the showcase at "/". It must stay just as cheap: no
 * schemas, no store, no tool registry — plain strings only.
 */

/**
 * The native API's method for invoking a tool. Typed against
 * `ModelContextLike` rather than hardcoded, so a rename of the method on the
 * interface fails this file's typecheck (and the copy the test imports)
 * instead of leaving the banner's copy-pasted snippet silently wrong.
 */
const EXECUTE_TOOL_METHOD: keyof ModelContextLike = "executeTool";

function printBanner(lines: string[]): void {
  try {
    console.info(lines.map((line) => `[webmcp] ${line}`).join("\n"));
  } catch {
    // A console call failing (exotic harness, frozen console) must never take
    // down installation or registration, both of which call this after their
    // own work has already succeeded.
  }
}

/**
 * Called right after the page installs its model context (native or
 * polyfilled), before any tool exists on it. Tells a caller that checked
 * `getTools()` and found it empty *why*: the editor itself is still loading
 * in a lazy chunk, so this is "ask again shortly", not "this page doesn't
 * support WebMCP".
 */
export function announceSurfaceInstalled(): void {
  printBanner([
    "This page publishes agent tools via WebMCP. Look at navigator.modelContext or document.modelContext — both name the same object, because references disagree about which one is the address.",
    "No tools are registered yet — the editor loads in a separate chunk, so getTools() returns [] for a moment. Poll it; this is \"ask again\", not \"unsupported\".",
    "A second banner prints here once tools are registered.",
  ]);
}

export interface AnnounceToolsRegisteredInput {
  registered: string[];
  withheld: string[];
}

/** Builds the dedup key: same registered+withheld sets print nothing twice. */
function signatureOf({ registered, withheld }: AnnounceToolsRegisteredInput): string {
  return JSON.stringify([[...registered].sort(), [...withheld].sort()]);
}

let lastAnnouncedSignature: string | null = null;

/**
 * Called after `registerWebMcpTools()` succeeds. Re-runs on every editor
 * mount (remount, back/forward, forking a shared canvas), so this is
 * deduplicated on the registered+withheld set: an unchanged set prints
 * nothing, because otherwise a routine remount would look like repeated
 * churn in the console.
 */
export function announceToolsRegistered(result: AnnounceToolsRegisteredInput): void {
  // The whole body is guarded, not just the console call: `new URL(...)` and
  // `location.href` below run before it. `startWebMcp` calls this outside its
  // own try, and `App.tsx` invokes that as `void startWebMcp()` — so anything
  // escaping here becomes an unhandled rejection rather than a logged error.
  try {
    const signature = signatureOf(result);
    if (signature === lastAnnouncedSignature) return;
    lastAnnouncedSignature = signature;

    const { registered, withheld } = result;
    const base = import.meta.env.BASE_URL || "/";
    const manifestUrl = new URL(`${base}webmcp.json`, location.href).href;

    const lines = [
      `${registered.length} tool(s) registered: ${registered.join(", ")}`,
      // The one thing that trips every caller: arguments are a JSON *string*,
      // not an object — passing an object fails with a generic parse error.
      `Call with a JSON string, not an object: await navigator.modelContext.${EXECUTE_TOOL_METHOD}("get_editor_state", "{}")`,
    ];
    if (withheld.length > 0) {
      lines.push(
        `${withheld.length} tool(s) withheld because this canvas is not editable right now (shared view or view mode): ${withheld.join(", ")}`
      );
    }
    lines.push(`Full schema manifest: ${manifestUrl}`);

    printBanner(lines);
  } catch {
    // A banner is never worth failing registration for.
  }
}

/** Test seam: forget the last-announced set so the next call always prints. */
export function resetAnnounceForTests(): void {
  lastAnnouncedSignature = null;
}
