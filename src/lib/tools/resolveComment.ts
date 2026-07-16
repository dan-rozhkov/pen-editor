import { useCommentsStore } from "@/store/commentsStore";
import type { ToolHandler } from "../toolRegistry";

/**
 * resolve_comment — mark a thread resolved after the agent has addressed it.
 */
export const resolveComment: ToolHandler = async (args) => {
  const threadId = typeof args.threadId === "string" ? args.threadId : "";
  if (!threadId) return JSON.stringify({ error: "threadId is required" });

  const store = useCommentsStore.getState();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) {
    return JSON.stringify({ error: `No comment thread with id ${threadId}` });
  }

  store.resolveThread(threadId);

  return JSON.stringify({ success: true, threadId });
};
