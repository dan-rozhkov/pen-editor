import { installModelContextPolyfill } from "./polyfill";

/**
 * Installs the model context from the entry bundle, before the editor loads.
 *
 * Why this is separate from `startWebMcp()`: the tools are registered from
 * `App.tsx`, which lives in a lazily imported chunk. Measured on production,
 * that chunk does not even *begin* downloading until after the `load` event —
 * entry bundle 432-767ms, `load` at 1312ms, editor chunk 1311-1656ms — and
 * registration then waits for React to mount and run an effect. An agent that
 * waits for `load` and checks the page (the obvious thing to do, and what a
 * browser-driving agent does by default) therefore found no model context at
 * all, and reasonably concluded the page does not support WebMCP.
 *
 * Installing the context early does not make the tools appear any sooner —
 * nothing can, and the native API has no readiness signal either. What it
 * changes is the *shape* of the answer an early caller gets: an empty
 * `getTools()`, which means "not yet, ask again", instead of a missing API,
 * which means "never". The first is a state worth polling; the second ends
 * the conversation.
 *
 * This module must stay cheap enough to sit in the entry bundle: it imports
 * `polyfill.ts`, whose only import is type-only and erased at build time.
 * Never let it reach the tool registry or the stores — the showcase at "/"
 * shares this bundle and must not pay for the editor's module graph.
 */

/**
 * Routes where an editor mounts and tools will follow. The showcase at "/"
 * is deliberately excluded: advertising a model context on a page that will
 * never register a tool is its own kind of lie, and it would contradict the
 * invariant that this surface exists only where a document does.
 */
function isEditorRoute(pathname: string): boolean {
  const base = import.meta.env.BASE_URL || "/";
  const path = pathname.startsWith(base) ? pathname.slice(base.length - 1) : pathname;
  return path === "/app" || path.startsWith("/app/") || path.startsWith("/c/");
}

export function installModelContextForEditorRoute(
  pathname: string = window.location.pathname
): boolean {
  if (!isEditorRoute(pathname)) return false;
  return installModelContextPolyfill().available;
}

/** Exported for tests; the route rule is easy to get wrong under a base path. */
export { isEditorRoute };
