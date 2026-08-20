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

// Mirrors the pen tool's own default stroke (`penDraftCommit.ts`) — the
// fallback applied when a script has neither FILL nor STROKE, so a
// validated contour is never committed fully paint-less and invisible.
const DEFAULT_STROKE = {
  fill: "#000000",
  thickness: 2,
  join: "round" as const,
  cap: "round" as const,
  align: "center" as const,
};

/**
 * True when a normalized `#RRGGBB`/`#RRGGBBAA` color would actually paint
 * something. A `#RRGGBBAA` color whose alpha channel is `00` (e.g. from
 * `FILL("#00000000")`) is "no paint" in every way that matters visually,
 * but the string itself is still truthy — checking presence alone (as the
 * old `!fill`/`!pathStroke` guard did) misses it and lets a fully
 * transparent shape slip past the "never commit an invisible shape"
 * invariant below.
 */
function hasVisiblePaint(color: string | undefined): boolean {
  if (!color) return false;
  if (color.length === 9 && color.slice(7, 9).toLowerCase() === "00") return false;
  return true;
}

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

  const key = context?.sessionId && context.toolCallId
    ? vectorPreviewKey(context.sessionId, context.toolCallId)
    : undefined;

  if (!name || !commands) {
    if (key) useAiVectorPreviewStore.getState().finalizeCall(key);
    return JSON.stringify({
      success: false,
      error: "draw_vector requires a non-empty name and commands string",
    });
  }

  const parsed = parseVectorCommands(commands, "final");
  if (!parsed.ok) {
    if (key) useAiVectorPreviewStore.getState().finalizeCall(key);
    return JSON.stringify({ success: false, error: parsed.error, line: parsed.line });
  }

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

  try {
    const { points, geometry, bounds, contours, fill, fillRule, stroke, warnings: parseWarnings } =
      parsed.draft;
    const warnings = [...parseWarnings];

    // Multiple subcontours are represented purely through `geometry`
    // (concatenated subpaths + evenodd fill rule) — `points`/`closed` stay
    // in the single-contour shape the pen tool and point-edit mode expect,
    // and are simply omitted (legitimately absent per PathNode) once there's
    // more than one subcontour.
    const singleContour = contours.length === 1 ? contours[0] : undefined;

    let pathStroke = stroke
      ? {
          fill: stroke.color,
          thickness: stroke.width,
          join: "round" as const,
          cap: "round" as const,
          align: "center" as const,
        }
      : undefined;

    // Guaranteed visibility: a validated contour must never be committed
    // with no visible paint, or it silently vanishes from the canvas. This
    // checks *effective* paint (hasVisiblePaint), not merely field
    // presence — a zero-alpha FILL or a STROKE color is otherwise truthy
    // and would defeat this exact guard.
    if (!hasVisiblePaint(fill) && !hasVisiblePaint(pathStroke?.fill)) {
      pathStroke = DEFAULT_STROKE;
      warnings.push(
        "No FILL or STROKE was specified; a default black stroke was applied so the shape stays visible.",
      );
    }

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
      ...(singleContour ? { points: singleContour.points, closed: singleContour.closed } : {}),
      ...(fillRule ? { fillRule } : {}),
      ...(fill ? { fill } : {}),
      ...(pathStroke ? { pathStroke } : {}),
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
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (err) {
    // Commit failed after the preview was marked committing (or mid-commit)
    // — clear the staged preview immediately rather than leaving a ghost
    // painted on the canvas until an unrelated stop/error/unmount.
    if (key) useAiVectorPreviewStore.getState().finalizeCall(key);
    throw err;
  }
};
