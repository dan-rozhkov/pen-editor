import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { track, bucketLength } from "@/lib/analytics";
import { consumeFirstPromptTiming } from "@/lib/analytics/sessionTiming";
import { resolveApiUrl, isOffline, OFFLINE_MESSAGE } from "@/lib/apiBase";
import { getUserId } from "@/lib/userId";
import { canSendImages } from "@/lib/chatModels";
import { getOpenCodeKey } from "@/lib/opencodeKey";
import { createRetryingFetch, type RetryState } from "@/lib/retryFetch";
import { withMobbinAuthHeader } from "@/lib/mobbinAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { getVariableCssName } from "@/types/variable";
import { useRepoContextStore } from "@/store/repoContextStore";
import { useChatStore, NO_QUEUED_MESSAGES } from "@/store/chatStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { toolHandlers, type ToolExecutionContext } from "@/lib/toolRegistry";
import { runToolCall } from "@/lib/toolCallQueue";
import type { ChatLaunchPayload } from "@/types/chat";
import { hasPendingAskUser } from "@/components/chat/pendingAskUser";
import { extractStreamingToolInputs } from "@/hooks/streamingToolParts";
import {
  streamingToolAdapters,
  streamingToolNames,
  getStreamingToolAdapter,
} from "@/lib/streamingTools";

const STREAM_RENDER_THROTTLE_MS = 50;

// Told to the backend on every request so it can gate the browse_* tools
// into the per-request tool set (pen-editor-desktop's docs/superpowers/
// specs/2026-09-18-builtin-browser-design.md §6/§7). Derived ONCE at module
// scope, not per render or per request: `window.penDesktop.browser` cannot
// appear or disappear mid-session, and the tool set this flag controls is
// part of the cached request prefix — a value that changed request to
// request would invalidate prompt caching the same way a rebuilt
// canvasContext did before that was fixed (root CLAUDE.md's "prompt-cache
// invariants").
const CLIENT_CAPABILITIES = {
  desktopBrowser: Boolean(window.penDesktop?.browser),
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
function isOpenCodeModel(model: string): boolean {
  return model.startsWith("opencode-go/") || model.startsWith("opencode/");
}

// Exported for tests.
export function resolveChatApiUrl(): string {
  // VITE_AI_API_URL is the explicit full chat URL; honor it verbatim. Otherwise
  // derive /api/chat from the shared backend base resolver.
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  return explicitApiUrl ?? resolveApiUrl("/api/chat");
}

// A session must use ITS OWN chat's model rather than the global active-chat
// value, which openChat overwrites on every switch. Without this, switching
// chats while a background session streams hijacks that session's
// auto-continuation request with the foreground chat's model.
// Exported for tests.
export function resolveSessionModel(sessionId?: string): string {
  const { model, chats } = useChatStore.getState();
  const chat = sessionId ? chats.find((c) => c.id === sessionId) : undefined;
  return chat?.model ?? model;
}

// Exported for tests.
export function buildCanvasContext(sessionId?: string): object {
  const { selectedIds } = useSelectionStore.getState();
  const { rootIds, nodesById } = useSceneStore.getState();
  const { activeTheme } = useThemeStore.getState();
  const { variables } = useVariableStore.getState();

  const roots = rootIds.map((id) => {
    const n = nodesById[id];
    return n ? { id: n.id, type: n.type, name: n.name } : { id };
  });

  const selectedNodes = selectedIds.map((id) => {
    const n = nodesById[id];
    if (!n) return { id };
    const rec = n as unknown as Record<string, unknown>;
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      x: rec.x,
      y: rec.y,
      width: rec.width,
      height: rec.height,
    };
  });

  // No selected node is ever auto-screenshotted (see useSelectionContext.ts)
  // to save tokens — only its id goes out above in
  // selectedIds/selectedNodes. Tell the model that explicitly, but only when
  // it's actually relevant: a constant string, not derived from selection
  // data, so it doesn't churn the request when nothing in the selection
  // would trigger it.
  const hasSelection = selectedIds.some((id) => nodesById[id]);
  // get_screenshot may not be in the model's toolset at all (the backend
  // drops it for a vision-less model with no VISION_MODEL configured — see
  // the root CLAUDE.md's "Agent vision" section) — canSendImages() mirrors
  // that exact condition on the frontend. Pointing the model at a tool it
  // doesn't have would just waste a turn.
  const model = resolveSessionModel(sessionId);
  const selectionHint = hasSelection && canSendImages(model)
    ? "Screenshots of the selected nodes are intentionally NOT attached. If you need to see one, call get_screenshot with its node id."
    : null;

  // A repo pushed in over WebMCP (attach_local_repo) otherwise silently
  // changes what read_design_repo/read_repo_files answer with no signal to
  // the model that it should reach for them — this is the only thing that
  // tells it a local repo exists at all. Name + counts only, never file
  // contents or the tree itself: this is rebuilt every request (including
  // every tool-loop auto-continuation) and appended as a trailing user
  // message, so it must stay tiny and it must never carry anything that
  // would belong in the system prompt instead (see the root CLAUDE.md's
  // prompt-cache invariants). Omitted entirely when nothing is attached, so
  // a fresh session's canvasContext is byte-identical to before this
  // existed.
  const repoContextState = useRepoContextStore.getState();
  const localRepo = repoContextState.isAttached()
    ? {
        name: repoContextState.name,
        fileCount: repoContextState.filesByPath.size,
        treeSize: repoContextState.tree.length,
      }
    : null;

  // Element the user pointed at inside an embed via the element picker
  // (auto-started whenever an embed is the sole selection — see
  // useEmbedPickerLifecycle). Only forwarded while the
  // embed it belongs to still exists in the scene — a stale embedId (node
  // deleted) is otherwise cleared by useEmbedPickerLifecycle, but this is a
  // last-line guard against sending a dangling reference to the agent.
  const pickerSelection = useEmbedPickerStore.getState().selection;
  const selectedEmbedElement =
    pickerSelection && nodesById[pickerSelection.embedId]
      ? {
          ...pickerSelection,
          hint:
            `The user pointed at this element inside embed ${pickerSelection.embedId}. ` +
            "Locate it with read_embed_html (mode 'grep') to get a byte-exact anchor before " +
            "calling edit_embed_html — this outerHtml comes from the rendered DOM and may " +
            "differ from the stored source.",
        }
      : undefined;

  return {
    canvasContext: JSON.stringify({
      roots,
      selectedIds,
      selectedNodes,
      activeTheme,
      variables: variables.map((v) => ({
        name: v.name,
        type: v.type,
        value: v.value,
        themeValues: v.themeValues,
        // The name to reference from CSS/embed HTML (`var(--x)`) — `name`
        // itself may be a free-form label like "Color 1" that is not valid
        // CSS. Appended last, not inserted earlier, so this payload's shape
        // for existing fields stays byte-identical and doesn't invalidate
        // the prompt cache for callers that only read the earlier keys.
        cssName: getVariableCssName(v),
      })),
      ...(selectionHint ? { selectionHint } : {}),
      ...(selectedEmbedElement ? { selectedEmbedElement } : {}),
      ...(localRepo ? { localRepo } : {}),
    }),
    model,
    userId: getUserId(),
    clientCapabilities: CLIENT_CAPABILITIES,
  };
}

