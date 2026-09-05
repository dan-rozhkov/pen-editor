import { installModelContextPolyfill, type PolyfillResult } from "./polyfill";
import {
  registerWebMcpTools,
  setSurfaceActive,
  type RegistrationResult,
} from "./registerTools";

export { getModelContext, installModelContextPolyfill } from "./polyfill";
export { registerWebMcpTools } from "./registerTools";
export { WEBMCP_TOOL_SPECS, WEBMCP_TOOL_NAMES } from "./schemas";

export interface WebMcpStartResult extends RegistrationResult {
  available: boolean;
  /** True when the browser supplied the API and the polyfill stood down. */
  native: boolean;
}

/**
 * The polyfill is installed at most once per page; registration is not.
 * Installing twice would drop every tool registered against the first
 * context, whereas re-registering is both cheap and idempotent by name.
 */
let polyfill: PolyfillResult | null = null;

/**
 * Brings up the WebMCP surface: installs the polyfill when the browser has
 * no model context, then publishes the editor's tools on it.
 *
 * Called from the editor route only (src/App.tsx). It must not run on the
 * showcase at "/": that route deliberately keeps the editor's module graph
 * — sceneStore, the tool registry, PixiJS — out of its entry bundle, and
 * this module statically imports all of it. It is also simply untrue there;
 * there is no document for the tools to act on.
 *
 * Registration re-runs on every mount rather than being memoized, because
 * *which* tools belong on the surface depends on the document that is open
 * now. Forking a shared canvas (SharedCanvasBar's "make a copy") is a
 * client-side navigation from `/c/:shareId` to `/app`: the editor remounts,
 * and the canvas that was read-only a moment ago is now the user's own. A
 * memoized first result would leave that forked, fully editable document
 * advertising only the read-only tools for the rest of the tab session, with
 * nothing to signal why. `registerTool` replaces by name, so re-running is
 * safe and cheap.
 */
export async function startWebMcp(): Promise<WebMcpStartResult> {
  polyfill ??= installModelContextPolyfill();
  const { available, native } = polyfill;
  if (!available) {
    return { available, native, registered: [], withheld: [] };
  }

  // Set before awaiting registration, cleared by stopWebMcp. If the route
  // unmounts while this is in flight, the cleanup wins: the tools finish
  // registering onto an inactive surface and refuse until a remount.
  setSurfaceActive(true);

  try {
    const registration = await registerWebMcpTools();
    return { available, native, ...registration };
  } catch (error) {
    // An agent surface failing to come up must never take the editor with it.
    console.error("[webmcp] failed to start", error);
    return { available: false, native, registered: [], withheld: [] };
  }
}

/**
 * Marks the surface as unowned when the editor route unmounts. The tools stay
 * registered — neither the native API nor the polyfill can withdraw one — but
 * they refuse until an editor mounts again. See `setSurfaceActive`.
 */
export function stopWebMcp(): void {
  setSurfaceActive(false);
}

/** Test seam: forget the installed-polyfill memo and deactivate the surface. */
export function resetWebMcpForTests(): void {
  polyfill = null;
  setSurfaceActive(false);
}
