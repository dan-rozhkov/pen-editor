import { useCommentsStore } from "@/store/commentsStore";
import { useSceneStore } from "@/store/sceneStore";
import { buildReadCommentsResult } from "@/lib/comments/commentsLogic";
import type { ToolHandler } from "../toolRegistry";

/**
 * read_comments — list canvas comment threads (or one, by threadId) for the
 * agent to act on. Node-anchored threads carry the anchored nodeId + node
 * name; unresolved-only unless includeResolved. Message text is returned
 * verbatim (JSON.stringify already encodes it safely for the tool-result
 * channel). Reads the CURRENT page's threads only — the store holds just
 * the active page (like measurements).
 */
export const readComments: ToolHandler = async (args) => {
  const includeResolved =
    typeof args.includeResolved === "boolean" ? args.includeResolved : false;
  const threadId = typeof args.threadId === "string" ? args.threadId : undefined;

  const threads = useCommentsStore.getState().threads;
  const nodesById = useSceneStore.getState().nodesById;

  const result = buildReadCommentsResult(threads, nodesById, {
    includeResolved,
    threadId,
  });

  return JSON.stringify(result);
};
