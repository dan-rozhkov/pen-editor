/**
 * The agent panel's singleton `PanelClient` and the thin seams `useDesignChat`
 * and the browser tools call (docs/canvas-link.md). Every seam is inert (returns
 * the "local behavior" answer) unless this page is the desktop agent panel with
 * a canvas bridge, so nothing changes in the editor tab, on the web or in a dev
 * build without `window.penAgentPanel`.
 */
import { getAgentPanelCanvasBridge, isAgentPanelHost } from "@/lib/agentPanel";
import { track } from "@/lib/analytics";
import { useChatStore } from "@/store/chatStore";
import { getLikedReferences } from "./likedReferences";
import { setPlaceNodeRedirect } from "@/lib/tools/browser/placeOnCanvas";
import { runsInCanvasTab } from "./canvasTools";
import { PanelClient, type CallFailure, type CallOptions } from "./panelClient";

let client: PanelClient | null = null;
let clientBridge: unknown = null;

/** True in the desktop agent panel with a canvas bridge (panel version >= 2). */
export function isPanelCanvasLinkActive(): boolean {
  return isAgentPanelHost() && getAgentPanelCanvasBridge() !== undefined;
}

/**
 * `agent_tool_executed` for a canvas call that never got an answer from the tab's
 * handler. A call that reached the tab is reported once, by the tab's own
 * `executeToolCall` (source "canvas-link"); reporting it here too would count it twice.
 */
function trackCanvasCallFailed({ toolName, kind, durationMs }: CallFailure): void {
  track("agent_tool_executed", {
    tool_name: toolName,
    ok: false,
    duration_ms: durationMs,
    error_kind: `canvas_link_${kind}`,
    source: "canvas-link",
  });
}

/** Creates the singleton (and installs the place-node redirect) on first use. */
export function getPanelClient(): PanelClient | null {
  const bridge = getAgentPanelCanvasBridge();
  if (!bridge || !isAgentPanelHost()) return null;
  if (client && clientBridge === bridge) return client;
  client?.dispose();
  client = new PanelClient({ bridge, onCallFailed: trackCanvasCallFailed });
  clientBridge = bridge;
  // The browse handlers pass their chat's `sessionId`, so a background chat's capture goes to ITS
  // bound tab. Only a caller without one (none today) falls back to the active chat.
  setPlaceNodeRedirect(async (node, options, signal, sessionId) => {
    const session = sessionId ?? useChatStore.getState().activeChatId;
    const c = client;
    if (!session || !c) throw new Error("No chat is bound to a canvas tab.");
    const placed = await c.placeNode(session, node, options, signal);
    // A placement the tab answered stands even if the signal aborted meanwhile: the node exists.
    if ("error" in placed) {
      if (signal?.aborted) return undefined;
      throw new Error(placed.error);
    }
    return placed;
  });
  return client;
}

/** Test seam: drops the singleton and the place-node redirect. */
export function resetPanelRuntimeForTests(): void {
  client?.dispose();
  client = null;
  clientBridge = null;
  setPlaceNodeRedirect(null);
}

/** true when the panel must hand this tool to the bound canvas tab. */
export function panelRunsInCanvas(toolName: string): boolean {
  return isPanelCanvasLinkActive() && runsInCanvasTab(toolName);
}

/** Runs a canvas tool in the bound canvas tab. Only call when `panelRunsInCanvas(toolName)`. */
export function panelCallTool(sessionId: string, toolName: string, input: unknown, options: CallOptions): Promise<string> {
  const c = getPanelClient();
  if (!c) return Promise.resolve(JSON.stringify({ error: "The canvas link is not available." }));
  return c.callTool(sessionId, toolName, input, options);
}

/** Forwards a partial input; true = consumed (do not apply locally). */
export function panelForwardFrame(
  sessionId: string,
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>
): boolean {
  if (!panelRunsInCanvas(toolName)) return false;
  getPanelClient()?.forwardFrame(sessionId, toolCallId, toolName, input);
  return true;
}

export function panelEndStream(toolCallId: string, reason: "complete" | "abandoned"): void {
  client?.endStream(toolCallId, reason);
}

/**
 * Request body provider for the panel. `local` is the body `buildCanvasContext`
 * built from the panel's own (empty) stores. In the panel its `canvasContext`
 * is replaced by the bound canvas tab's, with this chat's `likedReferences`
 * appended as the LAST key of the context JSON.
 *
 * An unbound chat binds passively to the first registered canvas tab (one is never
 * opened just to send a message). No fresh context (an error; the 2 s timeout) falls
 * back to the last one this chat received, so the prompt does not flap; a gone tab
 * clears it. A chat with no scene context gets NO `canvasContext` field at all, or
 * just `{"likedReferences":[...]}` when it has liked references. The backend then renders no `<canvas_context>`
 * message and no pointer block in the system prompt (chatTurn.ts
 * `canvasContextDelivered`), which beats sending the panel's empty scene as if
 * it were the design. Costs one system-prompt change when the first canvas
 * context starts to arrive.
 */
export function withPanelCanvasContext<T extends object>(sessionId: string, local: T): T | Promise<object> {
  const c = getPanelClient();
  if (!c) return local;
  const rest = { ...(local as object) } as Record<string, unknown>;
  delete rest.canvasContext; // the panel's own (empty) scene; replaced below or omitted
  const model = (rest as { model?: unknown }).model;
  return c.requestContext(sessionId, typeof model === "string" ? model : "").then((remote) => {
    // Same source `buildCanvasContext` reads, not parsed back out of its output.
    const liked = getLikedReferences(sessionId);
    if (remote === null) {
      // No scene context, but the user's hearted references still count.
      return liked.length > 0 ? { ...rest, canvasContext: JSON.stringify({ likedReferences: liked }) } : rest;
    }
    return { ...rest, canvasContext: appendLikedReferences(remote, liked) };
  });
}

/** JSON.parse + add + JSON.stringify: deterministic, `likedReferences` always last, omitted when empty. */
export function appendLikedReferences(canvasContext: string, likedReferences: unknown[]): string {
  try {
    const parsed = JSON.parse(canvasContext) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return canvasContext;
    delete parsed.likedReferences;
    if (likedReferences.length > 0) parsed.likedReferences = likedReferences;
    return JSON.stringify(parsed);
  } catch {
    return canvasContext;
  }
}
