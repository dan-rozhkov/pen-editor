/**
 * Canvas link: the wire protocol between the desktop agent panel (`/agent`,
 * the chat) and a canvas tab (`/app?chat=off`). The chat never touches a
 * scene store of its own: canvas tools, their streaming input and the
 * per-turn `canvasContext` all go through the Electron main process to the
 * canvas tab the chat is bound to. Full description: docs/canvas-link.md.
 *
 * Known limitation: "append" covers only a top-level string field. Growth of
 * a nested value (edit_embed_html's `edits[].…` strings) falls back to
 * "full" on every update. Future work: path-addressed appends.
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

/** chat -> canvas: one update of a streaming tool call's partial input. */
export type StreamMsg =
  | { kind: "stream"; toolCallId: string; toolName: string; seq: number; format: "full"; input: unknown }
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
  | { kind: "call"; callId: string; toolName: string; input: unknown; timeoutMs: number }
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
  | { kind: "context-request"; reqId: string; sessionId: string; model: string };

export type CanvasToChatMsg =
  | { kind: "result"; callId: string; result: string }
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

export type LinkMsg = ChatToCanvasMsg | CanvasToChatMsg | MainToChatMsg;

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
  /** Opens a `/app?chat=off` tab; resolves once it registered as a canvas host. */
  openTab(opts?: { activate?: boolean }): Promise<{ tabId: number }>;
  activateTab(tabId: number): void;
  post(tabId: number, env: LinkEnvelope<ChatToCanvasMsg>): void;
  onMessage(cb: (tabId: number, env: LinkEnvelope<CanvasToChatMsg | MainToChatMsg>) => void): () => void;
  onTabsChanged(cb: (tabs: CanvasTabInfo[]) => void): () => void;
}

/** Preload API of an editor tab: `window.penDesktop.canvasHost`. */
export interface CanvasHostBridge {
  /** Called once by a chatless editor tab: "I am a canvas the panel may drive". */
  register(): void;
  post(env: LinkEnvelope<CanvasToChatMsg>): void;
  onMessage(cb: (env: LinkEnvelope<ChatToCanvasMsg>) => void): () => void;
}
