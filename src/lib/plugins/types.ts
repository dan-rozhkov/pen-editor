/** A generative plugin: AI-authored JS executed in a sandboxed iframe. */
export interface PenPlugin {
  id: string;
  name: string;
  description: string;
  icon?: string;
  /** JS source, executed as a <script type="module"> inside the sandbox iframe. */
  code: string;
  /** null/absent = headless (no visible panel). Set = the iframe mounts in a
   * floating `PluginPanel` sized to this on open (plg-04). */
  ui?: { width: number; height: number } | null;
  source: "ai" | "imported";
  createdAt: number;
  updatedAt: number;
}

/** Editor UI theme, mirrored into a plugin iframe's `data-theme`/CSS vars. */
export type PluginTheme = "light" | "dark";

/** Snapshot of the editor's theme tokens delivered to a plugin iframe. */
export interface PluginThemePayload {
  theme: PluginTheme;
  cssVars: Record<string, string>;
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

/** host → iframe, событийный канал: selectionchange (v1) + themechange (plg-04). */
export type PluginHostEvent =
  | { kind: "pen-host-event"; event: "selectionchange"; payload: unknown }
  | { kind: "pen-host-event"; event: "themechange"; payload: PluginThemePayload };

/** iframe → host, one-time readiness handshake: the bootstrap script posts
 * this right after registering its own `message` listener, so the host knows
 * it's now safe to deliver the current theme without racing the listener's
 * registration (plg-04 — a `themechange` posted before this arrives would
 * otherwise be silently dropped). */
export interface PluginReadyMessage {
  kind: "pen-plugin-ready";
}
