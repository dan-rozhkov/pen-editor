/**
 * A click on a tool chip in the agent panel's chat brings forward the tab the call runs in
 * (docs/canvas-link.md): the canvas tab it was sent to, or the browser tab the agent drives.
 * No-op outside the agent panel and for tools that run in neither (panel-local, backend, MCP).
 * Never throws.
 */
import { getAgentPanelCanvasBridge } from "@/lib/agentPanel";
import { isIsolatedQaCall, runSessionForCall } from "@/lib/tools/browser/isolation";
import { runsInCanvasTab } from "./canvasTools";
import { getPanelClient } from "./panelRuntime";

interface RevealArgs {
  sessionId: string | null | undefined;
  toolCallId: string;
  toolName: string;
  input?: unknown;
}

const BROWSER_PREFIXES = ["browse_", "qa_"] as const;

async function revealCanvasTab({ sessionId, toolCallId, toolName }: RevealArgs): Promise<void> {
  const bridge = getAgentPanelCanvasBridge();
  const client = getPanelClient();
  if (!bridge || !client) return;
  const sent = client.tabForCall(toolCallId);
  if (sent === null) return; // its tab is gone: the chat's current tab holds another document
  let tabId = sent;
  if (tabId === undefined) {
    // Unknown call (e.g. the panel reloaded): the chat's current binding, but only for a tool the
    // canvas really runs (a backend or MCP tool also passes `runsInCanvasTab`). Lazy: the registry
    // imports every handler.
    const { toolHandlers } = await import("@/lib/toolRegistry");
    if (toolName !== "open_canvas_tab" && !Object.hasOwn(toolHandlers, toolName)) return;
    tabId = sessionId ? client.getBinding(sessionId)?.tabId : undefined;
  }
  if (tabId !== undefined) bridge.activateTab(tabId);
}

async function revealBrowserTab({ toolName, toolCallId, input }: RevealArgs): Promise<void> {
  const browser = window.penAgentPanel?.browser;
  if (typeof browser?.revealAgentTab !== "function") return; // shell older than this feature
  let session: string | undefined;
  if (toolName === "browse_agent" && input !== null && typeof input === "object" && isIsolatedQaCall(input as Record<string, unknown>)) {
    // An isolated QA run never uses the shared browser: no remembered session (still waiting for a
    // slot, or the panel reloaded) means nothing to show. A finished run has no tabs left either:
    // the shell answers false.
    session = runSessionForCall(toolCallId);
    if (session === undefined) return;
  }
  await browser.revealAgentTab(session);
}

export async function revealToolTab(args: RevealArgs): Promise<void> {
  try {
    if (!window.penAgentPanel) return;
    if (BROWSER_PREFIXES.some((p) => args.toolName.startsWith(p))) await revealBrowserTab(args);
    else if (args.toolName === "open_canvas_tab" || runsInCanvasTab(args.toolName)) await revealCanvasTab(args);
  } catch {
    // A click must never fail because the shell could not switch tabs.
  }
}
