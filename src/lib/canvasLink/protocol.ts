/**
 * Canvas link: the wire protocol between the desktop agent panel (`/agent`,
 * the chat) and a canvas tab (`/app?chat=off`). The chat never touches a
 * scene store of its own: canvas tools, their streaming input and the
 * per-turn `canvasContext` all go through the Electron main process to the
 * canvas tab the chat is bound to. Full description: docs/canvas-link.md.
 *
 * Stream frame formats: "full" (whole input), "patch" (path-addressed ops: a
 * string that grew by prefix -> `append`, a new key / array element -> `set`;
 * anything else is sent "full") and the older top-level "append", which
 * encoders still use for a grown top-level string and decoders accept.
 *
 * Shared by both sides; keep it free of app imports.
 */

/** Epoch ms with sub-ms precision; stamped by the sender. */
export function linkNow(): number {
  return performance.timeOrigin + performance.now();
}

export interface LinkEnvelope<M extends LinkMsg = LinkMsg> {
  id: string;
  sentAt: number;
  msg: M;
}

export type PatchPath = Array<string | number>;

export type PatchOp =
  /** `offset` = length of the string at `path` the receiver must already hold. */
  | { path: PatchPath; op: "append"; offset: number; text: string }
  /** A new object key or the next array element (index === current length). */
  | { path: PatchPath; op: "set"; value: unknown };

/** chat -> canvas: one update of a streaming tool call's partial input. */
export type StreamMsg =
  | { kind: "stream"; toolCallId: string; toolName: string; seq: number; format: "full"; input: unknown }
  | { kind: "stream"; toolCallId: string; toolName: string; seq: number; format: "patch"; ops: PatchOp[] }
  | {
      kind: "stream";
      toolCallId: string;
      toolName: string;
      seq: number;
      format: "append";
      /** The one top-level string field that grew. */
      field: string;
      /** Length of `field` the receiver must already hold; mismatch -> resync. */
      offset: number;
      append: string;
      /** The other top-level fields, present only when one of them changed. */
      rest?: Record<string, unknown>;
    };

export type ChatToCanvasMsg =
  | StreamMsg
  | { kind: "stream-end"; toolCallId: string; reason: "complete" | "abandoned" }
  | {
      kind: "call";
      callId: string;
      toolName: string;
      input: unknown;
      timeoutMs: number;
      /**
       * The user's request text. Set only for `batch_design`/`edit_embed_html`: the tab then runs the
       * Jev taste check on the embeds the call touched (its touched-embed registry lives in the tab's
       * process) and merges the feedback into the `result`.
       */
      brief?: string;
    }
  | { kind: "cancel"; callId: string }
  /**
   * The one scene write a panel-run browser tool does. The canvas tab calls
   * `placeNodeOnCanvas` (src/lib/tools/browser/placeOnCanvas.ts:43) and answers
   * `result` for `callId` with JSON `{"id","x","y"}` of the new node or
   * `{"error":"..."}`. Its `build` callback cannot cross the wire, so `node` is
   * the node WITHOUT position (the canvas fills `x`/`y`); `options` carries
   * `{x?, y?, size: {width, height}}`.
   */
  | { kind: "place-node"; callId: string; node: unknown; options?: unknown }
  | { kind: "context-request"; reqId: string; sessionId: string; model: string }
  /**
   * The panel handled (no `error`) or refused (`error`) a canvas tab's `launch`. The tab keeps
   * the launch's source (the showcase prompt) until this arrives and, with no ack within a few
   * seconds (`LAUNCH_ACK_TIMEOUT_MS`), tells the user the agent panel did not respond. The panel
   * acks as soon as the chat exists and is bound, before it prefetches that tab's context.
   */
  | { kind: "launch-ack"; launchId: string; error?: string }
  /**
   * The panel has no snapshot of this tab's selection (it just saw the tab, or reloaded): the tab
   * answers with a `selection` message even if nothing changed since its last one.
   */
  | { kind: "selection-request" };

/** What a canvas entry point asks the agent panel to send (`launch`). */
export interface ChatLaunchMessagePayload {
  text: string;
  images?: Array<{ dataUrl: string; name: string }>;
}

