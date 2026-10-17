import { DefaultChatTransport } from "ai";
import { credentialsMode, resolveApiUrl } from "@/lib/apiBase";
import { getOpenCodeKey } from "@/lib/opencodeKey";
import { createRetryingFetch, type RetryState } from "@/lib/retryFetch";
import { withMobbinAuthHeader } from "@/lib/mobbinAuth";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";

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
  /** Extra request body fields, resolved on every send. */
  body: () => object;
  onRetryStateChange?: (state: RetryState | null) => void;
}

export function createChatTransport({ body, onRetryStateChange }: ChatTransportOptions) {
    return new DefaultChatTransport({
      api: resolveChatApiUrl(),
      // Session cookie only once accounts are known to be enabled (see
      // apiBase.ts withCredentials); resolved per request.
      credentials: () => credentialsMode() as RequestCredentials,
      // withMobbinAuthHeader wraps the retrying fetch so the *actual*
      // network call always carries a currently-valid X-Mobbin-Token
      // header (refreshed first if it had expired) or none at all — see
      // its doc comment in mobbinAuth.ts for why the header is set here
      // rather than only in prepareSendMessagesRequest below.
      fetch: withMobbinAuthHeader(
        createRetryingFetch({ onRetryStateChange: onRetryStateChange ?? (() => {}) }),
      ),
      body,
      prepareSendMessagesRequest: ({ id, messages, body, headers: baseHeaders, trigger, messageId }) => {
        // Images always ride along regardless of the selected model's
        // vision support — the backend decides native-vs-described per
        // model
        // (pen-editor-backend/src/ai/vision-messages.ts) and never
        // forwards raw image parts to a model that can't read them. See
        // pen-editor-backend/docs/specs/2026-08-14-agent-vision-design.md.
        //
        // The OpenCode key is attached HERE, not baked into the transport
        // at construction: a transport lives as long as its chat session
        // (the main chat's for the whole mounted session; the nested browse
        // session builds its own per tool call), so a key read once at
        // construction would go stale. This function is re-evaluated on
        // every send, including every tool-loop auto-continuation, so a key
        // entered mid-session is picked up on the very next request. It rides as a header, never in `body` —
        // the request body is what reaches pen-editor-backend's
        // `raw_traces`, and a key that ever landed there would be stored
        // forever (see the spec's "Поток ключа"). Sent ONLY when this
        // turn's model is actually an OpenCode route: on every OpenRouter
        // turn the key must never leave the browser at all.
        //
        // `baseHeaders` (renamed from this callback's own `headers` param)
        // is what HttpChatTransport.sendMessages already computed as the
        // request's base header set (its `headers` option merged with
        // whatever `sendMessage` was called with) before invoking us —
        // see node_modules/ai/dist/index.mjs, `sendMessages`. Whatever we
        // return here becomes the request's ENTIRE header set if we
        // return one at all; it does not get merged on top of
        // `baseHeaders` for us. Returning `{ "X-OpenCode-Key": key }`
        // alone would silently drop every header the transport itself
        // would otherwise send — harmless today since nothing sets any,
        // but a future transport-level header would then vanish only on
        // OpenCode turns, which is a hard bug to spot from the symptom.
        // Spread `baseHeaders` first so ours only adds to it.
        const model = (body as { model?: unknown } | undefined)?.model;
        const openCodeHeaders =
          typeof model === "string" && isOpenCodeModel(model)
            ? (() => {
                const key = getOpenCodeKey();
                return key ? { "X-OpenCode-Key": key } : undefined;
              })()
            : undefined;
        // `Headers` also satisfies `HeadersInit` for the return value, and
        // its constructor accepts every shape `HeadersInit` allows
        // (another `Headers`, a `[k, v][]`, or a plain object) — so
        // building one is a shape-agnostic way to merge `baseHeaders`
        // (whatever form the SDK handed us) with ours.
        const headers =
          baseHeaders || openCodeHeaders
            ? (() => {
                const merged = new Headers(baseHeaders);
                if (openCodeHeaders) {
                  for (const [key, value] of Object.entries(openCodeHeaders)) {
                    merged.set(key, value);
                  }
                }
                return merged;
              })()
            : undefined;
        // The Mobbin token, by contrast, must NEVER ride in `body` — it's
        // a user-held OAuth credential, and `body` gets recorded into
        // `raw_traces` on the backend (src/routes/chat.ts). It only ever
        // travels as the X-Mobbin-Token header, and only ever set in ONE
        // place: `withMobbinAuthHeader` above, which wraps the transport's
        // `fetch` and attaches a currently-valid (refreshed if needed)
        // token right before the network call actually goes out. Returning
        // a `headers` object from here would REPLACE `baseHeaders` wholesale
        // per the AI SDK's own semantics, not merge into it — and it would
        // be redundant besides, since withMobbinAuthHeader overwrites
        // whatever header value arrives here anyway.
        return {
          ...(headers ? { headers } : {}),
          body: {
            ...body,
            id,
            messages,
            trigger,
            messageId,
          },
        };
      },
    });
}
