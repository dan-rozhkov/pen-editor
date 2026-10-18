import type {
  ToolExecutionContext as HarnessToolExecutionContext,
  ToolHandler as HarnessToolHandler,
} from "@sideform/agent-harness/surface";

/**
 * Per-call metadata threaded through to handlers that need to correlate
 * with transient, non-scene state keyed by chat session + tool call (e.g.
 * the AI vector drawing preview store). Optional and absent for direct MCP
 * bridge calls, which have no chat session.
 *
 * Defined here (not in lib/toolRegistry.ts, which re-exports it) so surface
 * modules do not import the registry that is composed from them.
 */
export interface ToolExecutionContext extends HarnessToolExecutionContext {
  /**
   * Isolated browser session of a browse_agent QA run. The browse_* handlers
   * pass it to `getBrowserBridge` so every nested command reaches the run's own
   * browser; the loop guard keys on it instead of `sessionId`.
   */
  browserSession?: string;
}

export type ToolHandler = HarnessToolHandler<ToolExecutionContext>;
