import { callPluginMethod } from "./pluginApi";
import type { PluginReadyMessage, PluginRpcRequest, PluginRpcResponse } from "./types";

export function isRpcRequest(data: unknown): data is PluginRpcRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.kind === "pen-rpc-request" &&
    typeof d.callId === "number" &&
    typeof d.method === "string" &&
    Array.isArray(d.args)
  );
}

/** The one-time readiness handshake a plugin iframe posts right after wiring
 * up its own listener (see `PluginReadyMessage`). */
export function isPluginReadyMessage(data: unknown): data is PluginReadyMessage {
  if (typeof data !== "object" || data === null) return false;
  return (data as Record<string, unknown>).kind === "pen-plugin-ready";
}

/**
 * Handle one message arriving from a plugin iframe. Anything that is not a
 * well-formed RPC request is ignored (defense against random postMessage
 * traffic); facade errors become {ok:false} responses, never host exceptions.
 */
export async function handlePluginMessage(
  pluginId: string,
  data: unknown,
  reply: (response: PluginRpcResponse) => void,
  onClose: () => void,
): Promise<void> {
  if (!isRpcRequest(data)) return;
  if (data.method === "close") {
    onClose();
    return;
  }
  try {
    const result = await callPluginMethod(pluginId, data.method, data.args);
    reply({ kind: "pen-rpc-response", callId: data.callId, ok: true, result });
  } catch (err) {
    reply({
      kind: "pen-rpc-response",
      callId: data.callId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
