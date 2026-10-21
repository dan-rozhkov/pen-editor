import { createHarnessTransport } from "@sideform/agent-harness/transport";
import type { RetryState } from "@sideform/agent-harness/retry-fetch";
import { credentialsMode, isOffline, OFFLINE_MESSAGE, resolveApiUrl } from "@/lib/apiBase";
import { getOpenCodeKey } from "@/lib/opencodeKey";
import { withMobbinAuthHeader } from "@/lib/mobbinAuth";
import { getAgentPanelDocsBridge, getAgentPanelTraceTabsBridge } from "@/lib/agentPanel";
import { isPanelCanvasLinkActive } from "@/lib/canvasLink/panelRuntime";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { browseAssertAvailable, desktopAppsAvailable, desktopNativeAppsAvailable, isolatedBrowseAvailable } from "@/lib/tools/browser/isolation";

// Shared by the main chat (hooks/useDesignChat.ts) and the nested browse
// sub-agent session (lib/tools/browser/browseAgent.ts) so both hit /api/chat
// with the same credentials, retrying fetch, Mobbin token and X-OpenCode-Key
// handling.

// Told to the backend on every request so it can gate the browse_* tools
// into the per-request tool set (pen-editor-desktop's docs/superpowers/
// specs/2026-09-18-builtin-browser-design.md §6/§7). Derived ONCE at module
// scope, not per render or per request: `window.penDesktop.browser` cannot
// appear or disappear mid-session, and the tool set this flag controls is
// part of the cached request prefix — a value that changed request to
// request would invalidate prompt caching the same way a rebuilt
// canvasContext did before that was fixed (root CLAUDE.md's "prompt-cache
// invariants").
const DESKTOP_BROWSER = isDesktopBrowserAvailable();
// `browser` supersedes the legacy `desktopBrowser` boolean: on the web the
// tools run against a cloud browser, and the backend alone decides whether
// that is enabled (pen-editor-backend docs/specs/2026-09-29-cloud-browser-
// steel-design.md §3.7/§4). `desktopBrowser` stays for older backends.
export const CLIENT_CAPABILITIES = {
  desktopBrowser: DESKTOP_BROWSER,
  browser: DESKTOP_BROWSER ? "desktop" : "cloud",
  // browse_agent can run in QA mode (`qa: true`): the backend then offers the
  // model the `qa` param (pen-editor-backend QA suite spec).
  browseQa: true,
  // Isolated QA runs are available (the shell's `browser.isolated`): the backend then tells the model to call several QA
  // scenarios in one step. Desktop with `browser.isolated` only; static per page
  // load, like `desktopBrowser` (a flip would break the prompt cache).
  browseIsolation: isolatedBrowseAvailable(),
  // The browser in use supports `assert`: the backend then offers `qa_assert` and browse_agent `checks`.
  browseAssert: browseAssertAvailable(),
  // The desktop shell can launch and drive an external app (`releaseApp`): the backend then offers `app` on browse_open / browse_agent.
  browseApps: desktopAppsAvailable(),
  // The desktop shell can also drive native macOS apps (`nativeApps`): the backend then adds the native-app text.
  browseNativeApps: desktopNativeAppsAvailable(),
  // The desktop agent panel has a canvas bridge: the backend then offers `open_canvas_tab`.
  // Static per page load like the others (a flip would break the prompt cache).
  canvasTabs: isPanelCanvasLinkActive(),
  // The desktop panel can open markdown document tabs: the backend then offers doc_*.
  docTabs: getAgentPanelDocsBridge() !== undefined,
  // The desktop panel can list and read open browse-run trace tabs: the backend then offers trace_list / trace_read.
  traceTabs: getAgentPanelTraceTabsBridge() !== undefined,
} as const;

// Whether `model` is an OpenCode BYOK route (pen-editor-backend
// docs/specs/2026-09-18-opencode-byok-design.md), i.e. one of the two
// slash-prefixed ids OpenCode's own config uses ("opencode-go/<id>",
// "opencode/<id>") — checked by PREFIX rather than by looking the id up in
// chatModels' `requiresUserKey` flag, on purpose: prepareSendMessagesRequest
// runs on every send including every tool-loop auto-continuation, and it
// must decide this from `body.model` alone (a plain string in the outgoing
// request), not from a lookup into the model list that could be stale (a
// selection made before GET /api/models answered) or, worse, momentarily
// empty in a test/offline context. The backend's own parseModelRef
// (src/ai/modelRef.ts) recognizes exactly these two prefixes, so matching
// them here keeps this function and the backend's routing decision talking
// about the same string.
export function isOpenCodeModel(model: string): boolean {
  return model.startsWith("opencode-go/") || model.startsWith("opencode/");
}

// Exported for tests.
export function resolveChatApiUrl(): string {
  // VITE_AI_API_URL is the explicit full chat URL; honor it verbatim. Otherwise
  // derive /api/chat from the shared backend base resolver.
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  return explicitApiUrl ?? resolveApiUrl("/api/chat");
}

export interface ChatTransportOptions {
  /** Extra request body fields, resolved on every send. May be async (the AI SDK awaits it): the agent panel fetches the canvas tab's context here. */
  body: () => object | Promise<object>;
  onRetryStateChange?: (state: RetryState | null) => void;
  /** Test seam: replaces the network fetch under the retrying wrapper. */
  fetchImpl?: typeof fetch;
}

export function createChatTransport({ body, onRetryStateChange, fetchImpl }: ChatTransportOptions) {
  return createHarnessTransport({
    api: resolveChatApiUrl(),
    // Session cookie only once accounts are known to be enabled (see
    // apiBase.ts withCredentials); resolved per request.
    credentials: () => credentialsMode() as RequestCredentials,
    // withMobbinAuthHeader wraps the retrying fetch so the *actual* network
    // call always carries a currently-valid X-Mobbin-Token header (refreshed
    // first if it had expired) or none at all — see its doc comment in
    // mobbinAuth.ts. The token must NEVER ride in `body`: body is recorded
    // into `raw_traces` on the backend.
    wrapFetch: withMobbinAuthHeader,
    isOffline,
    offlineMessage: OFFLINE_MESSAGE,
    onRetryStateChange,
    fetchImpl,
    body,
    // The OpenCode key is attached per send (not at construction) so a key
    // entered mid-session is picked up on the next request, including every
    // tool-loop auto-continuation. It rides as a header, never in `body`
    // (stored forever in raw_traces), and ONLY when this turn's model is an
    // OpenCode route: on every OpenRouter turn it must never leave the
    // browser. Images always ride along regardless of model vision support —
    // the backend decides native-vs-described per model
    // (pen-editor-backend/src/ai/vision-messages.ts).
    extraHeaders: (requestBody) => {
      const model = requestBody?.model;
      if (typeof model !== "string" || !isOpenCodeModel(model)) return undefined;
      const key = getOpenCodeKey();
      return key ? { "X-OpenCode-Key": key } : undefined;
    },
  });
}