/**
 * What the composer's selection chips show (display only; the selection itself rides in
 * `canvasContext`). Same shapes `useSelectionContext` / `useEmbedElementContext` return locally.
 */
export interface SelectionChipsSnapshot {
  nodes: Array<{ nodeId: string; name: string; type: string }>;
  /** Only what the chip shows. */
  embedElement: { label: string; embedName: string; textPreview: string } | null;
}

export type CanvasToChatMsg =
  /**
   * The tab's selection chips changed (coalesced, deduped by content). Posted once right after
   * `register()` and again on a `selection-request`. The panel keeps the latest per tab.
   */
  | { kind: "selection"; selection: SelectionChipsSnapshot }
  /**
   * An on-canvas agent entry point fired in this chatless tab: the panel creates a NEW chat
   * (like every local launch helper), binds it to the sending tab and sends the message. Main
   * forwards it untouched.
   */
  | { kind: "launch"; launchId: string; payload: ChatLaunchMessagePayload }
  | { kind: "result"; callId: string; result: string }
  /**
   * The queued `call` just started its handler (the tab's serial queue reached
   * it). The panel starts the call's `timeoutMs + 2 s` timer here, so time spent
   * queued behind another call is not charged to the budget.
   */
  | { kind: "started"; callId: string }
  /** The receiver lost track of a stream: the next update must be "full". */
  | { kind: "resync"; toolCallId: string }
  | { kind: "context-response"; reqId: string; canvasContext: string };

export type MainToChatMsg =
  /** The envelope `refId` could not be delivered (unknown or unregistered tab). */
  | { kind: "error"; refId: string; error: string }
  /**
   * The canvas tab closed, reloaded or crashed. Latch per registration: nothing
   * more goes to that `registrationId`. A reloaded tab registers again with a
   * new `registrationId` and is usable.
   */
  | { kind: "tab-gone"; registrationId: number };

/**
 * main -> canvas tab, made by main (never by the panel): the agent panel
 * reloaded or crashed (sent to every registered canvas tab on `canvas:from-panel`).
 * Whatever the old panel left behind is orphaned: the tab aborts every call (queued
 * ones never run and roll their streams back), abandons every open stream and posts
 * nothing for them.
 */
export type MainToCanvasMsg = { kind: "panel-gone" };

export type LinkMsg = ChatToCanvasMsg | CanvasToChatMsg | MainToChatMsg | MainToCanvasMsg;

/** `listTabs()` / `onTabsChanged` order: the most recently active canvas tab first. */
export interface CanvasTabInfo {
  tabId: number;
  /** Increments each time the tab registers, including after a reload (same `tabId`). */
  registrationId: number;
  title: string;
  active: boolean;
}

/** Preload API of the agent panel: `window.penAgentPanel.canvas`. */
export interface AgentPanelCanvasBridge {
  listTabs(): Promise<CanvasTabInfo[]>;
  /**
   * Opens a `/app?chat=off` tab; resolves once it registered as a canvas host, with the
   * `registrationId` of that registration (the tab list may not show it yet; bind with this one).
   */
  openTab(opts?: { activate?: boolean }): Promise<{ tabId: number; registrationId: number }>;
  activateTab(tabId: number): void;
  post(tabId: number, env: LinkEnvelope<ChatToCanvasMsg>): void;
  onMessage(cb: (tabId: number, env: LinkEnvelope<CanvasToChatMsg | MainToChatMsg>) => void): () => void;
  onTabsChanged(cb: (tabs: CanvasTabInfo[]) => void): () => void;
}

/** Preload API of an editor tab: `window.penDesktop.canvasHost`. */
export interface CanvasHostBridge {
  /** Called once by a chatless editor tab: "I am a canvas the panel may drive". */
  register(): void;
  /**
   * Called when the host stops (the editor unmounts, e.g. SPA navigation away,
   * or the shared viewer takes over). Main treats it like `tab-gone` for the
   * current registration. Idempotent.
   */
  unregister(): void;
  post(env: LinkEnvelope<CanvasToChatMsg>): void;
  onMessage(cb: (env: LinkEnvelope<ChatToCanvasMsg | MainToCanvasMsg>) => void): () => void;
}
