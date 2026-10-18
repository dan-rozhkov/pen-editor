import { composeToolHandlers } from "@sideform/agent-harness/surface";
import { SURFACES, sharedTools } from "@/surfaces";
import type { ToolExecutionContext, ToolHandler } from "@/surfaces/toolTypes";

// The types live in surfaces/toolTypes.ts so the surface modules never import
// this registry; re-exported because tool handlers import them from here.
export type { ToolExecutionContext, ToolHandler };

/**
 * Flat name -> handler map, composed from the surfaces (src/surfaces/) plus
 * the surface-independent shared tools. composeToolHandlers throws on a
 * duplicate name. The browse_* loop-guard wrapping lives in browserSurface.ts.
 */
export const toolHandlers: Record<string, ToolHandler> = composeToolHandlers(SURFACES, sharedTools);
