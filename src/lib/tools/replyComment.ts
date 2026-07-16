import { useCommentsStore } from "@/store/commentsStore";
import type { ToolHandler } from "../toolRegistry";

/**
 * reply_comment — append an agent-authored reply to an existing thread. The
 * agent uses this to report back after acting on a comment (or to ask a
 * clarifying question).
 */
export const replyComment: ToolHandler = async (args) => {
  const threadId = typeof args.threadId === "string" ? args.threadId : "";
  const text = typeof args.text === "string" ? args.text : "";

  if (!threadId) return JSON.stringify({ error: "threadId is required" });
  if (!text.trim()) return JSON.stringify({ error: "text is required" });

  const store = useCommentsStore.getState();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) {
    return JSON.stringify({ error: `No comment thread with id ${threadId}` });
  }

  store.addReply(threadId, "agent", text);

  return JSON.stringify({ success: true, threadId });
};
