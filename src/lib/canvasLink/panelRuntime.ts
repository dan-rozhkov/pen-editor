/**
 * The agent panel's singleton `PanelClient` and the thin seams `useDesignChat`
 * and the browser tools call (docs/canvas-link.md). Every seam is inert (returns
 * the "local behavior" answer) unless this page is the desktop agent panel with
 * a canvas bridge, so nothing changes in the editor tab, on the web or in a dev
 * build without `window.penAgentPanel`.
 */
import { getAgentPanelCanvasBridge, isAgentPanelHost } from "@/lib/agentPanel";
import { useChatStore } from "@/store/chatStore";
import { setPlaceNodeRedirect } from "@/lib/tools/browser/placeOnCanvas";
import { runsInCanvasTab } from "./canvasTools";
import { PanelClient, type CallOptions } from "./panelClient";

let client: PanelClient | null = null;
let clientBridge: unknown = null;

/** True in the desktop agent panel with a canvas bridge (panel version >= 2). */
export function isPanelCanvasLinkActive(): boolean {
  return isAgentPanelHost() && getAgentPanelCanvasBridge() !== undefined;
}

/** Creates the singleton (and installs the place-node redirect) on first use. */
export function getPanelClient(): PanelClient | null {
  const bridge = getAgentPanelCanvasBridge();
  if (!bridge || !isAgentPanelHost()) return null;
  if (client && clientBridge === bridge) return client;
  client?.dispose();
  client = new PanelClient({ bridge });
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
 * No fresh context (no binding yet: a canvas tab is never opened just to send a
 * message; a gone tab; an error; the 2 s timeout) falls back to the last one this
 * chat received, so the prompt does not flap. A chat that never received one gets NO
 * `canvasContext` field at all. The backend then renders no `<canvas_context>`
 * message and no pointer block in the system prompt (chatTurn.ts
 * `canvasContextDelivered`), which beats sending the panel's empty scene as if
 * it were the design. Costs one system-prompt change when the first canvas
 * context starts to arrive.
 */
export function withPanelCanvasContext<T extends object>(sessionId: string, local: T): T | Promise<object> {
  const c = getPanelClient();
  if (!c) return local;
  const { canvasContext: localContext, ...rest } = local as T & { canvasContext?: unknown };
  const model = (rest as { model?: unknown }).model;
  return c.requestContext(sessionId, typeof model === "string" ? model : "").then((remote) => {
    if (remote === null) return rest;
    return { ...rest, canvasContext: appendLikedReferences(remote, likedReferencesOf(localContext)) };
  });
}

function likedReferencesOf(localContext: unknown): unknown[] {
  if (typeof localContext !== "string") return [];
  try {
    const refs = (JSON.parse(localContext) as { likedReferences?: unknown }).likedReferences;
    return Array.isArray(refs) ? refs : [];
  } catch {
    return [];
  }
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
