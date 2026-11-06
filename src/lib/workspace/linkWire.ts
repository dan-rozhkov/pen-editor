// Wire format of the canvas link inside the browser shell (`/workspace`). On the desktop the
// Electron main process routes between the agent panel and the canvas tabs; on the web the shell
// page does, and frames talk to it with `window.postMessage`. Keep this file free of app imports.

import type {
  CanvasTabInfo,
  CanvasToChatMsg,
  ChatToCanvasMsg,
  LinkEnvelope,
  MainToCanvasMsg,
  MainToChatMsg,
} from "@/lib/canvasLink/protocol";

/** Tag on every message, so other `postMessage` traffic on the page is never mistaken for ours. */
export const LINK_WIRE_NS = "sideform.canvas-link.v1";

export type ItemRef =
  | { kind: "doc"; id: string }
  | { kind: "workflow"; id: string }
  | { kind: "settings"; section?: string };

/** Panel frame -> shell. */
export type PanelToShell =
  /** The panel page started (a second one means it reloaded). */
  | { type: "hello" }
  | { type: "list"; rid: string }
  /**
   * `activate: true` (open_canvas_tab) always makes a new tab. Otherwise (an implicit bind) the shell
   * first wakes the most recently active canvas tab that is in the strip but not registered (restored,
   * or still loading) and answers with it; it makes a blank canvas only when there is none.
   */
  | { type: "open"; rid: string; activate?: boolean }
  | { type: "activate"; tabId: number }
  | { type: "to-tab"; tabId: number; env: LinkEnvelope<ChatToCanvasMsg> }
  | { type: "open-item"; rid: string; item: ItemRef };

/** Canvas tab frame -> shell. */
export type TabToShell =
  | { type: "register" }
  | { type: "unregister" }
  /** The frame is unloading (reload, close): same effect as `unregister`. */
  | { type: "bye" }
  | { type: "to-panel"; env: LinkEnvelope<CanvasToChatMsg> };

export type FrameToShell = PanelToShell | TabToShell;

/** Shell -> panel frame. */
export type ShellToPanel =
  | { type: "list-reply"; rid: string; tabs: CanvasTabInfo[] }
  | { type: "open-reply"; rid: string; ok: true; tabId: number; registrationId: number }
  | { type: "open-reply"; rid: string; ok: false; error: string }
  | { type: "item-reply"; rid: string; ok: boolean; error?: string }
  | { type: "tabs"; tabs: CanvasTabInfo[] }
  | { type: "from-tab"; tabId: number; env: LinkEnvelope<CanvasToChatMsg | MainToChatMsg> };

/** Shell -> canvas tab frame. */
export type ShellToTab = { type: "from-panel"; env: LinkEnvelope<ChatToCanvasMsg | MainToCanvasMsg> };

export type WireMessage<T> = T & { ns: typeof LINK_WIRE_NS };

export function wire<T extends { type: string }>(msg: T): WireMessage<T> {
  return { ...msg, ns: LINK_WIRE_NS };
}

/** true for an object that carries our tag and a string `type`. The rest is validated by the receiver. */
export function isWireMessage(data: unknown): data is WireMessage<{ type: string }> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { ns?: unknown }).ns === LINK_WIRE_NS &&
    typeof (data as { type?: unknown }).type === "string"
  );
}