// Coarse, PII-free categorization of a tool failure for analytics. Never the
// raw error message — that can contain user content (file names, prompt
// fragments echoed back by a handler, etc.).
function classifyToolError(err: unknown): string {
  if (err instanceof Error && err.message === "Tool call timed out") {
    return "timeout";
  }
  return "handler_error";
}

// Default budget for a tool call before we give up and report a timeout to
// the model. Per-tool overrides live in TOOL_CALL_TIMEOUT_MS_OVERRIDES below.
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30_000;

// Image generation can legitimately run close to the backend's own ceiling
// (IMAGE_GENERATION_TIMEOUT_MS = 90_000 in pen-editor-backend/src/config.ts).
// 95s is deliberately just above that: it lets the backend's clean 504 win
// the race instead of this client cutting the call off first and reporting
// a misleading "Tool call timed out" while the server keeps working (and
// paying for it) in the background.
const TOOL_CALL_TIMEOUT_MS_OVERRIDES: Record<string, number> = {
  generate_image: 95_000,
  generate_frame_image: 95_000,
  // remove-background/vectorize call out to their own upstream provider and
  // can run well past the default budget; 60s is generous headroom without
  // matching generate_image's 95s (these aren't racing a comparable backend
  // ceiling documented anywhere yet).
  remove_background: 60_000,
  vectorize_image: 60_000,
  // browse_task (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-
  // design.md §3) runs a whole snapshot/step/perform loop internally bounded
  // by its own BROWSE_TASK_DEADLINE_MS = 90_000. That would not fit under
  // the 30s default — this client-side timeout would fire and report a
  // misleading "Tool call timed out" while the loop kept running underneath
  // it. 100s gives the loop's own deadline room to win the race and return
  // a normal transcript instead.
  browse_task: 100_000,
  // browse_act (docs/superpowers/specs/2026-09-23-full-browser-use-design.md,
  // "act gains actions and index targeting"). Two worst cases, and this
  // must cover both:
  //   - Plain act (index/target, no `element`): the desktop shell's own
  //     BROWSER_COMMAND_TIMEOUT_MS = 20s bounds every command, including
  //     `wait`'s hard cap of 15s (`wait` polls WITHIN that same 20s command
  //     budget, not on top of it). 15s + 5s margin lands on that same 20s —
  //     this override must be at least that.
  //   - The `element` natural-language targeting path (same design doc's
  //     follow-up) does three things in sequence before the model sees a
  //     result: (1) browser.snapshot() — up to the desktop's 20s command
  //     budget; (2) an /api/browse/locate round trip — bounded by shared.ts's
  //     BROWSE_BACKEND_REQUEST_TIMEOUT_MS = 20s, which (per shared.ts's
  //     fetchBrowseBackend) now covers the response body read too, not just
  //     the fetch; (3) the act command itself — the desktop's 20s command
  //     budget plus its ~1.5s cursor-move budget (CURSOR_TIMEOUT_MS in
  //     pen-editor-desktop/src/main/browser/controller.ts) for a
  //     click/type/select/hover/press that moves the visible cursor first.
  //     20 + 20 + 21.5 = 61.5s worst case.
  // 65s covers both (61.5s plus ~3.5s margin), while staying comfortably
  // under browse_task's 100s.
  browse_act: 65_000,
  // browse_tabs (same design doc) with `action: "new"` and a `url` reuses
  // browse_open's full ~45s command budget (a fresh navigation can be slow),
  // so it needs the same headroom as browse_open would if browse_open had
  // its own override — 60s leaves margin above that budget.
  browse_tabs: 60_000,
  // generate_vector hands the prompt to QuiverAI's arrow-2, which draws the
  // SVG token by token: measured 20s for a simple icon and ~90s for a
  // detailed illustration, against the backend's own QUIVER_TIMEOUT_MS =
  // 180_000. At the 30s default this fired on almost every real call — the
  // model was told the generation "timed out" and retried it, paying twice,
  // while the first generation had in fact finished and committed its nodes
  // to the canvas. 185s sits just above the backend ceiling so the server's
  // clean 504 wins the race, same reasoning as generate_image above.
  generate_vector: 185_000,
};

