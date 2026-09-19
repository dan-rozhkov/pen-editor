import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useChatStore } from "@/store/chatStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { withHistoryBatch } from "@/store/historyStore";
import { addDrawnNodeWithAutoParenting } from "@/pixi/interaction/autoParentPlacement";
import { useAiSvgPreviewStore, svgPreviewKey } from "@/store/aiSvgPreviewStore";
import { streamQuiverVector } from "@/lib/quiverVector/stream";
import { parseSvgToNodes, getSvgIntrinsicSize } from "@/utils/svgUtils";
import { scaleAndOffsetNode } from "@/lib/htmlToDesign/svgHandling";
import { computeUniformFit } from "@/lib/quiverVector/fit";
import { getAbsolutePositionFlat } from "@/utils/nodeUtils";
import type { SceneNode } from "@/types/scene";
import type { ToolExecutionContext, ToolHandler } from "../../toolRegistry";

/** Default artwork box when the model names no size AND the SVG's own
 * natural size isn't known yet (used only as a placeholder for the very
 * first preview frame, before `onProgress` has seen the root `<svg>` tag and
 * can read its real `viewBox`). Large enough to read as artwork rather than
 * an icon, small enough not to dominate a mobile frame. */
const DEFAULT_SIZE = 240;

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Where to place artwork the model positioned no more precisely than "on the
 * canvas": the middle of what the user is currently looking at.
 */
function viewportCenter(width: number, height: number): { x: number; y: number } {
  const { scale, x, y } = useViewportStore.getState().getViewportState();
  const screenWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const screenHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const safeScale = scale > 0 ? scale : 1;
  return {
    x: Math.round((screenWidth / 2 - x) / safeScale - width / 2),
    y: Math.round((screenHeight / 2 - y) / safeScale - height / 2),
  };
}

/**
 * Client-executed handler for `generate_vector`.
 *
 * Unlike `draw_vector`, the geometry is not authored by the chat model: this
 * asks QuiverAI's vector model for an SVG and streams it. Each finished element
 * is shown as a rasterized preview; the scene nodes are built once, from the
 * final document, so the whole generation is a single undo step.
 */
