import { createToolDispatcher, type ToolDispatchOutcome } from "@/lib/mcpDispatch";
import { DESKTOP_MCP_TOOL_NAMES } from "@/lib/mcpToolNames";
import { toolHandlers } from "@/lib/toolRegistry";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";

// registerMcpBridge's call envelope version. Bump only when the envelope
// itself changes (message shape, protocol semantics) — never for adding or
// removing a tool, which the desktop shell reconciles by intersecting its
// own manifest with the `tools` array below.
const PROTOCOL_VERSION = 1;

// The MCP tool-name subset of toolHandlers advertised to the desktop shell:
// the 7 backend-bridged tools plus the 3 static guideline tools that already
// run entirely client-side (see staticTools.ts). Derived from
// src/lib/mcpToolNames.ts, the single source shared with
// src/lib/__tests__/toolContract.test.ts — no more hand-copying. toolHandlers
// also contains tools with no MCP counterpart at all (generate_image,
// read_comments, create_plugin, ask_user, draw_vector, remove_background,
// vectorize_image, ...); those are never
// advertised to the desktop shell, and `dispatchCall` below refuses them even
// if a shell bug or mismatched build asks for one by name.
const MCP_TOOL_NAMES = DESKTOP_MCP_TOOL_NAMES;

let teardown: (() => void) | null = null;

/**
 * Whether the desktop IPC bridge is currently registered. Consulted by
 * mcpBridge.ts's startMcpBridgeIfConfigured() so the WebSocket bridge never
 * runs alongside this one — two independent paths into the same
 * toolHandlers, each with its own serial queue, could interleave scene
 * mutations mid-call.
 */
export function isDesktopMcpBridgeActive(): boolean {
  return teardown !== null;
}

/**
 * Registers this tab with the Electron shell's loopback MCP endpoint (see
 * ../pen-editor-desktop, `window.penDesktop.registerMcpBridge`). Guarded and
 * a no-op on the web and on older desktop builds that predate
 * registerMcpBridge. Mirrors desktopBridge.ts's shape: idempotent init,
 * returns a teardown that unregisters.
 */
export function initDesktopMcpBridge(): () => void {
  if (teardown) return () => {};

  const registerMcpBridge = window.penDesktop?.registerMcpBridge;
  if (!registerMcpBridge) return () => {};

  const tools = MCP_TOOL_NAMES.filter((name) => name in toolHandlers);
  const advertised = new Set<string>(tools);

  // Routes through the same serial-queue dispatch core mcpBridge.ts (the
  // WebSocket bridge) uses, so two overlapping mcp:call IPC messages cannot
  // interleave scene mutations — the page is the only place that can
  // enforce this across differently-versioned shell builds. `send` resolves
  // the pending onCall promise for the matching call id. Unlike the
  // WebSocket bridge there is no transport to go stale mid-call (IPC calls
  // are one-shot request/response) — but there is a lifecycle to go stale
  // mid-call: teardown() below flips `torn` so a call still sitting in the
  // queue when the tab/registration goes away is skipped rather than
  // executed (and its scene mutation committed) after the bridge is gone.
  const pending = new Map<string, (result: string) => void>();
  let torn = false;
  const dispatcher = createToolDispatcher({
    send: (outcome: ToolDispatchOutcome) => {
      const resolve = pending.get(outcome.id);
      if (!resolve) return;
      pending.delete(outcome.id);
      resolve(outcome.type === "tool_result" ? outcome.result : JSON.stringify({ error: outcome.error }));
    },
    isLive: () => !torn,
  });

  let nextCallId = 0;

  // `tools` is the advertised, authoritative allow-list — checked here,
  // before the call ever reaches the dispatcher/executeToolCall, so a shell
  // bug or a mismatched desktop build cannot reach a tool this bridge
  // claims not to expose (e.g. create_plugin, ask_user), even though those
  // names exist in toolHandlers. Mirrors the "Unknown tool: <name>" wording
  // mcpBridge.ts's dispatcher uses for the same failure mode.
  function dispatchCall(name: string, args: unknown): Promise<string> {
    if (!advertised.has(name)) {
      return Promise.resolve(JSON.stringify({ error: `Unknown tool: ${name}` }));
    }
    const id = `desktop-${++nextCallId}`;
    return new Promise<string>((resolve) => {
      pending.set(id, resolve);
      dispatcher.dispatch({ id, type: "tool_call", tool: name, args });
    });
  }

  const unregister = registerMcpBridge({
    protocol: PROTOCOL_VERSION,
    tools,
    onCall: dispatchCall,
  });

  // Reuses the same store/indicator the WebSocket bridge drives
  // (LeftSidebar.tsx's dot) — no UI change needed for the desktop path.
  useMcpBridgeStore.getState().setStatus("connected");

  teardown = () => {
    // Stop the queue from starting any call still waiting behind an
    // in-flight one before draining `pending` below — otherwise a queued
    // call could slip through between the drain and the isLive flip and
    // still execute (and mutate the scene) after teardown.
    torn = true;

    // Settle every outstanding onCall promise (in-flight and merely
    // queued alike) so the shell never waits forever on a call this bridge
    // is abandoning. Matches the plan's §2 lifecycle: on teardown,
    // registration drops and in-flight calls reject (here: resolve with an
    // error string, matching this bridge's existing no-reject contract).
    for (const resolve of pending.values()) {
      resolve(JSON.stringify({ error: "Desktop MCP bridge torn down before this call completed." }));
    }
    pending.clear();

    // `unregister` is assumed to be a function only because registerMcpBridge
    // is trusted to return one — but this module exists precisely because
    // the deployed bundle and the shell can be on different versions
    // (registerMcpBridge? is optional for that same reason). A shell build
    // that registers but returns nothing must not leave the bridge stuck
    // "active" forever: reset state in `finally` regardless of whether
    // unregister exists or throws.
    try {
      if (typeof unregister === "function") {
        unregister();
      }
    } catch (error) {
      console.error("[desktopMcpBridge] unregister threw during teardown", error);
    } finally {
      teardown = null;
      useMcpBridgeStore.getState().setStatus("off");
    }
  };
  return teardown;
}
