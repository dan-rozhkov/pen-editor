# Canvas link: agent panel ↔ canvas tab (desktop agent layout)

Status: protocol for the desktop agent layout (flag `PEN_DESKTOP_AGENT_LAYOUT=1`).
Types: `src/lib/canvasLink/protocol.ts` (pen-editor). Measured basis:
`docs/spike-ipc-streaming-report.md` on branch `spike/ipc-streaming`.

## Roles

- **Agent panel** — the `/agent` route in the left `WebContentsView`. It runs the
  chat (`useDesignChat`) and has NO scene (it has a browser bridge, see Tool placement). Preload: `window.penAgentPanel`
  (`version: 2`, `canvas: AgentPanelCanvasBridge`).
- **Canvas tab** — an editor tab loaded as `/app?chat=off`. It owns one document
  and executes canvas tools. Preload: `window.penDesktop.canvasHost`
  (`CanvasHostBridge`). It calls `register()` once, only in chatless mode.
- **Tool placement** (`src/lib/canvasLink/canvasTools.ts`) — the panel has NO
  scene but HAS its own browser bridge (`window.penAgentPanel.browser`, the same
  `BrowserBridge` shape as `window.penDesktop.browser`). It runs `ask_user`,
  `analyze_image`, `get_guidelines`, `get_style_guide`, `get_style_guide_tags` and
  ALL `browse_*` / `qa_*` tools itself. EVERY other client tool runs in the bound
  canvas tab. A canvas tab is bound or opened only when a tool needs the scene,
  including the `place-node` step of browser tools.
- **Main process** — routes only. It never interprets tool payloads. It knows
  the registered canvas tabs and the one panel per window.

## Binding (chat side)

Each chat is bound to one canvas tab (`tabId`), kept on the chat side. On the
first canvas tool of a turn with no live binding:
1. exactly one canvas tab → bind it;
2. several → the first in the list (the most recently active canvas tab), even if a browser tab is currently active;
3. none → `openTab()` and bind the new tab with the `{ tabId, registrationId }` it resolves with (never look the registration up in the tab list: it may not have announced the new tab yet).
`listTabs()` is ordered most recently active canvas tab first; each
`CanvasTabInfo` has a `registrationId` that increments every time the tab
registers (a reloaded tab keeps its `tabId`, gets a new `registrationId`).
A `tab-gone` (it carries `registrationId`) for the bound registration clears the binding (latch, see below) AND the chat's remembered `canvasContext` (the closed document's context is never sent again).
A main `error` for a `call`/`context-request` whose bound tab is no longer in the tab list latches that registration the same way, so the next call rebinds.
Binds of one chat are serialized. Only the implicit bind (a canvas tool frame) reuses a binding another bind just made, so `open_canvas_tab` plus a frame open one tab; an explicit bind honors its own target: `open_canvas_tab` "new" always opens a fresh tab (two parallel "new" open two), and `bindTo` (`launch`) yields exactly the sending tab or nothing.
**Passive bind for context:** a chat with no live binding, asked for its `canvasContext`, binds to the first registered canvas tab WITHOUT opening one, so the first message of a new chat already carries that tab's context. With no canvas tab it stays unbound.

## Channels (desktop)