export const generateVector: ToolHandler = async (
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<string> => {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const instructions =
    typeof args.instructions === "string" && args.instructions.trim().length > 0
      ? args.instructions.trim()
      : undefined;

  const key =
    context?.sessionId && context.toolCallId
      ? svgPreviewKey(context.sessionId, context.toolCallId)
      : undefined;
  const preview = useAiSvgPreviewStore.getState();

  if (!prompt) {
    if (key) preview.finalizeCall(key);
    return JSON.stringify({
      success: false,
      error: "generate_vector requires a non-empty 'prompt' describing the artwork.",
    });
  }

  const widthArg = readNumber(args.width);
  const heightArg = readNumber(args.height);
  // "omit to use its natural size" only means something once the SVG's own
  // size is known; until then this is just a reasonable-looking guess for
  // the very first preview frame.
  const naturalSizeRequested = widthArg === undefined && heightArg === undefined;
  const width = widthArg ?? DEFAULT_SIZE;
  const height = heightArg ?? DEFAULT_SIZE;
  const explicitX = readNumber(args.x);
  const explicitY = readNumber(args.y);
  const hasExplicitPosition = explicitX !== undefined && explicitY !== undefined;
  const placement = hasExplicitPosition ? { x: explicitX, y: explicitY } : viewportCenter(width, height);
  let bounds = { ...placement, width, height };

  const rawParentId = typeof args.parentId === "string" ? args.parentId.trim() : "";
  const parentId = rawParentId.length > 0 ? rawParentId : undefined;

  const abortSignal = context?.sessionId
    ? useChatStore.getState().abortControllers[context.sessionId]?.signal
    : undefined;

  // Claim the spot before the model has produced a single byte. Quiver sends
  // nothing at all for ~18s, so without this the canvas stays blank for the
  // whole think phase and the user has no idea where the artwork will appear.
  if (key && context?.sessionId && context.toolCallId) {
    preview.upsert({
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
      svg: "",
      completeElements: 0,
      bounds,
      phase: "waiting",
    });
  }

  try {
    const svg = await streamQuiverVector({
      prompt,
      instructions,
      signal: abortSignal,
      onProgress: ({ svg: frame, completeElements }) => {
        // Neither dimension was named — as soon as the streamed prefix
        // carries a root `<svg>` tag we know its real viewBox, so switch the
        // preview from the DEFAULT_SIZE guess to the artwork's own natural
        // size instead of stretching/shrinking it into an arbitrary box.
        if (naturalSizeRequested) {
          const natural = getSvgIntrinsicSize(frame);
          if (natural && (natural.width !== bounds.width || natural.height !== bounds.height)) {
            const naturalPlacement = hasExplicitPosition
              ? { x: explicitX, y: explicitY }
              : viewportCenter(natural.width, natural.height);
            bounds = { ...naturalPlacement, width: natural.width, height: natural.height };
          }
        }
        if (!key || !context?.sessionId || !context.toolCallId) return;
        preview.upsert({
          sessionId: context.sessionId,
          toolCallId: context.toolCallId,
          svg: frame,
          completeElements,
          bounds,
          phase: "streaming",
        });
      },
    });

    if (key) useAiSvgPreviewStore.getState().markCommitting(key);

    const parsed = parseSvgToNodes(svg);
    if (parsed === null) {
      if (key) useAiSvgPreviewStore.getState().finalizeCall(key);
      return JSON.stringify({
        success: false,
        error: "The generated SVG could not be converted into editable shapes.",
      });
    }

    // Neither dimension was named: `bounds` is the final, authoritative
    // source of the SVG's own size (`parseSvgToNodes`'s `svgWidth`/
    // `svgHeight`), not the mid-stream `onProgress` guess above — a
    // generation that never called `onProgress` before resolving (or whose
    // partial prefixes never happened to differ from the DEFAULT_SIZE
    // placeholder) would otherwise still commit at 240x240.
    if (naturalSizeRequested && (parsed.svgWidth !== bounds.width || parsed.svgHeight !== bounds.height)) {
      const naturalPlacement = hasExplicitPosition
        ? { x: explicitX, y: explicitY }
        : viewportCenter(parsed.svgWidth, parsed.svgHeight);
      bounds = { ...naturalPlacement, width: parsed.svgWidth, height: parsed.svgHeight };
    }

    // Fit the artwork into the same box the preview was rasterized into,
    // via the helper both the preview layer and this commit path share (see
    // `computeUniformFit`'s doc comment) — a `naturalSizeRequested` bounds
    // box already equals the SVG's own size, so this is a no-op scale of 1.
    const node: SceneNode = parsed.node;
    const fit = computeUniformFit(parsed.svgWidth, parsed.svgHeight, bounds);
    scaleAndOffsetNode(node, fit.scale, fit.scale, fit.x, fit.y);

    const warnings = parsed.warnings ?? [];

    saveHistory(useSceneStore.getState());
    withHistoryBatch(() => {
      const resolvedParent = parentId ? useSceneStore.getState().nodesById[parentId] : undefined;
      if (parentId && resolvedParent && (resolvedParent.type === "frame" || resolvedParent.type === "group")) {
        const sceneState = useSceneStore.getState();
        const parentAbs = getAbsolutePositionFlat(parentId, sceneState.nodesById, sceneState.parentById);
        sceneState.addChildToFrame(parentId, {
          ...node,
          x: node.x - parentAbs.x,
          y: node.y - parentAbs.y,
        });
        useSelectionStore.getState().select(node.id);
        return;
      }
      if (parentId && !resolvedParent) {
        warnings.push(`parentId "${parentId}" does not match any node; placed using automatic positioning instead.`);
      } else if (parentId && resolvedParent) {
        warnings.push(`parentId "${parentId}" is a ${resolvedParent.type} node, not a frame or group; placed using automatic positioning instead.`);
      }
      addDrawnNodeWithAutoParenting(node, bounds, node.id);
    });

    // Surface the importer's non-fatal complaints (an unrepresentable
    // gradient falling back to a solid, a skipped element) so the model can
    // react instead of assuming the artwork landed exactly as drawn.
    return JSON.stringify({
      success: true,
      createdNode: { id: node.id, name: node.name, type: node.type },
      bounds,
      prompt,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error) {
    if (isAbortError(error)) {
      // The user pressed Stop: this is a cancellation, not a failure the
      // model should see advice to retry. useDesignChat has already torn
      // down the chat turn by the time this resolves (its AbortController
      // listener calls chat.stop() synchronously on abort), so nothing
      // downstream reads this string in practice — but it must still be a
      // well-formed, non-throwing result rather than an unhandled
      // rejection, and it must not read as an ordinary error.
      return JSON.stringify({
        success: false,
        cancelled: true,
        error: "Vector generation was cancelled.",
      });
    }
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Always clear the preview, including on the error paths above: an early
    // return that leaves a draft staged paints it on the canvas forever.
    if (key) useAiSvgPreviewStore.getState().finalizeCall(key);
  }
};
