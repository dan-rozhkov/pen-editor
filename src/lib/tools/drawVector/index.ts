import { generateId } from "@/types/scene";
import type { PathNode } from "@/types/scene";
import { addDrawnNodeWithAutoParenting } from "@/pixi/interaction/autoParentPlacement";
import { useSceneStore } from "@/store/sceneStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { withHistoryBatch } from "@/store/historyStore";
import { useAiVectorPreviewStore, vectorPreviewKey } from "@/store/aiVectorPreviewStore";
import type { ToolExecutionContext, ToolHandler } from "../../toolRegistry";
import { parseVectorCommands } from "./parser";
import { replayVectorPreview } from "./previewController";

/**
 * Client-executed handler for the `draw_vector` tool. Complete, validated
 * final input is the sole barrier for creating the scene node: streaming
 * previews (rendered elsewhere from the transient preview store) never
 * touch scene state, and a call that never streamed a preview (a buffered
 * model, or a direct MCP call with no execution context) still produces the
 * exact same committed `PathNode`.
 */
export const drawVector: ToolHandler = async (
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<string> => {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const commands = typeof args.commands === "string" ? args.commands : "";

  if (!name || !commands) {
    return JSON.stringify({
      success: false,
      error: "draw_vector requires a non-empty name and commands string",
    });
  }

  const parsed = parseVectorCommands(commands, "final");
  if (!parsed.ok) {
    return JSON.stringify({ success: false, error: parsed.error, line: parsed.line });
  }

  const key = context?.sessionId && context.toolCallId
    ? vectorPreviewKey(context.sessionId, context.toolCallId)
    : undefined;

  const existing = key ? useAiVectorPreviewStore.getState().drafts[key] : undefined;
  const streamed = existing?.receivedDuringStreaming === true;

  if (key && context?.sessionId && context.toolCallId && !streamed) {
    await replayVectorPreview({
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
      name,
      commands,
      maxDurationMs: 600,
    });
  }

  if (key) useAiVectorPreviewStore.getState().markCommitting(key);

  const { points, geometry, bounds, closed, fill, stroke } = parsed.draft;
  const id = generateId();
  const node: PathNode = {
    id,
    type: "path",
    name,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    geometry,
    geometryBounds: bounds,
    points,
    closed,
    ...(fill ? { fill } : {}),
    ...(stroke
      ? {
          pathStroke: {
            fill: stroke.color,
            thickness: stroke.width,
            join: "round" as const,
            cap: "round" as const,
            align: "center" as const,
          },
        }
      : {}),
  };

  // addDrawnNodeWithAutoParenting is add-node-then-select — two mutations
  // that would otherwise land as two history entries (one undo would only
  // revert selection, leaving the drawn node behind). Save once up front and
  // batch the rest into a single undo step, mirroring the same collapse used
  // by textPathController's path→text-on-path conversion.
  saveHistory(useSceneStore.getState());
  withHistoryBatch(() => {
    addDrawnNodeWithAutoParenting(node, bounds, id);
  });

  if (key) {
    const finalize = () => useAiVectorPreviewStore.getState().finalizeCall(key);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finalize);
    } else {
      setTimeout(finalize, 0);
    }
  }

  return JSON.stringify({
    success: true,
    createdNode: { id, name, type: "path" },
    anchorCount: points.length,
    streamed,
  });
};