function getToolCallTimeoutMs(toolName: string): number {
  return TOOL_CALL_TIMEOUT_MS_OVERRIDES[toolName] ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
}

// The finished message's `metadata` is typed `unknown` (useChat isn't given
// a messageMetadataSchema) — this is the sole place that trusts its shape.
// `contextTokens` is the backend's actual input-token count for the turn's
// last step (see chat.ts's `finish` chunk); a non-positive or missing value
// means "nothing to report" rather than a real reading of zero context use.
// Exported for tests.
export function extractContextTokens(metadata: unknown): number | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const { contextTokens } = metadata as { contextTokens?: unknown };
  return typeof contextTokens === "number" && contextTokens > 0
    ? contextTokens
    : undefined;
}

// Exported for tests. `source` distinguishes the chat UI path from the MCP
// WebSocket/desktop IPC bridge paths (`src/lib/mcpDispatch.ts`), which all
// funnel through this single choke point but can't otherwise be told apart
// from inside it — callers must say which they are. Defaults to "bridge"
// since `onToolCall` below is the one call site that passes "chat"
// explicitly; every other caller is a bridge.
export async function executeToolCall(
  toolName: string,
  input: unknown,
  context?: ToolExecutionContext,
  source: "chat" | "bridge" | "webmcp" = "bridge"
): Promise<string> {
  const startedAt = performance.now();
  const handler = toolHandlers[toolName];
  if (!handler) {
    track("agent_tool_executed", {
      tool_name: toolName,
      ok: false,
      duration_ms: Math.round(performance.now() - startedAt),
      error_kind: "unknown_tool",
      source,
    });
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
  const args =
    input != null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  try {
    // Serialized here, at the funnel, rather than at each call site: chat,
    // both MCP bridges and the WebMCP surface all arrive through this
    // function, so this is the one place where "two agents cannot interleave
    // scene mutations" can be true by construction instead of by convention.
    // Read-only tools are not queued (see toolCallQueue.ts).
    //
    // The timeout starts inside the queued task, not around it: a call that
    // waited behind a long batch_design must still get its full budget once
    // it actually starts, or a busy editor would time out calls that never
    // ran.
    const result = await runToolCall(toolName, () =>
      Promise.race([
        handler(args, context),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Tool call timed out")),
            getToolCallTimeoutMs(toolName)
          )
        ),
      ])
    );
    // Handlers report failure as a JSON `{"error": ...}` string rather than
    // throwing; detect that shape so `ok` reflects the real outcome. Cheap
    // string check instead of `JSON.parse`-ing every result: some results
    // (get_screenshot's base64 imageData, export_layers_svg, batch_get) can
    // be hundreds of KB to several MB, and a full parse just to read one
    // boolean is a synchronous main-thread cost the analytics layer must
    // never impose. `executeToolCall`'s own error branches always produce
    // exactly `{"error": ...}` (see below and the catch block), so a plain
    // prefix check is sufficient and never a false negative for the shape
    // this function itself produces.
    const ok = !result.startsWith('{"error"');
    track("agent_tool_executed", {
      tool_name: toolName,
      ok,
      duration_ms: Math.round(performance.now() - startedAt),
      ...(ok ? {} : { error_kind: "handler_error" }),
      source,
    });
    return result;
  } catch (err) {
    track("agent_tool_executed", {
      tool_name: toolName,
      ok: false,
      duration_ms: Math.round(performance.now() - startedAt),
      error_kind: classifyToolError(err),
      source,
    });
    return JSON.stringify({
      error: err instanceof Error ? err.message : "Tool call failed",
    });
  }
}