| Channel | Direction | Payload |
|---|---|---|
| `canvas:list` | panel → main, invoke | → `CanvasTabInfo[]` (this window's registered canvas tabs) |
| `canvas:open` | panel → main, invoke | `{activate?}` → `{tabId, registrationId}` after the new tab called `register()` (timeout 20 s → reject) |
| `canvas:activate` | panel → main | `tabId` |
| `canvas:to-tab` | panel → main | `{tabId, env}` |
| `canvas:from-tab` | main → panel | `{tabId, env}` (from a canvas tab, or main's `error` / `tab-gone`) |
| `canvas:tabs` | main → panel | `CanvasTabInfo[]` on any change (register, close, title, activation) |
| `canvas:register` | tab → main | none; sender must be an editor tab of this window |
| `canvas:unregister` | tab → main | none; main treats it like `tab-gone` for the tab's current registration (the tab host stopped: SPA navigation away from the editor, or the shared viewer took over) |
| `canvas:to-panel` | tab → main | `env` (main adds the sender's `tabId`) |
| `canvas:from-panel` | main → tab | `env` |
| `canvas:from-panel` (main-made) | main → every registered tab | `{kind:"panel-gone"}` when the agent panel reloads or crashes (see Messages) |

Sender checks: `canvas:*` from the panel only from that window's panel view;
from tabs only from registered editor tabs (same pattern as `mcp:register`).
`canvas:to-tab` to an unknown or unregistered `tabId` → main sends
`{kind:"error", refId: env.id}` back to the panel. A registered tab that is
destroyed, navigates (main-frame reload) or whose renderer dies → main sends
`tab-gone` for it and removes it from the list. Order per sender is kept; no
batching.

## Messages

See `protocol.ts`. Rules:

- **Streaming** uses `format: "append"` (only the growth of one string field);
  `"full"` for the first update and as the answer to a `resync`. Measured: 25 KB
  stream = 48 KB over IPC (full JSON: 1.5 MB); 1 MB = 1.2 MB (full: 309 MB).
  Per-message latency p50 0.3 ms; node timing equal to local apply.
- **`call`** carries `timeoutMs` (the chat side's per-tool budget); the canvas
  runs it through `executeToolCall` with that budget (one timeout mechanism; it
  starts inside the serial tool queue, so queue wait is not charged) and answers
  `result`. A call cancelled or timed out before its queued task starts never
  runs. The optional `brief` (the user's request text) is set only for
  `batch_design`/`edit_embed_html`: after the handler the tab runs the Jev taste
  check on the embeds the call touched (fail-open; the call's abort signal) and
  returns the result with the feedback merged. The chat side then waits an extra
  9 s (`TASTE_CHECK_MARGIN_MS`). A `callId` that is still running is ignored if sent again; exactly one
  `result` is posted per `callId`.
  The chat side waits `timeoutMs + 2 s` so the canvas's own timeout error wins.
- **`started`** (canvas → chat, `{callId}`): posted when the queued task actually
  starts the handler (not for a call aborted or refused before that). The chat side
  starts the `timeoutMs + 2 s` timer on `started`, so a call queued behind a long
  one is not timed out while it waits. Before `started` only a safety net applies
  (`PRE_START_TIMEOUT_MS`, 10 min) that frees a chat whose tab went silent; abort
  and `tab-gone` always cancel. A `call` that ends without its handler running
  (aborted while queued, refused, unknown tool) rolls back its streamed progressive
  mutations (the host keeps the stream until the handler starts).
- **`panel-gone`** (main → tab, `{kind:"panel-gone"}`): the agent panel reloaded or
  crashed; main sends it to every registered canvas tab on `canvas:from-panel`. The
  tab aborts every call (queued ones never run), abandons every open stream (rolls
  back) and posts nothing for them. The new panel starts clean.
- **Analytics**: a call that reached the tab is reported once, by the tab's
  `executeToolCall` (`agent_tool_executed`, source `canvas-link`). The panel
  reports only failures that never got the tab's answer, with source `canvas-link`
  and `error_kind` `canvas_link_tab_gone`, `canvas_link_main_error`,
  `canvas_link_timeout` or `canvas_link_bind_failed`.
- **`place-node`** is how a panel-run browser tool writes to the scene.
  `browse_capture`, `browse_screenshot` (`placeOnCanvas`) and `browse_agent`'s
  nested capture call `placeNodeOnCanvas` (src/lib/tools/browser/placeOnCanvas.ts:43;
  call sites browseCapture.ts:50, browseScreenshot.ts:77). In the panel this
  function must be redirected to send `place-node` `{callId, node, options}`
  (node without position; `options` = `{x?, y?, size}`) to the bound canvas tab,
  which runs the real `placeNodeOnCanvas` and answers `result` with
  `{"id","x","y"}` or `{"error":...}`.
- **`launch`** (canvas → chat, `{launchId, payload: {text, images?}}`):
  an on-canvas agent entry point fired in the chatless tab (frame/embed/element
  button, empty-embed composer, comment "Send to agent", the showcase prompt). Entry
  points are shown when `canLaunchAgent()` = chat enabled OR the canvas host runs;
  they call `launchAgentChat`, which posts this (`deliverAgentLaunch`) instead of launching locally.
  Main forwards it untouched. The panel creates a new chat (as every local helper does;
  it only becomes the active chat once the bind worked, so a refused launch never takes
  the user's chat away), binds that chat to the SENDING tab (`bindTo`: its `registrationId`
  is looked up in the tab list, and the result must be exactly that tab), acks, primes the
  tab's context, queues `{text, images}` for the normal auto-send and handles each
  `launchId` once. A local launch does not select a node or put it in the prompt, so
  neither does a remote one; the tab's own selection rides in `canvasContext`.
  The panel answers every launch with `launch-ack`.
- **`launch-ack`** (chat → canvas, `{launchId, error?}`): the launch was handled, or
  (`error`) refused (the sending tab is not listed or its registration is latched; the
  panel then shows nothing). The panel acks as soon as the chat exists and is bound,
  BEFORE it prefetches the tab's context (up to 2 s). The tab waits 8 s
  (`LAUNCH_ACK_TIMEOUT_MS`, enough for a probe plus a bind over a slow IPC): no ack, or an
  error, shows a toast ("The agent panel did not respond.") and the entry point returns false.
  Nothing sent at all (host stopped, or `bridge.post` threw) fails at once with "Could not reach
  the agent panel." The showcase prompt stays in sessionStorage until the ack and an unacked
  launch is retried 3 times, 5 s apart, while the host runs. The panel's client exists from the
  moment `/agent` mounts, so a launch before the first message is received.
- **`selection`** (canvas → chat, `{selection: {nodes: [{nodeId,name,type}], embedElement: {selection, label, embedName} | null}}`):
  what the composer's selection chips show, nothing else (the selection itself still rides in
  `canvasContext`; chips are display-only and carry no message content, so the panel needs no scene
  data for them). The tab computes it with the same pure functions the chip hooks use
  (`computeSelectionItems`, `computeEmbedElementContext`), posts it when the selection, scene (a
  rename) or picked embed element changes, coalesced into one microtask and deduped by content, and
  once right after `register()`. The panel keeps the latest per `tabId` (dropped on that tab's
  `tab-gone`, unless a newer registration already published). A chat's chips read the tab it is
  bound to, else the first listed tab (the passive rule of `canvasContext`).
- **`selection-request`** (chat → canvas): sent once per registration the panel shows chips for and
  has no snapshot of (panel opened or reloaded after the tab, new tab). The tab answers with a
  `selection` even if unchanged. Nothing is sent while no chat input is mounted. There is no
  chat → canvas message to change the selection: the chips have no actions.
- **`cancel`** aborts a running call (the canvas aborts the handler's signal and
  still answers `result` with an error, which the chat side ignores if it
  already resolved).
- **`context-request`** carries the chat's `sessionId` and `model`. The
  `context-response` carries only the SCENE part of `canvasContext` (roots,
  selection, variables, `selectionHint` ...; `buildSceneContext`). The chat-side
  `likedReferences` are not known to the canvas: the panel appends them as the
  LAST key of the object (read from the chat store; with no scene context at all
  the panel sends just `{"likedReferences":[...]}`, or no field when there are none). Byte-stable for unchanged state (prompt cache). The chat
  side prefetches it in the transport `body` provider (async allowed) with a
  2 s timeout; on timeout it sends the chat's last good context, or none rather than a wrong one. After a bind to a new tab (`open_canvas_tab`, `launch`) it prefetches that tab's context once; if that fails the held context is `{}`, so the field (and the system prompt's pointer block) does not flip.
- **`tab-gone` is a latch per registration, not per `tabId`**: the chat side
  immediately fails every pending call for that registration with `{"error":"The canvas tab was closed."}`, abandons its
  open streams and stops forwarding frames for it. (The spike reopened streams
  on the next frame and failed only ~3 s later; that must not happen.) A reloaded
  tab registers again with the same `tabId` and a new `registrationId`; it is
  usable and the latch does not apply to it.
  A stream dropped by the latch (the tool input was still being written) is
  reported to the chat (`onStreamLost`): the chat stops the turn and answers that
  call with the same error; a later `call` for it is never sent to another tab.
- **Stream integrity**: the decoder accepts only `seq` = last + 1 (first message:
  seq 0, "full"); anything else answers `resync` and ignores appends until a
  "full" arrives. While waiting, every ignored append re-sends `resync`, at most
  once per 250 ms per `toolCallId`.
- **Known limitation**: "append" covers only a top-level string field.
  `edit_embed_html`'s nested `edits[].…` growth falls back to "full" on every
  update. Future work.
- **Editability**: a canvas tab hosts everywhere except the shared viewer
  (`/c/:shareId`, `sharedViewStore`): it does not register there, so no read tool
  is published on someone else's shared canvas (no redaction needed). Edit <->
  view/present toggles do NOT stop the host (that would kill a running call);
  while `canMutateScene()` (the one rule WebMCP also uses) is false, any frame,
  `place-node` or mutating `call` is refused with an error result. Mutating =
  every tool not in `UNSERIALIZED_TOOL_NAMES`.
- **Streams**: after `stream-end "complete"` the canvas keeps the tool name until
  the matching `call`; an `"abandoned"` that follows still rolls the stream back.
  On stop the host abandons all such streams and clears the adapters' `"canvas-link"` session.
- **`place-node`** requires an object with a string `type`; a missing `id` is
  generated by the canvas; an `id` that already exists answers `{"error":...}`.
- **Chatless robustness**: `isChatDisabled()` is also true when
  `window.penDesktop?.agentLayout === true` (exposed by the editor-tab preload
  when the agent layout flag is on), so a reload that dropped `?chat=off` stays
  chatless.
