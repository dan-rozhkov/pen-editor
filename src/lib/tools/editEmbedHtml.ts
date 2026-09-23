import { useSceneStore } from "@/store/sceneStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { applyAnchorEdits } from "@/lib/embedHtmlEdit/applyAnchorEdits";
import { parseAnchorEditsInput } from "@/lib/embedHtmlEdit/parseEdits";
import { inspectEmbedHtml } from "@/lib/embedHtmlLint/inspectEmbedHtml";
import {
  takeProgressiveEmbedHtmlSession,
  restoreProgressiveSessionHtml,
} from "./editEmbedHtmlProgressive";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";
import { recordTouchedEmbeds } from "./tasteCheckRegistry";

export const editEmbedHtml: ToolHandler = async (args, context) => {
  const nodeId = typeof args.nodeId === "string" ? args.nodeId : "";

  // Take (and permanently finalize) any progressive session for this call
  // FIRST, on every exit path below — including the early-return validation
  // errors that follow. A truncated stream (e.g. a mid-stream `newString`
  // followed by a final call whose `edits` fails to parse) must never leave
  // streamed html on the node with the session still sitting in the map and
  // nothing left to ever restore it.
  if (context?.sessionId && context?.toolCallId) {
    const session = takeProgressiveEmbedHtmlSession(context.sessionId, context.toolCallId);
    if (session) {
      const { conflicted } = restoreProgressiveSessionHtml(session);
      if (conflicted) {
        // Say so honestly rather than silently running the strict path below
        // against unrelated content while claiming "nothing was changed."
        return JSON.stringify({
          error:
            `Node ${session.nodeId}'s HTML changed from another source while this edit was still ` +
            "streaming in, so the streamed edit was discarded instead of being applied. " +
            "Re-run edit_embed_html against the node's current content to make further changes.",
        });
      }
    }
  }

  if (!nodeId) return JSON.stringify({ error: "nodeId is required" });

  const edits = parseAnchorEditsInput(args.edits);
  if (!edits) return JSON.stringify({ error: "edits must be an array of {oldString, newString}" });
  if (edits.length === 0) return JSON.stringify({ error: "No edits provided" });

  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return JSON.stringify({ error: `Node ${nodeId} not found` });
  if (node.type !== "embed") {
    return JSON.stringify({
      error: `Node ${nodeId} is a "${node.type}" node, not an embed. edit_embed_html only edits embed screens.`,
    });
  }

  const embed = node as unknown as EmbedNode;
  const source = embed.htmlContent;

  let edited;
  try {
    edited = applyAnchorEdits(source, edits);
  } catch (err) {
    // Nothing was written to the store — the failure is fully atomic.
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  const updated = { ...embed, htmlContent: edited.html } as EmbedNode;

  // Static HTML warnings (unknown Phosphor icon classes render as blank space
  // with no error anywhere else). Only the ones this edit INTRODUCED: linting
  // the whole screen would re-report every pre-existing bad name on each edit,
  // which reads as "your edit broke this" and pulls the model into fixing
  // markup nobody asked about.
  const preexisting = new Set(inspectEmbedHtml(embed.htmlContent));
  const issues = inspectEmbedHtml(updated.htmlContent).filter((w) => !preexisting.has(w));

  const newNodesById: Record<string, FlatSceneNode> = {
    ...state.nodesById,
    [nodeId]: updated as unknown as FlatSceneNode,
  };

  saveHistory(state);
  useSceneStore.setState({ nodesById: newNodesById, _cachedTree: null });

  // Record this node as touched, on success only, so the CHAT PATH
  // (useDesignChat.ts, via tasteCheck.ts) can run a Jev taste check against
  // it AFTER this handler returns — see tasteCheckRegistry.ts's doc comment
  // for why the check itself no longer runs in here. This is usually round 2
  // for a screen batch_design already checked once (tasteCheck.ts only
  // starts checking via an edit if the embed already had a completed round).
  recordTouchedEmbeds(context?.toolCallId, [nodeId]);

  return JSON.stringify({
    nodeId,
    editsApplied: edits.length,
    replacements: edited.replacements,
    normalizedMatches: edited.normalizedMatches,
    htmlLength: updated.htmlContent.length,
    issues,
  });
};