interface UseDesignChatOptions {
  sessionId: string;
}

function cloneLaunchPayload(payload: ChatLaunchPayload): ChatLaunchPayload {
  return {
    text: payload.text,
    images: payload.images?.map((image) => ({ ...image })),
  };
}

// One instance: the offline error carries no per-attempt information, and a
// stable identity keeps it from re-rendering consumers that memo on `error`.
const OFFLINE_SEND_ERROR = new Error(OFFLINE_MESSAGE);

export function useDesignChat({ sessionId }: UseDesignChatOptions) {
  const [input, setInput] = useState("");
  // Set when a send is refused because the browser is offline. The error
  // itself is DERIVED from this plus live connectivity (see `offlineError`
  // below) rather than stored: an "you are offline" banner is stale the
  // moment the connection is back, so nothing has to clear it — in
  // particular the queued-message drain effect doesn't, which is what keeps
  // that effect free of setState.
  const [offlineSendRefused, setOfflineSendRefused] = useState(false);

  // Non-null while the transport is auto-retrying a network failure; drives
  // the neutral "retrying…" status line instead of the red error banner.
  const [retryState, setRetryState] = useState<RetryState | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: resolveChatApiUrl(),
        // withMobbinAuthHeader wraps the retrying fetch so the *actual*
        // network call always carries a currently-valid X-Mobbin-Token
        // header (refreshed first if it had expired) or none at all — see
        // its doc comment in mobbinAuth.ts for why the header is set here
        // rather than only in prepareSendMessagesRequest below.
        fetch: withMobbinAuthHeader(
          createRetryingFetch({ onRetryStateChange: setRetryState }),
        ),
        body: () => buildCanvasContext(sessionId),
        prepareSendMessagesRequest: ({ id, messages, body, headers: baseHeaders, trigger, messageId }) => {
          // Images always ride along regardless of the selected model's
          // vision support — the backend decides native-vs-described per
          // model
          // (pen-editor-backend/src/ai/vision-messages.ts) and never
          // forwards raw image parts to a model that can't read them. See
          // pen-editor-backend/docs/specs/2026-08-14-agent-vision-design.md.
          //
          // The OpenCode key is attached HERE, not baked into the transport
          // at construction (see the `useMemo` comment above — the
          // transport is built once per mounted session): this function is
          // re-evaluated on every send, including every tool-loop
          // auto-continuation, so a key entered mid-session is picked up on
          // the very next request. It rides as a header, never in `body` —
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
      }),
    // Built once per mounted session: the model (and everything else in the
    // body) is read fresh from the stores on every send, keyed by this
    // session's own id.
    [sessionId]
  );

  const setContextTokens = useChatStore((s) => s.setContextTokens);

  const chat = useChat({
    id: sessionId,
    transport,
    // AI SDK otherwise publishes a React update for every stream chunk. A
    // short throttle keeps active Markdown rendering responsive while still
    // feeling continuous, especially when multiple sessions run in parallel.
    experimental_throttle: STREAM_RENDER_THROTTLE_MS,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // Feeds ContextMeter (components/chat/ContextMeter.tsx). This session's
    // OWN id, not the active chat — a background session finishing a turn
    // must update its own reading, never whatever chat the user happens to
    // be looking at (same reasoning as resolveSessionModel above).
    onFinish: ({ message }) => {
      const contextTokens = extractContextTokens(message.metadata);
      if (contextTokens !== undefined) {
        setContextTokens(sessionId, contextTokens);
      }
    },
    onToolCall: async ({ toolCall }) => {
      // ask_user is answered by the in-chat form (AskUserForm), which calls
      // addToolOutput on submit. Leaving the part unresolved keeps the turn
      // paused (sendAutomaticallyWhen only fires once every tool call has an
      // output), which is exactly the desired human-in-the-loop behavior.
      if (toolCall.toolName === "ask_user") {
        return;
      }
      const result = await executeToolCall(
        toolCall.toolName,
        toolCall.input,
        { sessionId, toolCallId: toolCall.toolCallId },
        "chat"
      );
      chat.addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result,
      });
      // Record that this streaming-tool call's handler actually ran (see
      // `completedStreamingCallKeysRef` below) — the "ready" sweep effect
      // uses this, not part state, to tell "handler resolved" apart from
      // "handler never got to run". `completedStreamingCallKeysRef` is
      // declared further down in this function body, but that's fine: this
      // closure isn't invoked until the AI SDK calls back into it, by which
      // time every hook in this render has already run and the ref exists.
      if (streamingToolNames.has(toolCall.toolName)) {
        completedStreamingCallKeysRef.current.add(
          streamingToolKey(toolCall.toolName, toolCall.toolCallId)
        );
      }
    },
  });

  // Drives re-running the queued-payload effect below once connectivity
  // returns (see the effect for why offline must not consume the queue).
  const isOnline = useOnlineStatus();

  // Register/unregister abort capability for this session
  const registerAbortController = useChatStore((s) => s.registerAbortController);
  const unregisterAbortController = useChatStore((s) => s.unregisterAbortController);
  const consumeLaunchPayload = useChatStore((s) => s.consumeLaunchPayload);
  const enqueueMessage = useChatStore((s) => s.enqueueMessage);
  const peekNextMessage = useChatStore((s) => s.peekNextMessage);
  const removeQueuedMessageAction = useChatStore((s) => s.removeQueuedMessage);
  const queuedMessages = useChatStore(
    (s) => s.messageQueue[sessionId] ?? NO_QUEUED_MESSAGES,
  );
  const removeQueuedMessage = useCallback(
    (id: string) => removeQueuedMessageAction(sessionId, id),
    [removeQueuedMessageAction, sessionId],
  );
  // True while an ask_user question is unanswered — the auto-send effect below
  // must not dequeue the next message on top of a paused turn awaiting a form
  // answer (the composer itself is also disabled for typing/submitting while
  // this is true, via ChatInput's `awaitingAnswer` prop).
  const awaitingAnswer = hasPendingAskUser(chat.messages);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Every `${toolName}:${toolCallId}` this session has ever staged a
  // streaming frame for (across every registered streaming-tool adapter,
  // src/lib/streamingTools/), and the subset that were abandoned
  // (stop/error/unmount) rather than completed. AI SDK v6 deliberately keeps
  // the partial assistant message — and its still-`input-streaming` tool
  // part — in `chat.messages` after `Chat.stop()`/an aborted request (that's
  // what `ignoreIncompleteToolCalls` in `convertToModelMessages` exists for).
  // `clearStreamingToolSession` wipes each adapter's own per-session state
  // (drafts, in-progress mutations, `finalizedKeys`, ...) on those terminal
  // paths, so without a separate, never-cleared record here, the staging
  // effect below would re-dispatch a frame for that abandoned call the
  // moment `chat.messages` next changes (e.g. sending a follow-up message).
  // A ref Set, not store state, because it must survive exactly the clears
  // that wipe each adapter's own store.
  const seenStreamingCallsRef = useRef<Map<string, { toolName: string; toolCallId: string }>>(
    new Map()
  );
  const abandonedStreamingToolKeysRef = useRef<Set<string>>(new Set());

  // Every `${toolName}:${toolCallId}` whose handler actually ran to
  // completion (the `onToolCall` branch above resolved and delivered
  // `addToolOutput`). This is deliberately NOT derived from a tool part's
  // `state` in `chat.messages` — see the "ready" sweep effect below for why
  // that would be unreliable for the one case it exists to catch (a
  // validation failure never invokes `onToolCall` at all, yet still reaches
  // `state: "output-available"`'s sibling terminal state before this hook
  // gets a chance to look). A ref, not store state: it only gates the sweep
  // effect's own read, so it never needs to trigger a re-render.
  const completedStreamingCallKeysRef = useRef<Set<string>>(new Set());

  function streamingToolKey(toolName: string, toolCallId: string): string {
    return `${toolName}:${toolCallId}`;
  }

  // Every streaming-tool adapter's per-session state (transient previews,
  // in-flight progressive mutations, ...) must never outlive this session on
  // any terminal path except an ordinary "ready" — the final tool handler
  // owns commit-before-clear on success, and a paused ask_user turn is not a
  // terminal path at all. Each adapter's `onSessionClear` only touches THIS
  // session, so concurrent sessions are unaffected.
  const clearStreamingToolSession = useCallback(() => {
    for (const [key, call] of seenStreamingCallsRef.current) {
      if (abandonedStreamingToolKeysRef.current.has(key)) continue;
      abandonedStreamingToolKeysRef.current.add(key);
      getStreamingToolAdapter(call.toolName)?.onAbandon({
        sessionId,
        toolCallId: call.toolCallId,
      });
    }
    for (const adapter of streamingToolAdapters) {
      adapter.onSessionClear(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    // Create an AbortController that calls chat.stop() when aborted
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const onAbort = () => {
      clearStreamingToolSession();
      chat.stop();
    };
    controller.signal.addEventListener("abort", onAbort);

    registerAbortController(sessionId, controller);

    return () => {
      controller.signal.removeEventListener("abort", onAbort);
      unregisterAbortController(sessionId);
      // Unmount cleanup: nothing else observes this session's streaming-tool
      // state once the hook is gone, so clear it here too.
      clearStreamingToolSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, registerAbortController, unregisterAbortController]);

  // Observe partial tool input as it streams in and dispatch it to whichever
  // registered adapter (src/lib/streamingTools/) owns that tool name.
  // Complete, validated final input (delivered via the tool handler in
  // onToolCall above) remains the sole barrier for a tool's "real" effect —
  // a transient preview for `draw_vector`, or a real (but rollback-able)
  // scene mutation for the progressive-mutation adapters — this effect only
  // ever forwards partial frames.
  //
  // Two guards, for two different failure modes of re-scanning the full
  // `chat.messages` array on every update:
  // - `chat.status !== "streaming"`: staging is only ever meaningful while a
  //   turn is actively in flight, so skip entirely otherwise (cheap, and
  //   covers most idle re-renders).
  // - `abandonedStreamingToolKeysRef`: the status guard alone is NOT enough —
  //   a stale `input-streaming` part from an abandoned call survives inside
  //   `chat.messages` (see the ref's declaration above) and `chat.status` is
  //   "streaming" again the moment a follow-up message is sent, so the same
  //   stale part would otherwise pass the status guard and get re-dispatched.
  //   Once a key is recorded as abandoned it is blocked permanently.
  useEffect(() => {
    if (chat.status !== "streaming") {
      return;
    }
    for (const streamed of extractStreamingToolInputs(
      chat.messages,
      streamingToolNames
    )) {
      const key = streamingToolKey(streamed.toolName, streamed.toolCallId);
      if (abandonedStreamingToolKeysRef.current.has(key)) {
        continue;
      }
      seenStreamingCallsRef.current.set(key, {
        toolName: streamed.toolName,
        toolCallId: streamed.toolCallId,
      });
      getStreamingToolAdapter(streamed.toolName)?.onFrame({
        sessionId,
        toolCallId: streamed.toolCallId,
        input: streamed.input,
      });
    }
  }, [chat.messages, chat.status, sessionId]);

  // A failed request is a terminal path for this turn — any in-flight
  // streaming-tool state belongs to a call that will never complete, so it
  // must not linger. An ask_user pause is a distinct, non-error chat.status
  // and is intentionally excluded from this effect.
  useEffect(() => {
    if (chat.status === "error") {
      clearStreamingToolSession();
      // Coarse categorization only — never chat.error.message itself, which
      // can echo back request/response content.
      const message = chat.error?.message;
      const errorKind =
        message === OFFLINE_MESSAGE
          ? "offline"
          : chat.error instanceof TypeError
            ? "network"
            : "unknown";
      track("agent_turn_failed", { error_kind: errorKind });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, clearStreamingToolSession]);

  // A "ready" transition is the other terminal path for a streaming-tool
  // call, alongside abort/error/unmount above — and it is the ONLY signal
  // for two provider failure modes that never touch `chat.status ===
  // "error"` at all (see the HIGH finding in
  // docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md):
  //
  // - A truncated turn: the provider stops streaming mid-call, so the tool
  //   part is stuck at `state: "input-streaming"` forever. `onToolCall` is
  //   only invoked from the SDK's "tool-input-available" branch (see
  //   node_modules/ai/dist/index.mjs, the `case "tool-input-available":`
  //   block awaiting `onToolCall`), so it never fires here either.
  //   `lastAssistantMessageIsCompleteWithToolCalls` (same file, `every` over
  //   `state === "output-available" || state === "output-error"`) treats an
  //   `input-streaming` part as incomplete, so the SDK never auto-continues
  //   — the turn just settles into "ready" for good, with the call
  //   abandoned by the model.
  // - A tool-input validation failure (e.g. the backend's zod
  //   `.transform()` rejecting the final `batch_design` args under the
  //   embed-only prototype policy): the SDK's `case "tool-input-error":`
  //   branch (same file) flips the part straight to `state: "output-error"`
  //   WITHOUT ever calling `onToolCall` — that callback lives only in the
  //   sibling "tool-input-available" case. `output-error` DOES count as
  //   "complete" for `lastAssistantMessageIsCompleteWithToolCalls`, so this
  //   path is usually transient (the SDK auto-continues with the error as
  //   the tool result) — but `chat.status` still passes through "ready" once
  //   on the way, which is all this effect needs.
  //
  // Both leave `seenStreamingCallsRef` holding a call whose handler never
  // ran — so `completedStreamingCallKeysRef` (set only from inside the
  // `onToolCall` branch above) never gained its key — while progressive
  // mutations may already be committed to the scene with no undo entry
  // (streaming never calls `saveHistory`). Sweep every such call on every
  // "ready" transition and abandon it (roll back / restore original HTML),
  // exactly like the abort/error/unmount paths.
  //
  // This can NEVER misfire on a call that is merely between
  // "tool-input-available" and its handler resolving: the stream reader
  // above `await`s `onToolCall` synchronously, in place, before it advances
  // to any later chunk — so `chat.status` cannot reach "ready" while a
  // handler is still in flight. By the time "ready" is observed, every call
  // that ever reached "tool-input-available" has either completed (recorded
  // in `completedStreamingCallKeysRef`) or errored out (never recorded, and
  // correctly swept here).
  useEffect(() => {
    if (chat.status !== "ready") {
      return;
    }
    for (const [key, call] of seenStreamingCallsRef.current) {
      if (abandonedStreamingToolKeysRef.current.has(key)) continue;
      if (completedStreamingCallKeysRef.current.has(key)) continue;
      abandonedStreamingToolKeysRef.current.add(key);
      getStreamingToolAdapter(call.toolName)?.onAbandon({
        sessionId,
        toolCallId: call.toolCallId,
      });
    }
  }, [chat.status, chat.messages, sessionId]);

  // Hands a payload to the transport. Writes no React state of its own, so
  // the queue-drain effect below can call it directly without triggering a
  // cascading render (react-hooks/set-state-in-effect). Callers are
  // responsible for the preconditions `sendPayload` checks: connectivity and
  // a chat that is actually ready to take a message.
  const deliverPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && (!images || images.length === 0)) {
        return false;
      }

      track("chat_message_sent", {
        has_attachment: !!images && images.length > 0,
        is_slash_command: text.startsWith("/"),
        length_bucket: bucketLength(text.length),
      });
      const { msSinceOpen, isFirst } = consumeFirstPromptTiming();
      if (isFirst) {
        track("first_prompt_sent", { ms_since_open: Math.round(msSinceOpen) });
      }

      if (images && images.length > 0) {
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [];
        for (const img of images) {
          const mediaType = img.dataUrl.match(/^data:(image\/[^;]+);/)?.[1] ?? "image/png";
          parts.push({ type: "file", mediaType, url: img.dataUrl });
        }
        if (text) {
          parts.push({ type: "text", text });
        }
        chat.sendMessage({ parts });
      } else {
        chat.sendMessage({ text });
      }
      return true;
    },
    [chat]
  );

  const sendPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && (!images || images.length === 0)) {
        return false;
      }
      // Fail fast and locally instead of issuing a request that will hang or
      // reject once the browser notices it has no connection.
      if (isOffline()) {
        setOfflineSendRefused(true);
        return false;
      }
      // A failed request leaves the chat in "error" status; clear it so the
      // user can retry instead of the chat being stuck.
      if (chat.status === "error") {
        chat.clearError();
      } else if (chat.status === "submitted" || chat.status === "streaming") {
        // The agent is busy — queue instead of dropping the message. The
        // caller (ChatInput) treats a `true` return as "accepted" and clears
        // the composer, even though nothing was sent to the network yet.
        enqueueMessage(sessionId, payload);
        return true;
      } else if (chat.status !== "ready") {
        return false;
      }
      return deliverPayload(payload);
    },
    [chat, deliverPayload, enqueueMessage, sessionId]
  );

  // Drains, at most once per "ready" transition, either the one-shot
  // launchQueue (a parallel-tab fan-out payload) or — with lower priority —
  // the user-facing messageQueue (messages submitted via Enter while the
  // agent was busy). Both live in the same effect, with an early `return`
  // right after the launchQueue send, so the two can never both fire a send
  // in the same tick: if a launch payload was pending, it wins and the
  // messageQueue isn't even inspected until the next "ready" transition
  // (which the send itself will eventually cause, once the follow-up
  // request settles).
  useEffect(() => {
    if (chat.status !== "ready" || !isOnline || isOffline()) {
      // Consuming while offline would delete the queued payload from the
      // store without ever sending it (sendPayload's offline guard rejects
      // it), destroying a parallel-tab launch permanently. Leave it queued;
      // the isOnline dependency reruns this effect once connectivity
      // returns, at which point it's consumed and sent normally.
      //
      // The extra live `isOffline()` check guards the narrow race where the
      // isOnline *state* is still stale-true (the browser's "offline" event
      // hasn't landed yet) but connectivity is already gone: bail here,
      // before any consume/send, so a payload is never handed to the
      // transport for a connection that is already down.
      return;
    }

    const queuedPayload = consumeLaunchPayload(sessionId);
    if (queuedPayload) {
      // `deliverPayload`, not `sendPayload`: every precondition sendPayload
      // would re-check (online, status === "ready", non-empty) is already
      // established above, and going straight to the transport keeps this
      // effect from writing React state.
      deliverPayload(cloneLaunchPayload(queuedPayload));
      return;
    }

    if (awaitingAnswer) {
      // Don't dequeue on top of a turn paused for an ask_user answer.
      return;
    }

    // Guard against a narrow race: answering an ask_user question via
    // addToolOutput synchronously flips its tool part to "output-available"
    // (so `awaitingAnswer` above already reads false), but the SDK's own
    // automatic-continuation effect only flips chat.status away from "ready"
    // in a later microtask. In that window this effect could otherwise fire
    // a queued send at the same moment the SDK auto-continues the turn,
    // producing two overlapping requests.
    // `lastAssistantMessageIsCompleteWithToolCalls` returns true exactly when
    // the SDK is about to auto-send (last assistant message's last step has
    // one or more non-provider-executed tool calls and all are resolved) —
    // that's the same predicate `sendAutomaticallyWhen` uses above. When it's
    // false — no tool calls in the last step (an ordinary finished turn) or a
    // tool call still unresolved — the SDK will not auto-continue, so it's
    // safe to drain a queued message here. Skipping this tick when it's true
    // is not a lost send: once the SDK's follow-up request settles, status
    // returns to "ready" and reruns this effect with the predicate now false.
    if (lastAssistantMessageIsCompleteWithToolCalls({ messages: chat.messages })) {
      return;
    }

    const next = peekNextMessage(sessionId);
    if (!next) {
      return;
    }

    const sent = deliverPayload(cloneLaunchPayload(next.payload));
    if (sent) {
      // Only drop it from the queue once it's actually been handed off —
      // sendPayload can return false (offline race, re-entered "busy" state,
      // etc.), and dropping the item unconditionally on a peek would lose the
      // message forever. Leaving it queued on failure keeps FIFO order intact
      // and gets it retried on the next "ready" transition.
      removeQueuedMessage(next.id);
    }
  }, [
    chat.status,
    chat.messages,
    isOnline,
    awaitingAnswer,
    consumeLaunchPayload,
    peekNextMessage,
    removeQueuedMessage,
    deliverPayload,
    sessionId,
  ]);

  const sendMessage = useCallback((): boolean => {
    const didSend = sendPayload({ text: input.trim() });
    if (didSend) {
      setInput("");
    }
    return didSend;
  }, [input, sendPayload]);

  const submitLaunchPayload = useCallback(
    (payload: ChatLaunchPayload): boolean => {
      const didSend = sendPayload(payload);
      if (didSend && payload.text.trim() === input.trim()) {
        setInput("");
      }
      return didSend;
    },
    [input, sendPayload]
  );

  const clearError = useCallback(() => {
    setOfflineSendRefused(false);
    chat.clearError();
  }, [chat]);

  // Wraps chat.stop() so a user-initiated stop clears this session's
  // in-flight streaming-tool state first — otherwise a stale preview or
  // partially-applied mutation would keep rendering after the stream that
  // produced it was cancelled.
  const stop = useCallback(() => {
    clearStreamingToolSession();
    chat.stop();
  }, [chat, clearStreamingToolSession]);

  // Derived, not stored: the offline banner is exactly "a send was refused
  // and we are still offline". Coming back online retires it on its own, so
  // no send path — user-facing or the queue drain — has to clear it.
  const offlineError =
    offlineSendRefused && !isOnline ? OFFLINE_SEND_ERROR : undefined;

  return {
    messages: chat.messages,
    input,
    setInput,
    sendMessage,
    submitLaunchPayload,
    status: chat.status,
    isLoading: chat.status === "submitted" || chat.status === "streaming",
    stop,
    error: offlineError ?? chat.error,
    clearError,
    setMessages: chat.setMessages,
    retryState,
    addToolOutput: chat.addToolOutput,
    queuedMessages,
    removeQueuedMessage,
  };
}
