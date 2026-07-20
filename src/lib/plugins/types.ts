/** A generative plugin: AI-authored JS executed in a sandboxed iframe. */
export interface PenPlugin {
  id: string;
  name: string;
  description: string;
  icon?: string;
  /** JS source, executed as a <script type="module"> inside the sandbox iframe. */
  code: string;
  /** null/absent = headless (no visible panel; panels are plg-04). */
  ui?: { width: number; height: number } | null;
  source: "ai" | "imported";
  createdAt: number;
  updatedAt: number;
}

/** iframe → host */
export interface PluginRpcRequest {
  kind: "pen-rpc-request";
  callId: number;
  method: string;
  args: unknown[];
}

/** host → iframe */
export interface PluginRpcResponse {
  kind: "pen-rpc-response";
  callId: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** host → iframe, событийный канал (v1: только selectionchange) */
export interface PluginHostEvent {
  kind: "pen-host-event";
  event: "selectionchange";
  payload: unknown;
}
